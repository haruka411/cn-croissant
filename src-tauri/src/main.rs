#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::{Manager, Window};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Default)]
struct AppState {
    stop_requested: AtomicBool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum EngineProtocol {
    Uci,
    Ucci,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalEngineConfig {
    id: String,
    name: String,
    path: String,
    protocol: EngineProtocol,
    builtin: Option<bool>,
    threads: Option<u32>,
    hash: Option<u32>,
    #[serde(rename = "moveTimeMs")]
    move_time_ms: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltinEngine {
    name: String,
    path: String,
    protocol: EngineProtocol,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeRequest {
    engine: LocalEngineConfig,
    fen: String,
    moves: Vec<String>,
    depth: u32,
    multipv: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineAnalysis {
    engine_name: String,
    bestmove: String,
    lines: Vec<EngineLine>,
    logs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineLine {
    multipv: u32,
    depth: u32,
    score: String,
    pv: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineConfig {
    name: String,
    options: Vec<UciOptionConfig>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "lowercase")]
enum UciOptionConfig {
    Check(CheckOption),
    Spin(SpinOption),
    Combo(ComboOption),
    Button(ButtonOption),
    String(StringOption),
}

#[derive(Debug, Clone, Serialize)]
struct CheckOption {
    name: String,
    default: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
struct SpinOption {
    name: String,
    default: Option<i64>,
    min: Option<i64>,
    max: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
struct ComboOption {
    name: String,
    default: Option<String>,
    #[serde(rename = "var")]
    vars: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ButtonOption {
    name: String,
}

#[derive(Debug, Clone, Serialize)]
struct StringOption {
    name: String,
    default: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct FileMetadata {
    last_modified: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorePayload {
    name: String,
    contents: String,
}

#[tauri::command]
async fn close_splashscreen(window: Window) -> Result<(), String> {
    window
        .get_webview_window("main")
        .ok_or("no window labeled 'main' found")?
        .show()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn detect_builtin_engine(app: tauri::AppHandle) -> Result<BuiltinEngine, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let resource_candidates = builtin_engine_resource_candidates(resource_dir);
    for candidate in resource_candidates {
        if let Some(path) = existing_absolute_path(&candidate) {
            return Ok(BuiltinEngine {
                name: "Pikafish".to_string(),
                path,
                protocol: EngineProtocol::Uci,
            });
        }
    }

    let candidates = builtin_engine_candidates();
    for candidate in candidates {
        if let Some(path) = existing_absolute_path(&candidate) {
            return Ok(BuiltinEngine {
                name: "Pikafish".to_string(),
                path,
                protocol: EngineProtocol::Uci,
            });
        }
    }

    Err("Bundled Pikafish engine was not found".to_string())
}

fn existing_absolute_path(candidate: &PathBuf) -> Option<String> {
    candidate
        .exists()
        .then(|| candidate.canonicalize().ok())
        .flatten()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn analyze_position(
    state: tauri::State<AppState>,
    request: AnalyzeRequest,
) -> Result<EngineAnalysis, String> {
    state.stop_requested.store(false, Ordering::Relaxed);

    let mut engine = spawn_engine(&request.engine.path)?;

    let mut logs = Vec::new();
    init_engine(&mut engine, &request.engine, request.multipv, &mut logs)?;
    set_position(
        &mut engine,
        &request.engine.protocol,
        &request.fen,
        &request.moves,
        &mut logs,
    )?;
    if let Some(move_time_ms) = request.engine.move_time_ms.filter(|value| *value > 0) {
        send_line(&mut engine, &format!("go movetime {}", move_time_ms), &mut logs)?;
    } else {
        send_line(&mut engine, &format!("go depth {}", request.depth), &mut logs)?;
    }

    let mut lines = BTreeMap::<u32, EngineLine>::new();
    let mut bestmove = String::new();
    let deadline = Instant::now() + Duration::from_secs(120);

    while Instant::now() < deadline && !state.stop_requested.load(Ordering::Relaxed) {
        let line = read_line(&mut engine, &mut logs)?;
        if line.is_empty() {
            continue;
        }
        if let Some(parsed_bestmove) = parse_bestmove(&line) {
            bestmove = parsed_bestmove;
            break;
        }
        if let Some(info) = parse_info_line(&line) {
            lines.insert(info.multipv, info);
        }
    }

    let _ = send_line(&mut engine, "quit", &mut logs);
    engine.kill();
    state.stop_requested.store(false, Ordering::Relaxed);

    let mut lines: Vec<_> = lines.into_values().collect();
    lines.sort_by_key(|line| line.multipv);

    Ok(EngineAnalysis {
        engine_name: request.engine.name,
        bestmove,
        lines,
        logs,
    })
}

#[tauri::command]
fn stop_analysis(state: tauri::State<AppState>) -> Result<(), String> {
    state.stop_requested.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn read_store(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = store_path(&app, &name)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_store(app: tauri::AppHandle, payload: StorePayload) -> Result<(), String> {
    let path = store_path(&app, &payload.name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, payload.contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn file_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified = metadata.modified().map_err(|error| error.to_string())?;
    let seconds = modified
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();

    Ok(FileMetadata {
        last_modified: seconds.min(u32::MAX as u64) as u32,
    })
}

#[tauri::command]
fn write_game(file_path: String, _n: i32, pgn: String) -> Result<(), String> {
    let path = PathBuf::from(file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, pgn).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_db_game(_file: String, _game_id: i32, _pgn: String) -> Result<(), String> {
    Err("Xiangqi database backend is not implemented yet".to_string())
}

#[tauri::command]
fn preload_reference_db(_file: String) -> Result<(), String> {
    Err("Xiangqi database backend is not implemented yet".to_string())
}

#[tauri::command]
fn kill_engines(_tab: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn abort_game(_game_id: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn get_engine_config(path: PathBuf, protocol: Option<EngineProtocol>) -> Result<EngineConfig, String> {
    let mut engine = spawn_engine(&path.to_string_lossy())?;
    let mut logs = Vec::new();
    let protocol = protocol.unwrap_or(EngineProtocol::Uci);
    let (init_command, ready_command) = match protocol {
        EngineProtocol::Uci => ("uci", "uciok"),
        EngineProtocol::Ucci => ("ucci", "ucciok"),
    };
    send_line(&mut engine, init_command, &mut logs)?;

    let mut config = EngineConfig {
        name: path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("Engine")
            .to_string(),
        options: Vec::new(),
    };
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut initialized = false;

    while Instant::now() < deadline {
        let line = read_line(&mut engine, &mut logs)?;
        if line == ready_command {
            initialized = true;
            break;
        }
        if let Some(name) = parse_uci_id_name(&line) {
            config.name = name;
            continue;
        }
        if let Some(option) = parse_uci_option(&line) {
            config.options.push(option);
        }
    }

    let _ = send_line(&mut engine, "quit", &mut logs);
    engine.kill();
    if !initialized {
        return Err(format!(
            "engine did not respond with {} after {}",
            ready_command, init_command
        ));
    }
    Ok(config)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            close_splashscreen,
            detect_builtin_engine,
            analyze_position,
            stop_analysis,
            read_store,
            write_store,
            file_exists,
            get_file_metadata,
            write_game,
            write_db_game,
            preload_reference_db,
            kill_engines,
            abort_game,
            get_engine_config
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.show().ok();
            }
            Ok(())
        })
        .manage(AppState::default())
        .run(tauri::generate_context!())
        .expect("error while running cn-croissant");
}

fn store_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err("invalid store name".to_string());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("store");
    Ok(dir.join(Path::new(name).with_extension("json")))
}

struct EngineRuntime {
    stdin: std::process::ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    child: std::process::Child,
}

fn spawn_engine(path: &str) -> Result<EngineRuntime, String> {
    let path = PathBuf::from(path);
    let mut command = Command::new(&path);
    if let Some(parent) = path.parent() {
        command.current_dir(parent);
    }
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdin = child.stdin.take().ok_or("engine stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("engine stdout unavailable")?;

    Ok(EngineRuntime {
        stdin,
        stdout: BufReader::new(stdout),
        child,
    })
}

fn init_engine(
    engine: &mut EngineRuntime,
    config: &LocalEngineConfig,
    multipv: u32,
    logs: &mut Vec<String>,
) -> Result<(), String> {
    match config.protocol {
        EngineProtocol::Uci => {
            send_line(engine, "uci", logs)?;
            wait_for(engine, "uciok", logs)?;
            if let Some(threads) = config.threads.filter(|value| *value > 0) {
                send_line(engine, &format!("setoption name Threads value {}", threads), logs).ok();
            }
            if let Some(hash) = config.hash.filter(|value| *value > 0) {
                send_line(engine, &format!("setoption name Hash value {}", hash), logs).ok();
            }
            if multipv > 1 {
                send_line(engine, &format!("setoption name MultiPV value {}", multipv), logs).ok();
            }
            send_line(engine, "isready", logs)?;
            wait_for(engine, "readyok", logs)?;
            send_line(engine, "ucinewgame", logs)?;
        }
        EngineProtocol::Ucci => {
            send_line(engine, "ucci", logs)?;
            wait_for(engine, "ucciok", logs)?;
            if let Some(threads) = config.threads.filter(|value| *value > 0) {
                send_line(engine, &format!("setoption Threads {}", threads), logs).ok();
            }
            if let Some(hash) = config.hash.filter(|value| *value > 0) {
                send_line(engine, &format!("setoption Hash {}", hash), logs).ok();
            }
            if multipv > 1 {
                send_line(engine, &format!("setoption name MultiPV value {}", multipv), logs).ok();
            }
        }
    }
    Ok(())
}

fn set_position(
    engine: &mut EngineRuntime,
    _protocol: &EngineProtocol,
    fen: &str,
    moves: &[String],
    logs: &mut Vec<String>,
) -> Result<(), String> {
    let command = if moves.is_empty() {
        format!("position fen {}", fen)
    } else {
        format!("position fen {} moves {}", fen, moves.join(" "))
    };
    send_line(engine, &command, logs)
}

fn send_line(engine: &mut EngineRuntime, line: &str, logs: &mut Vec<String>) -> Result<(), String> {
    logs.push(format!("gui: {}", line));
    writeln!(engine.stdin, "{}", line).map_err(|error| error.to_string())?;
    engine.stdin.flush().map_err(|error| error.to_string())
}

fn wait_for(engine: &mut EngineRuntime, expected: &str, logs: &mut Vec<String>) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        let line = read_line(engine, logs)?;
        if line.starts_with(expected) {
            return Ok(());
        }
    }
    Err(format!("engine did not respond with {}", expected))
}

fn read_line(engine: &mut EngineRuntime, logs: &mut Vec<String>) -> Result<String, String> {
    let mut line = String::new();
    let bytes = engine
        .stdout
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    if bytes == 0 {
        return Err("engine exited".to_string());
    }
    let line = line.trim().to_string();
    logs.push(format!("engine: {}", line));
    Ok(line)
}

fn parse_bestmove(line: &str) -> Option<String> {
    let mut parts = line.split_whitespace();
    if parts.next()? != "bestmove" {
        return None;
    }
    parts.next().map(ToString::to_string)
}

fn parse_info_line(line: &str) -> Option<EngineLine> {
    if !line.starts_with("info ") {
        return None;
    }
    let tokens: Vec<&str> = line.split_whitespace().collect();
    let mut depth = 0;
    let mut multipv = 1;
    let mut score = String::new();
    let mut pv = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        match tokens[i] {
            "depth" => {
                depth = tokens.get(i + 1)?.parse().ok()?;
                i += 2;
            }
            "multipv" => {
                multipv = tokens.get(i + 1).and_then(|value| value.parse().ok()).unwrap_or(1);
                i += 2;
            }
            "score" => {
                let kind = tokens.get(i + 1).copied().unwrap_or("");
                let value = tokens.get(i + 2).copied().unwrap_or("");
                score = format!("{} {}", kind, value);
                i += 3;
            }
            "pv" => {
                pv = tokens[i + 1..].iter().map(|value| value.to_string()).collect();
                break;
            }
            _ => {
                i += 1;
            }
        }
    }

    if pv.is_empty() {
        return None;
    }

    Some(EngineLine {
        multipv,
        depth,
        score,
        pv,
    })
}

fn parse_uci_id_name(line: &str) -> Option<String> {
    line.strip_prefix("id name ")
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToString::to_string)
}

fn parse_uci_option(line: &str) -> Option<UciOptionConfig> {
    let rest = line.strip_prefix("option name ")?;
    let (name, option_text) = rest.split_once(" type ")?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return None;
    }

    let mut parts = option_text.split_whitespace();
    match parts.next()? {
        "check" => Some(UciOptionConfig::Check(CheckOption {
            name,
            default: parse_uci_bool_field(option_text, "default"),
        })),
        "spin" => Some(UciOptionConfig::Spin(SpinOption {
            name,
            default: parse_uci_i64_field(option_text, "default"),
            min: parse_uci_i64_field(option_text, "min"),
            max: parse_uci_i64_field(option_text, "max"),
        })),
        "combo" => Some(UciOptionConfig::Combo(ComboOption {
            name,
            default: parse_uci_string_field(option_text, "default"),
            vars: parse_uci_vars(option_text),
        })),
        "button" => Some(UciOptionConfig::Button(ButtonOption { name })),
        "string" => Some(UciOptionConfig::String(StringOption {
            name,
            default: parse_uci_string_field(option_text, "default"),
        })),
        _ => None,
    }
}

fn parse_uci_bool_field(text: &str, field: &str) -> Option<bool> {
    parse_uci_field_token(text, field).and_then(|value| match value.to_ascii_lowercase().as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    })
}

fn parse_uci_i64_field(text: &str, field: &str) -> Option<i64> {
    parse_uci_field_token(text, field).and_then(|value| value.parse().ok())
}

fn parse_uci_string_field(text: &str, field: &str) -> Option<String> {
    let value = parse_uci_field_until(text, field, &["default", "min", "max", "var"]);
    value.filter(|item| !item.is_empty())
}

fn parse_uci_vars(text: &str) -> Vec<String> {
    let tokens: Vec<&str> = text.split_whitespace().collect();
    let mut vars = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        if tokens[index] == "var" {
            index += 1;
            let start = index;
            while index < tokens.len()
                && !matches!(tokens[index], "default" | "min" | "max" | "var")
            {
                index += 1;
            }
            let value = tokens[start..index].join(" ");
            if !value.is_empty() {
                vars.push(value);
            }
        } else {
            index += 1;
        }
    }
    vars
}

fn parse_uci_field_token(text: &str, field: &str) -> Option<String> {
    let marker = format!(" {field} ");
    let start = text.find(&marker)? + marker.len();
    text[start..].split_whitespace().next().map(ToString::to_string)
}

fn parse_uci_field_until(text: &str, field: &str, boundaries: &[&str]) -> Option<String> {
    let tokens: Vec<&str> = text.split_whitespace().collect();
    let start = tokens.iter().position(|token| *token == field)? + 1;
    let mut end = start;
    while end < tokens.len() && !boundaries.iter().any(|boundary| tokens[end] == *boundary) {
        end += 1;
    }
    Some(tokens[start..end].join(" "))
}

impl EngineRuntime {
    fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn builtin_engine_candidates() -> Vec<PathBuf> {
    let base = PathBuf::from("engine").join("pikafish");
    #[cfg(target_os = "windows")]
    {
        vec![
            base.join("pikafish-sse41-popcnt.exe"),
            base.join("pikafish-avx2.exe"),
            base.join("pikafish-bmi2.exe"),
            base.join("pikafish-avxvnni.exe"),
            base.join("pikafish-avx512.exe"),
            base.join("pikafish-vnni512.exe"),
        ]
    }
    #[cfg(target_os = "linux")]
    {
        vec![
            base.join("Linux").join("pikafish-sse41-popcnt"),
            base.join("Linux").join("pikafish-avx2"),
            base.join("Linux").join("pikafish-bmi2"),
            base.join("Linux").join("pikafish-avxvnni"),
            base.join("Linux").join("pikafish-avx512"),
            base.join("Linux").join("pikafish-vnni512"),
        ]
    }
    #[cfg(target_os = "macos")]
    {
        vec![base.join("MacOS").join("pikafish-apple-silicon")]
    }
}

fn builtin_engine_resource_candidates(resource_dir: PathBuf) -> Vec<PathBuf> {
    let base = resource_dir.join("engine").join("pikafish");
    #[cfg(target_os = "windows")]
    {
        vec![
            base.join("pikafish-sse41-popcnt.exe"),
            base.join("pikafish-avx2.exe"),
            base.join("pikafish-bmi2.exe"),
            base.join("pikafish-avxvnni.exe"),
            base.join("pikafish-avx512.exe"),
            base.join("pikafish-vnni512.exe"),
        ]
    }
    #[cfg(target_os = "linux")]
    {
        vec![
            base.join("Linux").join("pikafish-sse41-popcnt"),
            base.join("Linux").join("pikafish-avx2"),
            base.join("Linux").join("pikafish-bmi2"),
            base.join("Linux").join("pikafish-avxvnni"),
            base.join("Linux").join("pikafish-avx512"),
            base.join("Linux").join("pikafish-vnni512"),
        ]
    }
    #[cfg(target_os = "macos")]
    {
        vec![base.join("MacOS").join("pikafish-apple-silicon")]
    }
}
