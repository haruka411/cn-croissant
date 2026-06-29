#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, Window};

mod xiangqi_opening_book;
mod xiangqi_zobrist_table;

use xiangqi_opening_book::{XiangqiOpeningBook, XiangqiOpeningBookConfig};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Default)]
struct AppState {
    xiangqi_analysis_processes: Mutex<HashMap<String, Arc<Mutex<XiangqiAnalysisProcess>>>>,
    xiangqi_games: Mutex<HashMap<String, Arc<Mutex<XiangqiGameController>>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum EngineProtocol {
    Uci,
    Ucci,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "t", content = "c")]
enum GoMode {
    PlayersTime(PlayersTime),
    Depth(u32),
    Time(u32),
    Nodes(u32),
    Infinite,
}

impl GoMode {
    fn to_uci_string(&self) -> String {
        match self {
            GoMode::Depth(depth) => format!("go depth {}", depth),
            GoMode::Time(time) => format!("go movetime {}", time),
            GoMode::Nodes(nodes) => format!("go nodes {}", nodes),
            GoMode::PlayersTime(players_time) => format!(
                "go wtime {} btime {} winc {} binc {}",
                players_time.white, players_time.black, players_time.winc, players_time.binc
            ),
            GoMode::Infinite => "go infinite".to_string(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct PlayersTime {
    white: u32,
    black: u32,
    winc: u32,
    binc: u32,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct EngineOption {
    name: String,
    value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltinEngine {
    name: String,
    path: String,
    protocol: EngineProtocol,
}

type GameId = String;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum XiangqiPlayerConfig {
    Human {
        name: String,
    },
    Engine {
        name: String,
        path: String,
        protocol: Option<EngineProtocol>,
        #[serde(default)]
        options: Vec<EngineOption>,
        go: Option<GoMode>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct XiangqiTimeControl {
    initial_time: u64,
    increment: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct XiangqiGameConfig {
    white: XiangqiPlayerConfig,
    black: XiangqiPlayerConfig,
    white_time_control: Option<XiangqiTimeControl>,
    black_time_control: Option<XiangqiTimeControl>,
    initial_fen: Option<String>,
    #[serde(default)]
    initial_moves: Vec<String>,
    opening_book: Option<XiangqiOpeningBookConfig>,
    #[serde(default)]
    xiangqi_rule: XiangqiRepetitionRule,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
enum XiangqiRepetitionRule {
    AsianRule,
    ChineseRule,
    SkyRule,
    ComputerRule,
    YitianRule,
    AllowChase,
    NoJudgement,
}

impl Default for XiangqiRepetitionRule {
    fn default() -> Self {
        Self::AsianRule
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum GameStatus {
    Playing,
    Finished { result: GameResult },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
enum GameResult {
    WhiteWins { reason: GameEndReason },
    BlackWins { reason: GameEndReason },
    Draw { reason: DrawReason },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum GameEndReason {
    Checkmate,
    NoLegalMove,
    PerpetualCheck,
    PerpetualChase,
    NaturalDraw,
    Repetition,
    Timeout,
    Resignation,
    Abandonment,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum DrawReason {
    Stalemate,
    InsufficientMaterial,
    ThreefoldRepetition,
    FiftyMoveRule,
    Agreement,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameMove {
    uci: String,
    san: String,
    fen_after: String,
    clock: Option<u64>,
    white_time: Option<u64>,
    black_time: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameState {
    game_id: GameId,
    status: GameStatus,
    initial_fen: String,
    moves: Vec<GameMove>,
    current_fen: String,
    ply: u32,
    turn: String,
    white_time: Option<u64>,
    black_time: Option<u64>,
    white_player: String,
    black_player: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameMoveEvent {
    game_id: GameId,
    moves: Vec<GameMove>,
    fen: String,
    white_time: Option<u64>,
    black_time: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClockUpdateEvent {
    game_id: GameId,
    white_time: Option<u64>,
    black_time: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameOverEvent {
    game_id: GameId,
    result: GameResult,
    moves: Vec<GameMove>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum EngineLogEvent {
    Gui { value: String },
    Engine { value: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum XiangqiColor {
    Red,
    Black,
}

impl XiangqiColor {
    fn opposite(self) -> Self {
        match self {
            Self::Red => Self::Black,
            Self::Black => Self::Red,
        }
    }

    fn to_turn_string(self) -> String {
        match self {
            Self::Red => "white".to_string(),
            Self::Black => "black".to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum XiangqiRole {
    King,
    Advisor,
    Elephant,
    Horse,
    Rook,
    Cannon,
    Pawn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct XiangqiPiece {
    color: XiangqiColor,
    role: XiangqiRole,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct XiangqiMove {
    from: (usize, usize),
    to: (usize, usize),
}

#[derive(Debug, Clone)]
struct XiangqiPosition {
    board: [[Option<XiangqiPiece>; 9]; 10],
    turn: XiangqiColor,
    halfmove: u32,
    fullmove: u32,
}

#[derive(Debug, Clone)]
struct XiangqiMoveResult {
    position: XiangqiPosition,
    san: String,
}

#[derive(Debug)]
struct XiangqiClockState {
    white_time: Option<u64>,
    black_time: Option<u64>,
    white_increment: u64,
    black_increment: u64,
    last_tick: Instant,
}

struct XiangqiGameEngine {
    runtime: EngineRuntime,
    config: LocalEngineConfig,
    logs: Vec<String>,
}

struct XiangqiGameController {
    game_id: GameId,
    config: XiangqiGameConfig,
    initial_fen: String,
    moves: Vec<GameMove>,
    position: XiangqiPosition,
    position_history: HashMap<String, u32>,
    status: GameStatus,
    clock: Option<XiangqiClockState>,
    white_engine: Option<XiangqiGameEngine>,
    black_engine: Option<XiangqiGameEngine>,
    white_engine_pid: Option<u32>,
    black_engine_pid: Option<u32>,
    opening_book: Option<XiangqiOpeningBook>,
    shutdown: bool,
    engine_thinking: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeRequest {
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    engine: LocalEngineConfig,
    fen: String,
    moves: Vec<String>,
    depth: u32,
    multipv: u32,
    #[serde(default, rename = "extraOptions")]
    extra_options: Vec<EngineOption>,
    #[serde(rename = "goMode")]
    go_mode: Option<GoMode>,
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
struct EngineAnalysisUpdate {
    request_id: String,
    engine_id: String,
    fen: String,
    progress: f64,
    finished: bool,
    analysis: EngineAnalysis,
}

const INITIAL_XIANGQI_FEN: &str =
    "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
const XIANGQI_FILES: [char; 9] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];

impl XiangqiPosition {
    fn parse(fen: &str) -> Result<Self, String> {
        let parts: Vec<&str> = fen.trim().split_whitespace().collect();
        let board_part = parts.first().ok_or("missing Xiangqi FEN board")?;
        let ranks: Vec<&str> = board_part.split('/').collect();
        if ranks.len() != 10 {
            return Err("Xiangqi FEN must have 10 ranks".to_string());
        }

        let mut board = [[None; 9]; 10];
        for (rank_index, rank_text) in ranks.iter().enumerate() {
            let rank = 9usize.saturating_sub(rank_index);
            let mut file = 0usize;
            for ch in rank_text.chars() {
                if ch.is_ascii_digit() {
                    file += ch.to_digit(10).unwrap_or(0) as usize;
                    continue;
                }
                if file >= 9 {
                    return Err(format!("too many files in rank: {}", rank_text));
                }
                let role = match ch.to_ascii_lowercase() {
                    'k' => XiangqiRole::King,
                    'a' => XiangqiRole::Advisor,
                    'b' | 'e' => XiangqiRole::Elephant,
                    'n' | 'h' => XiangqiRole::Horse,
                    'r' => XiangqiRole::Rook,
                    'c' => XiangqiRole::Cannon,
                    'p' => XiangqiRole::Pawn,
                    _ => return Err(format!("invalid Xiangqi piece: {}", ch)),
                };
                board[rank][file] = Some(XiangqiPiece {
                    color: if ch.is_ascii_uppercase() {
                        XiangqiColor::Red
                    } else {
                        XiangqiColor::Black
                    },
                    role,
                });
                file += 1;
            }
            if file != 9 {
                return Err(format!("rank does not contain 9 files: {}", rank_text));
            }
        }

        let turn = match parts
            .get(1)
            .copied()
            .unwrap_or("w")
            .to_ascii_lowercase()
            .as_str()
        {
            "w" | "r" | "red" => XiangqiColor::Red,
            "b" | "black" => XiangqiColor::Black,
            raw => return Err(format!("invalid side to move: {}", raw)),
        };
        let halfmove = parts
            .get(4)
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0);
        let fullmove = parts
            .get(5)
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(1);

        Ok(Self {
            board,
            turn,
            halfmove,
            fullmove,
        })
    }

    fn to_fen(&self) -> String {
        let mut ranks = Vec::new();
        for rank in (0..10).rev() {
            let mut text = String::new();
            let mut empty = 0usize;
            for file in 0..9 {
                if let Some(piece) = self.board[rank][file] {
                    if empty > 0 {
                        text.push_str(&empty.to_string());
                        empty = 0;
                    }
                    let mut ch = match piece.role {
                        XiangqiRole::King => 'k',
                        XiangqiRole::Advisor => 'a',
                        XiangqiRole::Elephant => 'b',
                        XiangqiRole::Horse => 'n',
                        XiangqiRole::Rook => 'r',
                        XiangqiRole::Cannon => 'c',
                        XiangqiRole::Pawn => 'p',
                    };
                    if piece.color == XiangqiColor::Red {
                        ch = ch.to_ascii_uppercase();
                    }
                    text.push(ch);
                } else {
                    empty += 1;
                }
            }
            if empty > 0 {
                text.push_str(&empty.to_string());
            }
            ranks.push(text);
        }

        let turn = if self.turn == XiangqiColor::Red {
            "w"
        } else {
            "b"
        };
        format!(
            "{} {} - - {} {}",
            ranks.join("/"),
            turn,
            self.halfmove,
            self.fullmove
        )
    }

    fn position_key(&self) -> String {
        self.to_fen()
            .split_whitespace()
            .take(2)
            .collect::<Vec<_>>()
            .join(" ")
    }
}

fn parse_xiangqi_uci_move(text: &str) -> Result<XiangqiMove, String> {
    let clean = text.trim().to_ascii_lowercase();
    let chars: Vec<char> = clean.chars().collect();
    if chars.len() != 4 {
        return Err(format!("invalid move: {}", text));
    }
    Ok(XiangqiMove {
        from: parse_xiangqi_square(chars[0], chars[1])?,
        to: parse_xiangqi_square(chars[2], chars[3])?,
    })
}

fn parse_xiangqi_square(file: char, rank: char) -> Result<(usize, usize), String> {
    let file = XIANGQI_FILES
        .iter()
        .position(|candidate| *candidate == file)
        .ok_or_else(|| "invalid file".to_string())?;
    let rank = rank
        .to_digit(10)
        .map(|value| value as usize)
        .ok_or_else(|| "invalid rank".to_string())?;
    if rank >= 10 {
        return Err("invalid rank".to_string());
    }
    Ok((file, rank))
}

fn make_xiangqi_uci_move(mv: XiangqiMove) -> String {
    format!(
        "{}{}{}{}",
        XIANGQI_FILES[mv.from.0], mv.from.1, XIANGQI_FILES[mv.to.0], mv.to.1
    )
}

fn in_bounds(file: isize, rank: isize) -> bool {
    (0..9).contains(&file) && (0..10).contains(&rank)
}

fn in_palace(color: XiangqiColor, file: isize, rank: isize) -> bool {
    if !(3..=5).contains(&file) {
        return false;
    }
    match color {
        XiangqiColor::Red => (0..=2).contains(&rank),
        XiangqiColor::Black => (7..=9).contains(&rank),
    }
}

fn find_king(position: &XiangqiPosition, color: XiangqiColor) -> Option<(usize, usize)> {
    for rank in 0..10 {
        for file in 0..9 {
            if position.board[rank][file]
                == Some(XiangqiPiece {
                    color,
                    role: XiangqiRole::King,
                })
            {
                return Some((file, rank));
            }
        }
    }
    None
}

fn clear_file(position: &XiangqiPosition, file: usize, from_rank: usize, to_rank: usize) -> bool {
    let (start, end) = if from_rank < to_rank {
        (from_rank + 1, to_rank)
    } else {
        (to_rank + 1, from_rank)
    };
    for rank in start..end {
        if position.board[rank][file].is_some() {
            return false;
        }
    }
    true
}

fn push_if_available(
    moves: &mut Vec<XiangqiMove>,
    position: &XiangqiPosition,
    piece: XiangqiPiece,
    from: (usize, usize),
    file: isize,
    rank: isize,
) {
    if !in_bounds(file, rank) {
        return;
    }
    let target = position.board[rank as usize][file as usize];
    if target.map(|p| p.color != piece.color).unwrap_or(true) {
        moves.push(XiangqiMove {
            from,
            to: (file as usize, rank as usize),
        });
    }
}

fn pseudo_moves_for_piece(
    position: &XiangqiPosition,
    from: (usize, usize),
    piece: XiangqiPiece,
) -> Vec<XiangqiMove> {
    let mut moves = Vec::new();
    let file = from.0 as isize;
    let rank = from.1 as isize;

    match piece.role {
        XiangqiRole::King => {
            for (df, dr) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let nf = file + df;
                let nr = rank + dr;
                if in_palace(piece.color, nf, nr) {
                    push_if_available(&mut moves, position, piece, from, nf, nr);
                }
            }
            if let Some(enemy_king) = find_king(position, piece.color.opposite()) {
                if enemy_king.0 == from.0 && clear_file(position, from.0, from.1, enemy_king.1) {
                    moves.push(XiangqiMove {
                        from,
                        to: enemy_king,
                    });
                }
            }
        }
        XiangqiRole::Advisor => {
            for (df, dr) in [(1, 1), (1, -1), (-1, 1), (-1, -1)] {
                let nf = file + df;
                let nr = rank + dr;
                if in_palace(piece.color, nf, nr) {
                    push_if_available(&mut moves, position, piece, from, nf, nr);
                }
            }
        }
        XiangqiRole::Elephant => {
            for (df, dr) in [(2, 2), (2, -2), (-2, 2), (-2, -2)] {
                let nf = file + df;
                let nr = rank + dr;
                let eye_file = file + df / 2;
                let eye_rank = rank + dr / 2;
                let crossed_river = match piece.color {
                    XiangqiColor::Red => nr > 4,
                    XiangqiColor::Black => nr < 5,
                };
                if !in_bounds(nf, nr) || crossed_river {
                    continue;
                }
                if position.board[eye_rank as usize][eye_file as usize].is_some() {
                    continue;
                }
                push_if_available(&mut moves, position, piece, from, nf, nr);
            }
        }
        XiangqiRole::Horse => {
            for (df, dr, leg_df, leg_dr) in [
                (1, 2, 0, 1),
                (-1, 2, 0, 1),
                (1, -2, 0, -1),
                (-1, -2, 0, -1),
                (2, 1, 1, 0),
                (2, -1, 1, 0),
                (-2, 1, -1, 0),
                (-2, -1, -1, 0),
            ] {
                let nf = file + df;
                let nr = rank + dr;
                if !in_bounds(nf, nr) {
                    continue;
                }
                if position.board[(rank + leg_dr) as usize][(file + leg_df) as usize].is_some() {
                    continue;
                }
                push_if_available(&mut moves, position, piece, from, nf, nr);
            }
        }
        XiangqiRole::Rook | XiangqiRole::Cannon => {
            let cannon = piece.role == XiangqiRole::Cannon;
            for (df, dr) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let mut nf = file + df;
                let mut nr = rank + dr;
                let mut screen_seen = false;
                while in_bounds(nf, nr) {
                    let target = position.board[nr as usize][nf as usize];
                    if !cannon {
                        if let Some(target) = target {
                            if target.color != piece.color {
                                moves.push(XiangqiMove {
                                    from,
                                    to: (nf as usize, nr as usize),
                                });
                            }
                            break;
                        }
                        moves.push(XiangqiMove {
                            from,
                            to: (nf as usize, nr as usize),
                        });
                    } else if !screen_seen {
                        if target.is_none() {
                            moves.push(XiangqiMove {
                                from,
                                to: (nf as usize, nr as usize),
                            });
                        } else {
                            screen_seen = true;
                        }
                    } else if let Some(target) = target {
                        if target.color != piece.color {
                            moves.push(XiangqiMove {
                                from,
                                to: (nf as usize, nr as usize),
                            });
                        }
                        break;
                    }
                    nf += df;
                    nr += dr;
                }
            }
        }
        XiangqiRole::Pawn => {
            let forward = if piece.color == XiangqiColor::Red {
                1
            } else {
                -1
            };
            push_if_available(&mut moves, position, piece, from, file, rank + forward);
            let crossed_river = match piece.color {
                XiangqiColor::Red => rank >= 5,
                XiangqiColor::Black => rank <= 4,
            };
            if crossed_river {
                push_if_available(&mut moves, position, piece, from, file - 1, rank);
                push_if_available(&mut moves, position, piece, from, file + 1, rank);
            }
        }
    }

    moves
}

fn is_xiangqi_in_check(position: &XiangqiPosition, color: XiangqiColor) -> bool {
    let Some(king) = find_king(position, color) else {
        return true;
    };

    for rank in 0..10 {
        for file in 0..9 {
            let Some(piece) = position.board[rank][file] else {
                continue;
            };
            if piece.color == color {
                continue;
            }
            if pseudo_moves_for_piece(position, (file, rank), piece)
                .iter()
                .any(|mv| mv.to == king)
            {
                return true;
            }
        }
    }

    false
}

fn apply_xiangqi_move_unchecked(
    position: &XiangqiPosition,
    mv: XiangqiMove,
) -> Result<XiangqiMoveResult, String> {
    let piece = position.board[mv.from.1][mv.from.0]
        .ok_or_else(|| format!("no piece on {}", make_xiangqi_uci_move(mv)))?;
    let mut next = position.clone();
    let captured = next.board[mv.to.1][mv.to.0];
    next.board[mv.from.1][mv.from.0] = None;
    next.board[mv.to.1][mv.to.0] = Some(piece);
    next.turn = position.turn.opposite();
    next.halfmove = if captured.is_some() {
        0
    } else {
        position.halfmove + 1
    };
    next.fullmove = if position.turn == XiangqiColor::Black {
        position.fullmove + 1
    } else {
        position.fullmove
    };
    let san = make_xiangqi_uci_move(mv);

    Ok(XiangqiMoveResult {
        position: next,
        san,
    })
}

fn legal_xiangqi_moves(position: &XiangqiPosition) -> Vec<XiangqiMove> {
    let mut result = Vec::new();
    for rank in 0..10 {
        for file in 0..9 {
            let Some(piece) = position.board[rank][file] else {
                continue;
            };
            if piece.color != position.turn {
                continue;
            }
            for mv in pseudo_moves_for_piece(position, (file, rank), piece) {
                if let Ok(next) = apply_xiangqi_move_unchecked(position, mv) {
                    if !is_xiangqi_in_check(&next.position, piece.color) {
                        result.push(mv);
                    }
                }
            }
        }
    }
    result
}

fn apply_xiangqi_move(
    position: &XiangqiPosition,
    mv: XiangqiMove,
) -> Result<XiangqiMoveResult, String> {
    if !legal_xiangqi_moves(position).contains(&mv) {
        return Err(format!("illegal move: {}", make_xiangqi_uci_move(mv)));
    }
    apply_xiangqi_move_unchecked(position, mv)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum XiangqiViolation {
    Idle,
    Chase,
    Check,
}

#[derive(Debug, Clone, Copy)]
struct XiangqiRulePolicy {
    repetition_occurrences: usize,
    chase_level: u8,
    chinese_protected_minor_chase: bool,
    natural_draw: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum XiangqiRuleVerdict {
    Draw(DrawReason),
    RedLoses(GameEndReason),
    BlackLoses(GameEndReason),
}

#[derive(Default)]
struct XiangqiSideCycleStats {
    moves: u32,
    checks: u32,
    chase_sets: Vec<HashSet<String>>,
}

fn adjudicate_xiangqi_repetition(
    initial_fen: &str,
    moves: &[GameMove],
    rule: XiangqiRepetitionRule,
) -> Option<XiangqiRuleVerdict> {
    if rule == XiangqiRepetitionRule::NoJudgement {
        return None;
    }
    let policy = xiangqi_rule_policy(rule);

    let mut fens = Vec::with_capacity(moves.len() + 1);
    fens.push(initial_fen.to_string());
    fens.extend(moves.iter().map(|mv| mv.fen_after.clone()));
    let current_key = XiangqiPosition::parse(fens.last()?).ok()?.position_key();
    let occurrences: Vec<usize> = fens
        .iter()
        .enumerate()
        .filter_map(|(index, fen)| {
            let key = XiangqiPosition::parse(fen).ok()?.position_key();
            (key == current_key).then_some(index)
        })
        .collect();
    if occurrences.len() < policy.repetition_occurrences {
        return None;
    }
    let start_index = *occurrences.get(occurrences.len().saturating_sub(2))?;
    let cycle = classify_xiangqi_repetition_cycle(&fens, moves, start_index, policy)?;
    apply_xiangqi_repetition_rule(rule, cycle, policy)
}

fn classify_xiangqi_repetition_cycle(
    fens: &[String],
    moves: &[GameMove],
    start_index: usize,
    policy: XiangqiRulePolicy,
) -> Option<[XiangqiViolation; 2]> {
    let mut stats = [
        XiangqiSideCycleStats::default(),
        XiangqiSideCycleStats::default(),
    ];
    let mut tracker =
        create_xiangqi_piece_tracker(&XiangqiPosition::parse(fens.get(start_index)?).ok()?);

    for index in (start_index + 1)..fens.len() {
        let before = XiangqiPosition::parse(fens.get(index - 1)?).ok()?;
        let after = XiangqiPosition::parse(fens.get(index)?).ok()?;
        let mv = parse_xiangqi_uci_move(&moves.get(index - 1)?.uci).ok()?;
        tracker = update_xiangqi_piece_tracker(&tracker, mv);
        let side_index = color_index(before.turn);
        stats[side_index].moves += 1;
        if is_xiangqi_in_check(&after, after.turn) {
            stats[side_index].checks += 1;
        }
        stats[side_index].chase_sets.push(chased_xiangqi_pieces(
            &after,
            before.turn,
            &tracker,
            policy,
        ));
    }

    let has_any_check = stats.iter().any(|side| side.checks > 0);
    Some([
        classify_xiangqi_side_violation(&stats[0], has_any_check),
        classify_xiangqi_side_violation(&stats[1], has_any_check),
    ])
}

fn classify_xiangqi_side_violation(
    side: &XiangqiSideCycleStats,
    has_any_check: bool,
) -> XiangqiViolation {
    if side.moves > 0 && side.checks == side.moves {
        return XiangqiViolation::Check;
    }
    if has_any_check {
        return XiangqiViolation::Idle;
    }
    if intersect_xiangqi_chases(&side.chase_sets).is_empty() {
        XiangqiViolation::Idle
    } else {
        XiangqiViolation::Chase
    }
}

fn apply_xiangqi_repetition_rule(
    rule: XiangqiRepetitionRule,
    cycle: [XiangqiViolation; 2],
    policy: XiangqiRulePolicy,
) -> Option<XiangqiRuleVerdict> {
    if cycle == [XiangqiViolation::Idle, XiangqiViolation::Idle] {
        return Some(XiangqiRuleVerdict::Draw(DrawReason::ThreefoldRepetition));
    }
    if rule == XiangqiRepetitionRule::NoJudgement {
        return None;
    }
    let red = xiangqi_violation_level(cycle[0], policy.chase_level);
    let black = xiangqi_violation_level(cycle[1], policy.chase_level);
    if red == black {
        let reason = if red == 2 {
            DrawReason::ThreefoldRepetition
        } else if red == 1 {
            DrawReason::ThreefoldRepetition
        } else {
            DrawReason::ThreefoldRepetition
        };
        return Some(XiangqiRuleVerdict::Draw(reason));
    }
    if red > black {
        Some(XiangqiRuleVerdict::RedLoses(xiangqi_violation_reason(
            cycle[0],
        )))
    } else {
        Some(XiangqiRuleVerdict::BlackLoses(xiangqi_violation_reason(
            cycle[1],
        )))
    }
}

fn xiangqi_rule_policy(rule: XiangqiRepetitionRule) -> XiangqiRulePolicy {
    match rule {
        XiangqiRepetitionRule::ComputerRule => XiangqiRulePolicy {
            repetition_occurrences: 3,
            chase_level: 1,
            chinese_protected_minor_chase: false,
            natural_draw: true,
        },
        XiangqiRepetitionRule::ChineseRule => XiangqiRulePolicy {
            repetition_occurrences: 2,
            chase_level: 1,
            chinese_protected_minor_chase: true,
            natural_draw: true,
        },
        XiangqiRepetitionRule::YitianRule => XiangqiRulePolicy {
            repetition_occurrences: 2,
            chase_level: 1,
            chinese_protected_minor_chase: false,
            natural_draw: false,
        },
        XiangqiRepetitionRule::AllowChase => XiangqiRulePolicy {
            repetition_occurrences: 2,
            chase_level: 0,
            chinese_protected_minor_chase: false,
            natural_draw: true,
        },
        XiangqiRepetitionRule::NoJudgement => XiangqiRulePolicy {
            repetition_occurrences: usize::MAX,
            chase_level: 0,
            chinese_protected_minor_chase: false,
            natural_draw: true,
        },
        XiangqiRepetitionRule::AsianRule | XiangqiRepetitionRule::SkyRule => XiangqiRulePolicy {
            repetition_occurrences: 2,
            chase_level: 1,
            chinese_protected_minor_chase: false,
            natural_draw: true,
        },
    }
}

fn xiangqi_violation_level(violation: XiangqiViolation, chase_level: u8) -> u8 {
    match violation {
        XiangqiViolation::Idle => 0,
        XiangqiViolation::Chase => chase_level,
        XiangqiViolation::Check => 2,
    }
}

fn xiangqi_violation_reason(violation: XiangqiViolation) -> GameEndReason {
    match violation {
        XiangqiViolation::Check => GameEndReason::PerpetualCheck,
        XiangqiViolation::Chase => GameEndReason::PerpetualChase,
        XiangqiViolation::Idle => GameEndReason::Repetition,
    }
}

fn color_index(color: XiangqiColor) -> usize {
    if color == XiangqiColor::Red {
        0
    } else {
        1
    }
}

fn create_xiangqi_piece_tracker(position: &XiangqiPosition) -> HashMap<(usize, usize), String> {
    let mut tracker = HashMap::new();
    let mut counts: HashMap<String, u32> = HashMap::new();
    for rank in 0..10 {
        for file in 0..9 {
            if let Some(piece) = position.board[rank][file] {
                let key = format!("{:?}:{:?}", piece.color, piece.role);
                let count = counts.entry(key.clone()).or_insert(0);
                *count += 1;
                tracker.insert((file, rank), format!("{}:{}", key, count));
            }
        }
    }
    tracker
}

fn update_xiangqi_piece_tracker(
    tracker: &HashMap<(usize, usize), String>,
    mv: XiangqiMove,
) -> HashMap<(usize, usize), String> {
    let mut next = tracker.clone();
    let id = next.remove(&mv.from);
    next.remove(&mv.to);
    if let Some(id) = id {
        next.insert(mv.to, id);
    }
    next
}

fn chased_xiangqi_pieces(
    position: &XiangqiPosition,
    color: XiangqiColor,
    tracker: &HashMap<(usize, usize), String>,
    policy: XiangqiRulePolicy,
) -> HashSet<String> {
    let mut result = HashSet::new();
    let mut probe = position.clone();
    probe.turn = color;
    for mv in legal_xiangqi_moves(&probe) {
        let Some(attacker) = position.board[mv.from.1][mv.from.0] else {
            continue;
        };
        let Some(target) = position.board[mv.to.1][mv.to.0] else {
            continue;
        };
        if target.color == color
            || !can_be_xiangqi_chase_attacker(attacker.role)
            || !can_be_xiangqi_chase_target(target, mv.to)
        {
            continue;
        }
        if (!is_xiangqi_protected_after_capture(&probe, mv)
            || is_force_xiangqi_chase(attacker.role, target.role, policy))
            && tracker.get(&mv.to).is_some()
        {
            result.insert(tracker[&mv.to].clone());
        }
    }
    result
}

fn can_be_xiangqi_chase_attacker(role: XiangqiRole) -> bool {
    !matches!(role, XiangqiRole::King | XiangqiRole::Pawn)
}

fn can_be_xiangqi_chase_target(piece: XiangqiPiece, square: (usize, usize)) -> bool {
    if piece.role == XiangqiRole::King {
        return false;
    }
    if piece.role != XiangqiRole::Pawn {
        return true;
    }
    match piece.color {
        XiangqiColor::Red => square.1 >= 5,
        XiangqiColor::Black => square.1 <= 4,
    }
}

fn is_force_xiangqi_chase(
    attacker: XiangqiRole,
    target: XiangqiRole,
    policy: XiangqiRulePolicy,
) -> bool {
    if matches!(attacker, XiangqiRole::Horse | XiangqiRole::Cannon) && target == XiangqiRole::Rook {
        return true;
    }
    policy.chinese_protected_minor_chase
        && matches!(attacker, XiangqiRole::Advisor | XiangqiRole::Elephant)
        && matches!(
            target,
            XiangqiRole::Rook | XiangqiRole::Horse | XiangqiRole::Cannon
        )
}

fn is_xiangqi_protected_after_capture(position: &XiangqiPosition, mv: XiangqiMove) -> bool {
    let Ok(after) = apply_xiangqi_move(position, mv) else {
        return true;
    };
    legal_xiangqi_moves(&after.position)
        .iter()
        .any(|reply| reply.to == mv.to)
}

fn intersect_xiangqi_chases(sets: &[HashSet<String>]) -> HashSet<String> {
    let Some(first) = sets.first() else {
        return HashSet::new();
    };
    let mut result = first.clone();
    for set in &sets[1..] {
        result.retain(|value| set.contains(value));
    }
    result
}

impl XiangqiGameEngine {
    fn new(
        name: String,
        path: String,
        protocol: Option<EngineProtocol>,
        options: Vec<EngineOption>,
        go: Option<GoMode>,
    ) -> Result<Self, String> {
        let mut config = LocalEngineConfig {
            id: name.clone(),
            name,
            path,
            protocol: protocol.unwrap_or(EngineProtocol::Ucci),
            builtin: None,
            threads: option_u32(&options, "Threads"),
            hash: option_u32(&options, "Hash"),
            move_time_ms: None,
        };
        let mut extra_options = Vec::new();
        for option in options {
            match option.name.as_str() {
                "Threads" | "Hash" | "MultiPV" => {}
                _ => extra_options.push(option),
            }
        }
        if matches!(go, Some(GoMode::Time(value)) if value > 0) {
            config.move_time_ms = match go {
                Some(GoMode::Time(value)) => Some(value),
                _ => None,
            };
        }

        let mut runtime = spawn_engine(&config.path)?;
        let mut logs = Vec::new();
        init_engine(&mut runtime, &config, 1, &mut logs)?;
        configure_extra_engine_options(
            &mut runtime.stdin,
            &config.protocol,
            &extra_options,
            &mut logs,
        )?;
        Ok(Self {
            runtime,
            config,
            logs,
        })
    }

    fn get_logs(&self) -> Vec<EngineLogEvent> {
        self.logs
            .iter()
            .map(|line| {
                if let Some(value) = line.strip_prefix("gui: ") {
                    EngineLogEvent::Gui {
                        value: value.to_string(),
                    }
                } else if let Some(value) = line.strip_prefix("engine: ") {
                    EngineLogEvent::Engine {
                        value: value.to_string(),
                    }
                } else {
                    EngineLogEvent::Engine {
                        value: line.to_string(),
                    }
                }
            })
            .collect()
    }

    fn quit(&mut self) {
        let _ = send_line(&mut self.runtime, "quit", &mut self.logs);
        let _ = self.runtime.child.kill();
    }
}

fn kill_process_by_pid(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn option_u32(options: &[EngineOption], name: &str) -> Option<u32> {
    options
        .iter()
        .find(|option| option.name == name)
        .and_then(|option| option.value.parse::<u32>().ok())
        .filter(|value| *value > 0)
}

impl XiangqiGameController {
    fn new(game_id: GameId, config: XiangqiGameConfig) -> Result<Self, String> {
        let initial_fen = config
            .initial_fen
            .clone()
            .unwrap_or_else(|| INITIAL_XIANGQI_FEN.to_string());
        let opening_book = config
            .opening_book
            .clone()
            .map(XiangqiOpeningBook::new)
            .transpose()?;
        let clock = if config.white_time_control.is_some() || config.black_time_control.is_some() {
            Some(XiangqiClockState {
                white_time: config.white_time_control.as_ref().map(|tc| tc.initial_time),
                black_time: config.black_time_control.as_ref().map(|tc| tc.initial_time),
                white_increment: config
                    .white_time_control
                    .as_ref()
                    .map(|tc| tc.increment)
                    .unwrap_or(0),
                black_increment: config
                    .black_time_control
                    .as_ref()
                    .map(|tc| tc.increment)
                    .unwrap_or(0),
                last_tick: Instant::now(),
            })
        } else {
            None
        };

        let mut controller = Self {
            game_id,
            config,
            initial_fen: initial_fen.clone(),
            moves: Vec::new(),
            position: XiangqiPosition::parse(&initial_fen)?,
            position_history: HashMap::new(),
            status: GameStatus::Playing,
            clock,
            white_engine: None,
            black_engine: None,
            white_engine_pid: None,
            black_engine_pid: None,
            opening_book,
            shutdown: false,
            engine_thinking: false,
        };
        let key = controller.position.position_key();
        controller.position_history.insert(key, 1);
        let initial_moves = controller.config.initial_moves.clone();
        for mv in initial_moves {
            controller.apply_move_no_clock(&mv)?;
        }
        controller.reset_clock();
        Ok(controller)
    }

    fn get_state(&self) -> GameState {
        let (white_time, black_time) = self.get_current_times();
        GameState {
            game_id: self.game_id.clone(),
            status: self.status.clone(),
            initial_fen: self.initial_fen.clone(),
            moves: self.moves.clone(),
            current_fen: self.position.to_fen(),
            ply: self.moves.len() as u32,
            turn: self.position.turn.to_turn_string(),
            white_time,
            black_time,
            white_player: player_name(&self.config.white),
            black_player: player_name(&self.config.black),
        }
    }

    fn current_turn_player(&self) -> &XiangqiPlayerConfig {
        if self.position.turn == XiangqiColor::Red {
            &self.config.white
        } else {
            &self.config.black
        }
    }

    fn is_engine_turn(&self) -> bool {
        matches!(
            self.current_turn_player(),
            XiangqiPlayerConfig::Engine { .. }
        )
    }

    fn apply_move(&mut self, uci: &str) -> Result<GameMove, String> {
        if self.status != GameStatus::Playing {
            return Err("game is not in progress".to_string());
        }

        let mv = parse_xiangqi_uci_move(uci)?;
        let clock = self.clock.as_ref().and_then(|clock| {
            if self.position.turn == XiangqiColor::Red {
                clock.white_time
            } else {
                clock.black_time
            }
        });
        let result = apply_xiangqi_move(&self.position, mv)?;

        if let Some(ref mut clock_state) = self.clock {
            let elapsed = clock_state.last_tick.elapsed().as_millis() as u64;
            if self.position.turn == XiangqiColor::Red {
                if let Some(ref mut wt) = clock_state.white_time {
                    *wt = wt.saturating_sub(elapsed);
                    *wt += clock_state.white_increment;
                }
            } else if let Some(ref mut bt) = clock_state.black_time {
                *bt = bt.saturating_sub(elapsed);
                *bt += clock_state.black_increment;
            }
            clock_state.last_tick = Instant::now();
        }

        self.position = result.position;
        let key = self.position.position_key();
        *self.position_history.entry(key).or_insert(0) += 1;
        let (white_time, black_time) = self
            .clock
            .as_ref()
            .map(|clock| (clock.white_time, clock.black_time))
            .unwrap_or((None, None));
        let game_move = GameMove {
            uci: uci.to_string(),
            san: result.san,
            fen_after: self.position.to_fen(),
            clock,
            white_time,
            black_time,
        };
        self.moves.push(game_move.clone());
        self.check_game_end();
        Ok(game_move)
    }

    fn apply_move_no_clock(&mut self, uci: &str) -> Result<GameMove, String> {
        let mv = parse_xiangqi_uci_move(uci)?;
        let result = apply_xiangqi_move(&self.position, mv)?;
        self.position = result.position;
        let key = self.position.position_key();
        *self.position_history.entry(key).or_insert(0) += 1;
        let (white_time, black_time) = self
            .clock
            .as_ref()
            .map(|clock| (clock.white_time, clock.black_time))
            .unwrap_or((None, None));
        let game_move = GameMove {
            uci: uci.to_string(),
            san: result.san,
            fen_after: self.position.to_fen(),
            clock: None,
            white_time,
            black_time,
        };
        self.moves.push(game_move.clone());
        self.check_game_end();
        Ok(game_move)
    }

    fn rebuild_position_from_moves(&mut self) -> Result<(), String> {
        self.position = XiangqiPosition::parse(&self.initial_fen)?;
        self.position_history.clear();
        let key = self.position.position_key();
        self.position_history.insert(key, 1);
        let moves = self.moves.clone();
        self.moves.clear();
        for mv in moves {
            self.apply_move_no_clock(&mv.uci)?;
        }
        if let Some(ref mut clock) = self.clock {
            clock.white_time = self
                .config
                .white_time_control
                .as_ref()
                .map(|tc| tc.initial_time);
            clock.black_time = self
                .config
                .black_time_control
                .as_ref()
                .map(|tc| tc.initial_time);
            if let Some(last_move) = self.moves.last() {
                if last_move.white_time.is_some() || last_move.black_time.is_some() {
                    clock.white_time = last_move.white_time;
                    clock.black_time = last_move.black_time;
                }
            }
            clock.last_tick = Instant::now();
        }
        Ok(())
    }

    fn check_game_end(&mut self) {
        let legal = legal_xiangqi_moves(&self.position);
        if legal.is_empty() {
            self.status = if is_xiangqi_in_check(&self.position, self.position.turn) {
                if self.position.turn == XiangqiColor::Red {
                    GameStatus::Finished {
                        result: GameResult::BlackWins {
                            reason: GameEndReason::Checkmate,
                        },
                    }
                } else {
                    GameStatus::Finished {
                        result: GameResult::WhiteWins {
                            reason: GameEndReason::Checkmate,
                        },
                    }
                }
            } else {
                if self.position.turn == XiangqiColor::Red {
                    GameStatus::Finished {
                        result: GameResult::BlackWins {
                            reason: GameEndReason::NoLegalMove,
                        },
                    }
                } else {
                    GameStatus::Finished {
                        result: GameResult::WhiteWins {
                            reason: GameEndReason::NoLegalMove,
                        },
                    }
                }
            };
            return;
        }

        let rule_policy = xiangqi_rule_policy(self.config.xiangqi_rule);
        if self.position.halfmove >= 120 && rule_policy.natural_draw {
            self.status = GameStatus::Finished {
                result: GameResult::Draw {
                    reason: DrawReason::FiftyMoveRule,
                },
            };
            return;
        }

        if self
            .position_history
            .get(&self.position.position_key())
            .copied()
            .unwrap_or(0)
            >= rule_policy.repetition_occurrences as u32
        {
            self.status = match adjudicate_xiangqi_repetition(
                &self.initial_fen,
                &self.moves,
                self.config.xiangqi_rule,
            ) {
                Some(XiangqiRuleVerdict::Draw(reason)) => GameStatus::Finished {
                    result: GameResult::Draw { reason },
                },
                Some(XiangqiRuleVerdict::RedLoses(reason)) => GameStatus::Finished {
                    result: GameResult::BlackWins { reason },
                },
                Some(XiangqiRuleVerdict::BlackLoses(reason)) => GameStatus::Finished {
                    result: GameResult::WhiteWins { reason },
                },
                None => GameStatus::Playing,
            };
        }
    }

    fn check_timeout(&self) -> Option<GameResult> {
        let Some(clock) = &self.clock else {
            return None;
        };
        let elapsed = clock.last_tick.elapsed().as_millis() as u64;
        if self.position.turn == XiangqiColor::Red {
            if clock
                .white_time
                .map(|wt| wt.saturating_sub(elapsed) == 0)
                .unwrap_or(false)
            {
                return Some(GameResult::BlackWins {
                    reason: GameEndReason::Timeout,
                });
            }
        } else if clock
            .black_time
            .map(|bt| bt.saturating_sub(elapsed) == 0)
            .unwrap_or(false)
        {
            return Some(GameResult::WhiteWins {
                reason: GameEndReason::Timeout,
            });
        }
        None
    }

    fn get_current_times(&self) -> (Option<u64>, Option<u64>) {
        if let Some(clock) = &self.clock {
            let elapsed = clock.last_tick.elapsed().as_millis() as u64;
            let white_time = if self.position.turn == XiangqiColor::Red {
                clock.white_time.map(|time| time.saturating_sub(elapsed))
            } else {
                clock.white_time
            };
            let black_time = if self.position.turn == XiangqiColor::Black {
                clock.black_time.map(|time| time.saturating_sub(elapsed))
            } else {
                clock.black_time
            };
            (white_time, black_time)
        } else {
            (None, None)
        }
    }

    fn reset_clock(&mut self) {
        if let Some(ref mut clock) = self.clock {
            clock.last_tick = Instant::now();
        }
    }

    fn end_game(&mut self, result: GameResult) {
        self.status = GameStatus::Finished { result };
        self.shutdown = true;
        if let Some(pid) = self.white_engine_pid {
            kill_process_by_pid(pid);
        }
        if let Some(pid) = self.black_engine_pid {
            kill_process_by_pid(pid);
        }
    }
}

fn player_name(player: &XiangqiPlayerConfig) -> String {
    match player {
        XiangqiPlayerConfig::Human { name } => name.clone(),
        XiangqiPlayerConfig::Engine { name, .. } => name.clone(),
    }
}

fn emit_game_move_event(window: &Window, game_id: &str, controller: &XiangqiGameController) {
    let (white_time, black_time) = controller.get_current_times();
    let _ = window.emit(
        "game-move-event",
        GameMoveEvent {
            game_id: game_id.to_string(),
            moves: controller.moves.clone(),
            fen: controller.position.to_fen(),
            white_time,
            black_time,
        },
    );
}

fn emit_game_over_event(window: &Window, game_id: &str, result: GameResult, moves: Vec<GameMove>) {
    let _ = window.emit(
        "game-over-event",
        GameOverEvent {
            game_id: game_id.to_string(),
            result,
            moves,
        },
    );
}

fn maybe_start_xiangqi_engine(
    window: &Window,
    game_id: &str,
    controller: &Arc<Mutex<XiangqiGameController>>,
) {
    let should_start = {
        let mut ctrl = match controller.lock() {
            Ok(ctrl) => ctrl,
            Err(_) => return,
        };
        if !ctrl.shutdown
            && ctrl.status == GameStatus::Playing
            && ctrl.is_engine_turn()
            && !ctrl.engine_thinking
        {
            ctrl.engine_thinking = true;
            true
        } else {
            false
        }
    };

    if !should_start {
        return;
    }

    let window = window.clone();
    let game_id = game_id.to_string();
    let controller = controller.clone();
    thread::spawn(move || {
        let result = request_xiangqi_game_engine_move(&game_id, &controller, &window);
        if result.is_err() {
            let mut ctrl = match controller.lock() {
                Ok(ctrl) => ctrl,
                Err(_) => return,
            };
            ctrl.engine_thinking = false;
            if ctrl.shutdown || ctrl.status != GameStatus::Playing {
                return;
            }
            let result = if ctrl.position.turn == XiangqiColor::Red {
                GameResult::BlackWins {
                    reason: GameEndReason::Abandonment,
                }
            } else {
                GameResult::WhiteWins {
                    reason: GameEndReason::Abandonment,
                }
            };
            ctrl.end_game(result.clone());
            emit_game_over_event(&window, &game_id, result, ctrl.moves.clone());
        }
    });
}

fn read_xiangqi_bestmove(engine: &mut XiangqiGameEngine) -> Result<String, String> {
    loop {
        let line = read_line(&mut engine.runtime, &mut engine.logs)?;
        if let Some(bestmove) = parse_bestmove(&line) {
            return Ok(bestmove);
        }
    }
}

fn is_valid_xiangqi_bestmove(bestmove: &str) -> bool {
    let bestmove = bestmove.trim();
    !bestmove.is_empty() && bestmove != "0000" && parse_xiangqi_uci_move(bestmove).is_ok()
}

fn xiangqi_game_has_legal_engine_move(
    controller: &Arc<Mutex<XiangqiGameController>>,
    turn: XiangqiColor,
) -> Result<bool, String> {
    let ctrl = controller
        .lock()
        .map_err(|_| "game controller unavailable".to_string())?;
    if ctrl.shutdown || ctrl.status != GameStatus::Playing || ctrl.position.turn != turn {
        return Ok(false);
    }
    Ok(!legal_xiangqi_moves(&ctrl.position).is_empty())
}

fn find_xiangqi_opening_book_move(
    controller: &Arc<Mutex<XiangqiGameController>>,
) -> Result<Option<(XiangqiColor, String)>, String> {
    let (turn, position, book, ply) = {
        let ctrl = controller
            .lock()
            .map_err(|_| "game controller unavailable".to_string())?;
        if ctrl.shutdown || ctrl.status != GameStatus::Playing || !ctrl.is_engine_turn() {
            return Ok(None);
        }
        let Some(book) = ctrl.opening_book.clone() else {
            return Ok(None);
        };
        (
            ctrl.position.turn,
            ctrl.position.clone(),
            book,
            ctrl.moves.len(),
        )
    };

    if ply >= book.max_ply() {
        return Ok(None);
    }

    let book_moves = match book.query(&position) {
        Ok(book_moves) => book_moves,
        Err(err) => {
            eprintln!("failed to query Xiangqi opening book: {err}");
            return Ok(None);
        }
    };

    for book_move in book_moves {
        let Ok(parsed) = parse_xiangqi_uci_move(&book_move.uci) else {
            continue;
        };
        if apply_xiangqi_move(&position, parsed).is_ok() {
            return Ok(Some((turn, book_move.uci)));
        }
    }

    Ok(None)
}

fn request_xiangqi_game_engine_move(
    game_id: &str,
    controller: &Arc<Mutex<XiangqiGameController>>,
    window: &Window,
) -> Result<(), String> {
    if let Some((book_turn, book_uci)) = find_xiangqi_opening_book_move(controller)? {
        let mut start_next_engine = false;
        {
            let mut ctrl = controller
                .lock()
                .map_err(|_| "game controller unavailable".to_string())?;
            ctrl.engine_thinking = false;
            if ctrl.shutdown
                || ctrl.status != GameStatus::Playing
                || ctrl.position.turn != book_turn
            {
                return Ok(());
            }
            ctrl.apply_move(&book_uci)?;
            emit_game_move_event(window, game_id, &ctrl);
            if let GameStatus::Finished { result } = ctrl.status.clone() {
                ctrl.shutdown = true;
                emit_game_over_event(window, game_id, result, ctrl.moves.clone());
            } else if ctrl.is_engine_turn() {
                start_next_engine = true;
            }
        }

        if start_next_engine {
            maybe_start_xiangqi_engine(window, game_id, controller);
        }

        return Ok(());
    }

    let (turn, initial_fen, moves, go_mode) = {
        let ctrl = controller
            .lock()
            .map_err(|_| "game controller unavailable".to_string())?;
        if ctrl.status != GameStatus::Playing {
            return Ok(());
        }
        let turn = ctrl.position.turn;
        let (white_time, black_time) = ctrl.get_current_times();
        let go = match if turn == XiangqiColor::Red {
            &ctrl.config.white
        } else {
            &ctrl.config.black
        } {
            XiangqiPlayerConfig::Engine { go, .. } => go.clone(),
            _ => return Err("not engine turn".to_string()),
        };
        let current_time = if turn == XiangqiColor::Red {
            white_time
        } else {
            black_time
        };
        let go_mode = if current_time.is_some() {
            let (winc, binc) = ctrl
                .clock
                .as_ref()
                .map(|clock| (clock.white_increment as u32, clock.black_increment as u32))
                .unwrap_or((0, 0));
            GoMode::PlayersTime(PlayersTime {
                white: white_time.unwrap_or(u64::MAX).min(u32::MAX as u64) as u32,
                black: black_time.unwrap_or(u64::MAX).min(u32::MAX as u64) as u32,
                winc,
                binc,
            })
        } else {
            go.unwrap_or(GoMode::Depth(20))
        };
        let moves = ctrl
            .moves
            .iter()
            .map(|mv| mv.uci.clone())
            .collect::<Vec<_>>();
        (turn, ctrl.initial_fen.clone(), moves, go_mode)
    };

    let mut engine = {
        let mut ctrl = controller
            .lock()
            .map_err(|_| "game controller unavailable".to_string())?;
        if turn == XiangqiColor::Red {
            ctrl.white_engine.take()
        } else {
            ctrl.black_engine.take()
        }
        .ok_or_else(|| "engine not initialized".to_string())?
    };

    send_engine_position(
        &mut engine.runtime.stdin,
        &engine.config.protocol,
        &initial_fen,
        &moves,
        &mut engine.logs,
    )?;
    send_engine_go(&mut engine.runtime.stdin, &go_mode, &mut engine.logs)?;

    let mut bestmove = read_xiangqi_bestmove(&mut engine)?;
    if !is_valid_xiangqi_bestmove(&bestmove)
        && xiangqi_game_has_legal_engine_move(controller, turn)?
    {
        engine.logs.push(format!(
            "gui: invalid bestmove {:?}; retrying with go depth 3",
            bestmove
        ));
        send_engine_position(
            &mut engine.runtime.stdin,
            &engine.config.protocol,
            &initial_fen,
            &moves,
            &mut engine.logs,
        )?;
        send_engine_go(
            &mut engine.runtime.stdin,
            &GoMode::Depth(3),
            &mut engine.logs,
        )?;
        bestmove = read_xiangqi_bestmove(&mut engine)?;
    }

    let mut start_next_engine = false;
    {
        let mut ctrl = controller
            .lock()
            .map_err(|_| "game controller unavailable".to_string())?;
        if turn == XiangqiColor::Red {
            ctrl.white_engine = Some(engine);
        } else {
            ctrl.black_engine = Some(engine);
        }
        ctrl.engine_thinking = false;
        if ctrl.shutdown || ctrl.status != GameStatus::Playing || ctrl.position.turn != turn {
            return Ok(());
        }
        if !is_valid_xiangqi_bestmove(&bestmove) {
            return Err("engine returned no legal move".to_string());
        }
        ctrl.apply_move(&bestmove)?;
        emit_game_move_event(window, game_id, &ctrl);
        if let GameStatus::Finished { result } = ctrl.status.clone() {
            ctrl.shutdown = true;
            emit_game_over_event(window, game_id, result, ctrl.moves.clone());
        } else if ctrl.is_engine_turn() {
            start_next_engine = true;
        }
    }

    if start_next_engine {
        maybe_start_xiangqi_engine(window, game_id, controller);
    }

    Ok(())
}

fn xiangqi_game_loop(
    game_id: GameId,
    controller: Arc<Mutex<XiangqiGameController>>,
    window: Window,
) {
    maybe_start_xiangqi_engine(&window, &game_id, &controller);
    loop {
        thread::sleep(Duration::from_millis(100));
        let mut start_engine = false;
        {
            let mut ctrl = match controller.lock() {
                Ok(ctrl) => ctrl,
                Err(_) => break,
            };
            if ctrl.shutdown {
                break;
            }
            if ctrl.status != GameStatus::Playing {
                break;
            }
            if let Some(result) = ctrl.check_timeout() {
                ctrl.end_game(result.clone());
                emit_game_over_event(&window, &game_id, result, ctrl.moves.clone());
                break;
            }
            let (white_time, black_time) = ctrl.get_current_times();
            let _ = window.emit(
                "clock-update-event",
                ClockUpdateEvent {
                    game_id: game_id.clone(),
                    white_time,
                    black_time,
                },
            );
            if ctrl.is_engine_turn() && !ctrl.engine_thinking {
                start_engine = true;
            }
        }
        if start_engine {
            maybe_start_xiangqi_engine(&window, &game_id, &controller);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineLine {
    multipv: u32,
    depth: u32,
    nodes: u64,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChessdbQueryRequest {
    action: String,
    board: String,
    #[serde(default)]
    endgame: bool,
    #[serde(default = "default_chessdb_metric")]
    egtb_metric: String,
}

fn default_chessdb_metric() -> String {
    "dtm".to_string()
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
fn analyze_position(request: AnalyzeRequest) -> Result<EngineAnalysis, String> {
    let mut engine = spawn_engine(&request.engine.path)?;

    let mut logs = Vec::new();
    init_engine(&mut engine, &request.engine, request.multipv, &mut logs)?;
    configure_extra_engine_options(
        &mut engine.stdin,
        &request.engine.protocol,
        &request.extra_options,
        &mut logs,
    )?;
    send_engine_position(
        &mut engine.stdin,
        &request.engine.protocol,
        &request.fen,
        &request.moves,
        &mut logs,
    )?;
    let go_mode = match resolve_go_mode(&request) {
        GoMode::Infinite => GoMode::Depth(request.depth.max(1)),
        other => other,
    };
    send_line(&mut engine, &go_mode.to_uci_string(), &mut logs)?;

    let mut lines = BTreeMap::<u32, EngineLine>::new();
    let mut bestmove = String::new();
    let deadline = Instant::now() + Duration::from_secs(120);

    while Instant::now() < deadline {
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

    let mut lines: Vec<_> = lines.into_values().collect();
    lines.sort_by_key(|line| line.multipv);

    Ok(EngineAnalysis {
        engine_name: request.engine.name.clone(),
        bestmove,
        lines,
        logs,
    })
}

#[tauri::command]
fn start_xiangqi_analysis(
    window: Window,
    state: tauri::State<AppState>,
    request: AnalyzeRequest,
) -> Result<(), String> {
    let request_id = request
        .request_id
        .clone()
        .filter(|value| !value.is_empty())
        .ok_or("analysis request id is required")?;
    let key = request.engine.id.clone();

    let mut processes = state
        .xiangqi_analysis_processes
        .lock()
        .map_err(|_| "analysis process state unavailable".to_string())?;

    if let Some(process_arc) = processes.get(&key).cloned() {
        let mut process_guard = process_arc
            .lock()
            .map_err(|_| "analysis process unavailable".to_string())?;

        if process_guard.engine.path == request.engine.path
            && process_guard.engine.protocol == request.engine.protocol
            && process_guard.is_same_request(&request)
            && process_guard.running
        {
            process_guard.request_id = request_id.clone();
            let progress = xiangqi_process_progress(&process_guard);
            emit_xiangqi_process_update(&window, &process_guard, progress, false);
            return Ok(());
        }

        process_guard.stop()?;
        drop(process_guard);

        let stopped_cleanly = wait_for_stopped_analysis(&process_arc, Duration::from_millis(500))?;
        if !stopped_cleanly {
            if let Some(process_arc) = processes.remove(&key) {
                process_arc
                    .lock()
                    .map_err(|_| "analysis process unavailable".to_string())?
                    .kill();
            }
            let process = spawn_xiangqi_analysis_process(window, request)?;
            processes.insert(key, process);
            return Ok(());
        }

        let mut process_guard = process_arc
            .lock()
            .map_err(|_| "analysis process unavailable".to_string())?;

        if process_guard.engine.path == request.engine.path
            && process_guard.engine.protocol == request.engine.protocol
        {
            process_guard.configure_and_go(request)?;
            return Ok(());
        }
        drop(process_guard);

        if let Some(process_arc) = processes.remove(&key) {
            process_arc
                .lock()
                .map_err(|_| "analysis process unavailable".to_string())?
                .kill();
        }
    }

    let process = spawn_xiangqi_analysis_process(window, request)?;
    processes.insert(key, process);
    Ok(())
}

#[tauri::command]
fn stop_analysis(state: tauri::State<AppState>, request_id: Option<String>) -> Result<(), String> {
    let processes = state
        .xiangqi_analysis_processes
        .lock()
        .map_err(|_| "analysis process state unavailable".to_string())?;

    for process in processes.values() {
        let mut process = process
            .lock()
            .map_err(|_| "analysis process unavailable".to_string())?;
        if request_id
            .as_deref()
            .is_none_or(|request_id| process.request_id == request_id)
        {
            process.stop()?;
        }
    }
    Ok(())
}

#[tauri::command]
fn read_store(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = store_path(&app, &name)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| error.to_string())
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
fn start_game(
    window: Window,
    state: tauri::State<AppState>,
    game_id: String,
    config: XiangqiGameConfig,
) -> Result<GameState, String> {
    abort_game(state.clone(), game_id.clone()).ok();

    let mut controller = XiangqiGameController::new(game_id.clone(), config)?;

    if let XiangqiPlayerConfig::Engine {
        name,
        path,
        protocol,
        options,
        go,
    } = controller.config.white.clone()
    {
        let engine = XiangqiGameEngine::new(name, path, protocol, options, go)?;
        controller.white_engine_pid = Some(engine.runtime.child.id());
        controller.white_engine = Some(engine);
    }

    if let XiangqiPlayerConfig::Engine {
        name,
        path,
        protocol,
        options,
        go,
    } = controller.config.black.clone()
    {
        let engine = XiangqiGameEngine::new(name, path, protocol, options, go)?;
        controller.black_engine_pid = Some(engine.runtime.child.id());
        controller.black_engine = Some(engine);
    }

    controller.reset_clock();
    let game_state = controller.get_state();
    let controller = Arc::new(Mutex::new(controller));
    state
        .xiangqi_games
        .lock()
        .map_err(|_| "game manager unavailable".to_string())?
        .insert(game_id.clone(), controller.clone());

    thread::spawn(move || xiangqi_game_loop(game_id, controller, window));

    Ok(game_state)
}

#[tauri::command]
fn get_game_state(state: tauri::State<AppState>, game_id: String) -> Result<GameState, String> {
    let games = state
        .xiangqi_games
        .lock()
        .map_err(|_| "game manager unavailable".to_string())?;
    let controller = games
        .get(&game_id)
        .ok_or_else(|| format!("game not found: {}", game_id))?;
    let controller = controller
        .lock()
        .map_err(|_| "game controller unavailable".to_string())?;
    Ok(controller.get_state())
}

#[tauri::command]
fn make_game_move(
    window: Window,
    state: tauri::State<AppState>,
    game_id: String,
    uci: String,
) -> Result<GameState, String> {
    let controller = {
        let games = state
            .xiangqi_games
            .lock()
            .map_err(|_| "game manager unavailable".to_string())?;
        games
            .get(&game_id)
            .cloned()
            .ok_or_else(|| format!("game not found: {}", game_id))?
    };

    let mut start_engine = false;
    let state = {
        let mut ctrl = controller
            .lock()
            .map_err(|_| "game controller unavailable".to_string())?;
        if ctrl.is_engine_turn() {
            return Err("not human turn".to_string());
        }
        ctrl.apply_move(&uci)?;
        emit_game_move_event(&window, &game_id, &ctrl);
        if let GameStatus::Finished { result } = ctrl.status.clone() {
            ctrl.shutdown = true;
            emit_game_over_event(&window, &game_id, result, ctrl.moves.clone());
        } else if ctrl.is_engine_turn() {
            start_engine = true;
        }
        ctrl.get_state()
    };

    if start_engine {
        maybe_start_xiangqi_engine(&window, &game_id, &controller);
    }

    Ok(state)
}

#[tauri::command]
fn take_back_game_move(
    window: Window,
    state: tauri::State<AppState>,
    game_id: String,
) -> Result<GameState, String> {
    let controller = {
        let games = state
            .xiangqi_games
            .lock()
            .map_err(|_| "game manager unavailable".to_string())?;
        games
            .get(&game_id)
            .cloned()
            .ok_or_else(|| format!("game not found: {}", game_id))?
    };

    let mut start_engine = false;
    let state = {
        let mut ctrl = controller
            .lock()
            .map_err(|_| "game controller unavailable".to_string())?;
        if ctrl.moves.is_empty() {
            return Err("no moves found".to_string());
        }
        let human_color = match (&ctrl.config.white, &ctrl.config.black) {
            (XiangqiPlayerConfig::Human { .. }, XiangqiPlayerConfig::Engine { .. }) => {
                Some(XiangqiColor::Red)
            }
            (XiangqiPlayerConfig::Engine { .. }, XiangqiPlayerConfig::Human { .. }) => {
                Some(XiangqiColor::Black)
            }
            _ => None,
        };
        let should_pop_two = human_color
            .map(|color| ctrl.position.turn == color)
            .unwrap_or(false);
        ctrl.moves.pop();
        if should_pop_two {
            ctrl.moves.pop();
        }
        ctrl.status = GameStatus::Playing;
        ctrl.shutdown = false;
        ctrl.engine_thinking = false;
        ctrl.rebuild_position_from_moves()?;
        ctrl.check_game_end();
        emit_game_move_event(&window, &game_id, &ctrl);
        if let GameStatus::Finished { result } = ctrl.status.clone() {
            ctrl.shutdown = true;
            emit_game_over_event(&window, &game_id, result, ctrl.moves.clone());
        } else if ctrl.is_engine_turn() {
            start_engine = true;
        }
        ctrl.get_state()
    };

    if start_engine {
        maybe_start_xiangqi_engine(&window, &game_id, &controller);
    }

    Ok(state)
}

#[tauri::command]
fn resign_game(
    window: Window,
    state: tauri::State<AppState>,
    game_id: String,
    color: String,
) -> Result<GameState, String> {
    let controller = {
        let games = state
            .xiangqi_games
            .lock()
            .map_err(|_| "game manager unavailable".to_string())?;
        games
            .get(&game_id)
            .cloned()
            .ok_or_else(|| format!("game not found: {}", game_id))?
    };
    let mut ctrl = controller
        .lock()
        .map_err(|_| "game controller unavailable".to_string())?;
    let result = match color.as_str() {
        "white" | "red" => GameResult::BlackWins {
            reason: GameEndReason::Resignation,
        },
        "black" => GameResult::WhiteWins {
            reason: GameEndReason::Resignation,
        },
        _ => return Err(format!("invalid color: {}", color)),
    };
    ctrl.end_game(result.clone());
    emit_game_over_event(&window, &game_id, result, ctrl.moves.clone());
    Ok(ctrl.get_state())
}

#[tauri::command]
fn abort_game(state: tauri::State<AppState>, game_id: String) -> Result<(), String> {
    let controller = state
        .xiangqi_games
        .lock()
        .map_err(|_| "game manager unavailable".to_string())?
        .remove(&game_id);
    if let Some(controller) = controller {
        let mut ctrl = controller
            .lock()
            .map_err(|_| "game controller unavailable".to_string())?;
        ctrl.shutdown = true;
        if let Some(pid) = ctrl.white_engine_pid {
            kill_process_by_pid(pid);
        }
        if let Some(pid) = ctrl.black_engine_pid {
            kill_process_by_pid(pid);
        }
        if let Some(engine) = ctrl.white_engine.as_mut() {
            engine.quit();
        }
        if let Some(engine) = ctrl.black_engine.as_mut() {
            engine.quit();
        }
    }
    Ok(())
}

#[tauri::command]
fn get_game_engine_logs(
    state: tauri::State<AppState>,
    game_id: String,
    color: String,
) -> Result<Vec<EngineLogEvent>, String> {
    let games = state
        .xiangqi_games
        .lock()
        .map_err(|_| "game manager unavailable".to_string())?;
    let controller = games
        .get(&game_id)
        .ok_or_else(|| format!("game not found: {}", game_id))?;
    let ctrl = controller
        .lock()
        .map_err(|_| "game controller unavailable".to_string())?;
    let engine = match color.as_str() {
        "white" | "red" => &ctrl.white_engine,
        "black" => &ctrl.black_engine,
        _ => return Err(format!("invalid color: {}", color)),
    };
    Ok(engine
        .as_ref()
        .map(|engine| engine.get_logs())
        .unwrap_or_default())
}

#[tauri::command]
fn get_engine_config(
    path: PathBuf,
    protocol: Option<EngineProtocol>,
) -> Result<EngineConfig, String> {
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

#[tauri::command]
fn query_chessdb(request: ChessdbQueryRequest) -> Result<String, String> {
    let action = request.action.trim().to_lowercase();
    if !matches!(
        action.as_str(),
        "querybest" | "query" | "querysearch" | "queryall" | "queryscore" | "querypv"
    ) {
        return Err("unsupported chessdb action".to_string());
    }

    let metric = request.egtb_metric.trim().to_lowercase();
    if !matches!(metric.as_str(), "dtm" | "dtc") {
        return Err("unsupported chessdb tablebase metric".to_string());
    }

    let mut path = format!(
        "/chessdb.php?action={}&learn=0&egtbmetric={}&board={}",
        percent_encode_query(&action),
        percent_encode_query(&metric),
        percent_encode_query(request.board.trim())
    );
    if request.endgame {
        path.push_str("&endgame=1");
    }

    http_get_chessdb(&path)
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
            start_xiangqi_analysis,
            stop_analysis,
            read_store,
            write_store,
            file_exists,
            get_file_metadata,
            write_game,
            write_db_game,
            preload_reference_db,
            kill_engines,
            start_game,
            get_game_state,
            make_game_move,
            take_back_game_move,
            resign_game,
            abort_game,
            get_game_engine_logs,
            get_engine_config,
            query_chessdb
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

fn http_get_chessdb(path: &str) -> Result<String, String> {
    let address = "www.chessdb.cn:80"
        .to_socket_addrs()
        .map_err(|error| format!("failed to resolve chessdb.cn: {}", error))?
        .next()
        .ok_or("failed to resolve chessdb.cn".to_string())?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(10))
        .map_err(|error| format!("failed to connect to chessdb.cn: {}", error))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(20)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(10)))
        .map_err(|error| error.to_string())?;

    let request = format!(
        "GET {} HTTP/1.1\r\nHost: www.chessdb.cn\r\nUser-Agent: cn-croissant/0.1\r\nConnection: close\r\n\r\n",
        path
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| error.to_string())?;

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|error| error.to_string())?;
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or("invalid chessdb response".to_string())?;
    let headers = String::from_utf8_lossy(&response[..header_end]);
    if !headers.starts_with("HTTP/1.1 200") && !headers.starts_with("HTTP/1.0 200") {
        return Err(headers
            .lines()
            .next()
            .unwrap_or("chessdb request failed")
            .to_string());
    }
    let mut body = response[header_end + 4..].to_vec();
    if headers
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked")
    {
        body = decode_chunked_body(&body)?;
    }
    let body = String::from_utf8_lossy(&body);
    Ok(body.trim_matches('\0').trim().to_string())
}

fn decode_chunked_body(body: &[u8]) -> Result<Vec<u8>, String> {
    let mut cursor = 0;
    let mut decoded = Vec::new();

    loop {
        let size_end = find_crlf(body, cursor).ok_or("invalid chunked chessdb response")?;
        let size_text = String::from_utf8_lossy(&body[cursor..size_end]);
        let size_hex = size_text.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_hex, 16)
            .map_err(|_| "invalid chunk size in chessdb response".to_string())?;
        cursor = size_end + 2;
        if size == 0 {
            break;
        }
        let chunk_end = cursor + size;
        if chunk_end > body.len() {
            return Err("truncated chunked chessdb response".to_string());
        }
        decoded.extend_from_slice(&body[cursor..chunk_end]);
        cursor = chunk_end;
        if body.get(cursor..cursor + 2) == Some(b"\r\n") {
            cursor += 2;
        }
    }

    Ok(decoded)
}

fn find_crlf(bytes: &[u8], start: usize) -> Option<usize> {
    bytes
        .get(start..)?
        .windows(2)
        .position(|window| window == b"\r\n")
        .map(|index| start + index)
}

fn percent_encode_query(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

struct EngineRuntime {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    child: Child,
}

struct XiangqiAnalysisProcess {
    stdin: ChildStdin,
    child: Child,
    engine: LocalEngineConfig,
    fen: String,
    moves: Vec<String>,
    depth: u32,
    go_mode: GoMode,
    multipv: u32,
    extra_options: Vec<EngineOption>,
    request_id: String,
    lines: BTreeMap<u32, EngineLine>,
    bestmove: String,
    logs: Vec<String>,
    running: bool,
    waiting_for_stopped_bestmove: bool,
    started_at: Instant,
    last_depth: u32,
    last_emit_at: Instant,
}

impl XiangqiAnalysisProcess {
    fn is_same_request(&self, request: &AnalyzeRequest) -> bool {
        self.fen == request.fen
            && self.moves == request.moves
            && self.depth == request.depth
            && self.go_mode == resolve_go_mode(request)
            && self.multipv == request.multipv
            && self.engine.threads == request.engine.threads
            && self.engine.hash == request.engine.hash
            && self.engine.move_time_ms == request.engine.move_time_ms
            && self.extra_options == request.extra_options
    }

    fn configure_and_go(&mut self, request: AnalyzeRequest) -> Result<(), String> {
        self.request_id = request.request_id.clone().unwrap_or_default();
        self.engine = request.engine.clone();
        self.fen = request.fen.clone();
        self.moves = request.moves.clone();
        self.depth = request.depth;
        self.go_mode = resolve_go_mode(&request);
        self.multipv = request.multipv;
        self.extra_options = request.extra_options.clone();
        self.lines.clear();
        self.bestmove.clear();
        self.logs.clear();
        self.last_depth = 0;
        self.waiting_for_stopped_bestmove = false;

        configure_engine_options(
            &mut self.stdin,
            &request.engine.protocol,
            request.engine.threads,
            request.engine.hash,
            request.multipv,
            &mut self.logs,
        )?;
        configure_extra_engine_options(
            &mut self.stdin,
            &request.engine.protocol,
            &request.extra_options,
            &mut self.logs,
        )?;
        send_engine_position(
            &mut self.stdin,
            &request.engine.protocol,
            &request.fen,
            &request.moves,
            &mut self.logs,
        )?;
        send_engine_go(&mut self.stdin, &self.go_mode, &mut self.logs)?;
        self.running = true;
        self.started_at = Instant::now();
        self.last_emit_at = self.started_at;
        Ok(())
    }

    fn stop(&mut self) -> Result<(), String> {
        if self.running {
            send_engine_line(&mut self.stdin, "stop", &mut self.logs)?;
            self.running = false;
            self.waiting_for_stopped_bestmove = true;
        }
        Ok(())
    }

    fn kill(&mut self) {
        let _ = send_engine_line(&mut self.stdin, "quit", &mut self.logs);
        let _ = self.child.kill();
    }
}

fn spawn_engine(path: &str) -> Result<EngineRuntime, String> {
    let path = PathBuf::from(path);
    let mut command = Command::new(&path);
    if let Some(parent) = path.parent() {
        command.current_dir(parent);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

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

fn spawn_xiangqi_analysis_process(
    window: Window,
    request: AnalyzeRequest,
) -> Result<Arc<Mutex<XiangqiAnalysisProcess>>, String> {
    let mut engine = spawn_engine(&request.engine.path)?;
    let mut logs = Vec::new();
    init_engine(&mut engine, &request.engine, request.multipv, &mut logs)?;

    let mut process = XiangqiAnalysisProcess {
        stdin: engine.stdin,
        child: engine.child,
        engine: request.engine.clone(),
        fen: String::new(),
        moves: Vec::new(),
        depth: request.depth,
        go_mode: resolve_go_mode(&request),
        multipv: request.multipv,
        extra_options: Vec::new(),
        request_id: String::new(),
        lines: BTreeMap::new(),
        bestmove: String::new(),
        logs,
        running: false,
        waiting_for_stopped_bestmove: false,
        started_at: Instant::now(),
        last_depth: 0,
        last_emit_at: Instant::now(),
    };
    process.configure_and_go(request)?;

    let process = Arc::new(Mutex::new(process));
    let reader_process = process.clone();
    thread::spawn(move || read_xiangqi_analysis_loop(window, engine.stdout, reader_process));

    Ok(process)
}

fn read_xiangqi_analysis_loop(
    window: Window,
    mut stdout: BufReader<ChildStdout>,
    process: Arc<Mutex<XiangqiAnalysisProcess>>,
) {
    loop {
        let mut line = String::new();
        let bytes = match stdout.read_line(&mut line) {
            Ok(bytes) => bytes,
            Err(_) => break,
        };
        if bytes == 0 {
            break;
        }
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        let mut process = match process.lock() {
            Ok(process) => process,
            Err(_) => break,
        };
        process.logs.push(format!("engine: {}", line));

        if let Some(bestmove) = parse_bestmove(&line) {
            if process.waiting_for_stopped_bestmove {
                process.waiting_for_stopped_bestmove = false;
                process.bestmove = bestmove;
                continue;
            }
            process.bestmove = bestmove;
            process.running = false;
            emit_xiangqi_process_update(&window, &process, 100.0, true);
            continue;
        }

        let Some(info) = parse_info_line(&line) else {
            continue;
        };

        let multipv = info.multipv;
        let depth = info.depth;
        process.lines.insert(multipv, info);

        if depth < process.last_depth {
            continue;
        }

        let expected_multipv = process.multipv.max(1);
        let has_complete_depth = process.lines.len() >= expected_multipv as usize
            && process.lines.values().all(|line| line.depth == depth);
        let has_best_line = process.lines.contains_key(&1);
        if !has_complete_depth && !(expected_multipv == 1 && has_best_line) {
            continue;
        }

        if process.last_emit_at.elapsed() < Duration::from_millis(200)
            && depth == process.last_depth
        {
            continue;
        }

        let progress = xiangqi_process_progress(&process);
        emit_xiangqi_process_update(&window, &process, progress, false);
        process.last_depth = depth;
        process.last_emit_at = Instant::now();
    }
}

fn wait_for_stopped_analysis(
    process: &Arc<Mutex<XiangqiAnalysisProcess>>,
    timeout: Duration,
) -> Result<bool, String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        {
            let process = process
                .lock()
                .map_err(|_| "analysis process unavailable".to_string())?;
            if !process.waiting_for_stopped_bestmove {
                return Ok(true);
            }
        }
        thread::sleep(Duration::from_millis(10));
    }
    Ok(false)
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
            configure_engine_options(
                &mut engine.stdin,
                &config.protocol,
                config.threads,
                config.hash,
                multipv,
                logs,
            )?;
            send_line(engine, "isready", logs)?;
            wait_for(engine, "readyok", logs)?;
            send_line(engine, "ucinewgame", logs)?;
        }
        EngineProtocol::Ucci => {
            send_line(engine, "ucci", logs)?;
            wait_for(engine, "ucciok", logs)?;
            configure_engine_options(
                &mut engine.stdin,
                &config.protocol,
                config.threads,
                config.hash,
                multipv,
                logs,
            )?;
        }
    }
    Ok(())
}

fn configure_engine_options(
    stdin: &mut ChildStdin,
    protocol: &EngineProtocol,
    threads: Option<u32>,
    hash: Option<u32>,
    multipv: u32,
    logs: &mut Vec<String>,
) -> Result<(), String> {
    match protocol {
        EngineProtocol::Uci => {
            if let Some(threads) = threads.filter(|value| *value > 0) {
                send_engine_line(
                    stdin,
                    &format!("setoption name Threads value {}", threads),
                    logs,
                )
                .ok();
            }
            if let Some(hash) = hash.filter(|value| *value > 0) {
                send_engine_line(stdin, &format!("setoption name Hash value {}", hash), logs).ok();
            }
            send_engine_line(
                stdin,
                &format!("setoption name MultiPV value {}", multipv.max(1)),
                logs,
            )
            .ok();
        }
        EngineProtocol::Ucci => {
            if let Some(threads) = threads.filter(|value| *value > 0) {
                send_engine_line(stdin, &format!("setoption Threads {}", threads), logs).ok();
            }
            if let Some(hash) = hash.filter(|value| *value > 0) {
                send_engine_line(stdin, &format!("setoption Hash {}", hash), logs).ok();
            }
            send_engine_line(
                stdin,
                &format!("setoption name MultiPV value {}", multipv.max(1)),
                logs,
            )
            .ok();
        }
    }
    Ok(())
}

fn configure_extra_engine_options(
    stdin: &mut ChildStdin,
    protocol: &EngineProtocol,
    options: &[EngineOption],
    logs: &mut Vec<String>,
) -> Result<(), String> {
    for option in options {
        if option.name.trim().is_empty() {
            continue;
        }
        let command = match protocol {
            EngineProtocol::Uci => {
                format!("setoption name {} value {}", option.name, option.value)
            }
            EngineProtocol::Ucci => format!("setoption {} {}", option.name, option.value),
        };
        send_engine_line(stdin, &command, logs).ok();
    }
    Ok(())
}

fn send_engine_position(
    stdin: &mut ChildStdin,
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
    send_engine_line(stdin, &command, logs)
}

fn send_engine_go(
    stdin: &mut ChildStdin,
    go_mode: &GoMode,
    logs: &mut Vec<String>,
) -> Result<(), String> {
    send_engine_line(stdin, &go_mode.to_uci_string(), logs)
}

fn resolve_go_mode(request: &AnalyzeRequest) -> GoMode {
    if let Some(go_mode) = request.go_mode.clone() {
        return match go_mode {
            GoMode::Depth(depth) => GoMode::Depth(depth.max(1)),
            GoMode::Time(time) => GoMode::Time(time.max(1)),
            GoMode::Nodes(nodes) => GoMode::Nodes(nodes.max(1)),
            GoMode::PlayersTime(players_time) => GoMode::PlayersTime(players_time),
            GoMode::Infinite => GoMode::Infinite,
        };
    }

    if let Some(move_time_ms) = request.engine.move_time_ms.filter(|value| *value > 0) {
        GoMode::Time(move_time_ms)
    } else {
        GoMode::Depth(request.depth.max(1))
    }
}

fn send_line(engine: &mut EngineRuntime, line: &str, logs: &mut Vec<String>) -> Result<(), String> {
    send_engine_line(&mut engine.stdin, line, logs)
}

fn send_engine_line(
    stdin: &mut ChildStdin,
    line: &str,
    logs: &mut Vec<String>,
) -> Result<(), String> {
    logs.push(format!("gui: {}", line));
    writeln!(stdin, "{}", line).map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())
}

fn wait_for(
    engine: &mut EngineRuntime,
    expected: &str,
    logs: &mut Vec<String>,
) -> Result<(), String> {
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
    let mut nodes = 0;
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
                multipv = tokens
                    .get(i + 1)
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(1);
                i += 2;
            }
            "nodes" => {
                nodes = tokens
                    .get(i + 1)
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0);
                i += 2;
            }
            "score" => {
                let kind = tokens.get(i + 1).copied().unwrap_or("");
                let value = tokens.get(i + 2).copied().unwrap_or("");
                score = format!("{} {}", kind, value);
                i += 3;
            }
            "pv" => {
                pv = tokens[i + 1..]
                    .iter()
                    .map(|value| value.to_string())
                    .collect();
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
        nodes,
        score,
        pv,
    })
}

fn xiangqi_process_progress(process: &XiangqiAnalysisProcess) -> f64 {
    match &process.go_mode {
        GoMode::Time(move_time_ms) => {
            ((process.started_at.elapsed().as_millis() as f64 / *move_time_ms as f64) * 100.0)
                .clamp(0.0, 99.9)
        }
        GoMode::Depth(depth) => {
            let max_depth = process
                .lines
                .values()
                .map(|line| line.depth)
                .max()
                .unwrap_or(0);
            ((max_depth as f64 / (*depth).max(1) as f64) * 100.0).clamp(0.0, 99.9)
        }
        GoMode::Nodes(nodes) => {
            let max_nodes = process
                .lines
                .values()
                .map(|line| line.nodes)
                .max()
                .unwrap_or(0);
            ((max_nodes as f64 / (*nodes).max(1) as f64) * 100.0).clamp(0.0, 99.9)
        }
        GoMode::PlayersTime(_) | GoMode::Infinite => {
            if process.lines.is_empty() {
                0.0
            } else {
                99.9
            }
        }
    }
}

fn emit_xiangqi_process_update(
    window: &Window,
    process: &XiangqiAnalysisProcess,
    progress: f64,
    finished: bool,
) {
    if process.request_id.is_empty() {
        return;
    }

    let mut sorted_lines: Vec<_> = process.lines.values().cloned().collect();
    sorted_lines.sort_by_key(|line| line.multipv);

    let _ = window.emit(
        "xiangqi_analysis_update",
        EngineAnalysisUpdate {
            request_id: process.request_id.clone(),
            engine_id: process.engine.id.clone(),
            fen: process.fen.clone(),
            progress,
            finished,
            analysis: EngineAnalysis {
                engine_name: process.engine.name.clone(),
                bestmove: process.bestmove.clone(),
                lines: sorted_lines,
                logs: process.logs.clone(),
            },
        },
    );
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
    text[start..]
        .split_whitespace()
        .next()
        .map(ToString::to_string)
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
