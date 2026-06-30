use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde::Deserialize;

use crate::{
    xiangqi_zobrist_table::{XIANGQI_OBK_ZOBRIST_PLAYER, XIANGQI_OBK_ZOBRIST_TABLE},
    XiangqiColor, XiangqiPiece, XiangqiPosition, XiangqiRole, XIANGQI_FILES,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XiangqiOpeningBookConfig {
    pub path: String,
    #[serde(default = "default_opening_book_max_ply")]
    pub max_ply: usize,
}

fn default_opening_book_max_ply() -> usize {
    40
}

#[derive(Debug, Clone)]
pub(crate) struct XiangqiOpeningBook {
    path: PathBuf,
    kind: XiangqiOpeningBookKind,
    max_ply: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum XiangqiOpeningBookKind {
    BhObk,
    Xqb,
    PfBook,
}

#[derive(Debug, Clone)]
pub(crate) struct XiangqiBookMove {
    pub uci: String,
    score: i32,
    win: i32,
    draw: i32,
    lost: i32,
}

impl XiangqiBookMove {
    fn win_rate_score(&self) -> i32 {
        let total = self.win + self.draw + self.lost;
        if total <= 0 {
            return 0;
        }
        ((self.win * 2 + self.draw) * 10_000) / (total * 2)
    }
}

impl XiangqiOpeningBook {
    pub(crate) fn new(config: XiangqiOpeningBookConfig) -> Result<Self, String> {
        let path = PathBuf::from(config.path);
        if !path.exists() {
            return Err(format!("opening book does not exist: {}", path.display()));
        }
        let kind = opening_book_kind(&path)?;
        Ok(Self {
            path,
            kind,
            max_ply: config.max_ply.max(1),
        })
    }

    pub(crate) fn max_ply(&self) -> usize {
        self.max_ply
    }

    pub(crate) fn query(&self, position: &XiangqiPosition) -> Result<Vec<XiangqiBookMove>, String> {
        let connection = Connection::open(&self.path)
            .map_err(|err| format!("failed to open opening book {}: {err}", self.path.display()))?;

        let mut moves = match self.kind {
            XiangqiOpeningBookKind::BhObk => query_obk_like(&connection, "bhobk", position, true)?,
            XiangqiOpeningBookKind::PfBook => {
                query_obk_like(&connection, "pfBook", position, false)?
            }
            XiangqiOpeningBookKind::Xqb => query_xqb(&connection, position)?,
        };
        moves.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| right.win_rate_score().cmp(&left.win_rate_score()))
        });
        Ok(moves)
    }
}

fn opening_book_kind(path: &Path) -> Result<XiangqiOpeningBookKind, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "obk" => Ok(XiangqiOpeningBookKind::BhObk),
        "xqb" => Ok(XiangqiOpeningBookKind::Xqb),
        "pfbook" => Ok(XiangqiOpeningBookKind::PfBook),
        _ => Err("unsupported Xiangqi opening book format. Use .obk, .xqb, or .pfBook".to_string()),
    }
}

fn query_obk_like(
    connection: &Connection,
    table: &str,
    position: &XiangqiPosition,
    obk_real_key_fallback: bool,
) -> Result<Vec<XiangqiBookMove>, String> {
    let mut moves = Vec::new();
    for left_right_swap in [false, true] {
        let key = obk_zobrist(position, left_right_swap);
        query_obk_key(
            connection,
            table,
            key,
            left_right_swap,
            obk_real_key_fallback,
            &mut moves,
        )?;
    }
    Ok(moves)
}

fn query_obk_key(
    connection: &Connection,
    table: &str,
    key: u64,
    left_right_swap: bool,
    obk_real_key_fallback: bool,
    moves: &mut Vec<XiangqiBookMove>,
) -> Result<(), String> {
    let signed_key = key as i64;
    let use_real_key = obk_real_key_fallback && signed_key < 0;

    let sql = if use_real_key {
        format!(
            "SELECT vmove, vscore, vwin, vdraw, vlost FROM {table} \
             WHERE cast(vkey as double) = ?1 AND vvalid = 1"
        )
    } else if table.eq_ignore_ascii_case("bhobk") {
        format!(
            "SELECT vmove, vscore, vwin, vdraw, vlost FROM {table} \
             WHERE cast(vkey as integer) = ?1 AND vvalid = 1"
        )
    } else {
        format!(
            "SELECT vmove, vscore, vwin, vdraw, vlost FROM {table} \
             WHERE vkey = ?1 AND vvalid = 1"
        )
    };
    let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;

    if use_real_key {
        let rows = statement
            .query_map(params![f64::from_bits(key)], read_obk_row)
            .map_err(|err| err.to_string())?;
        for row in rows {
            if let Some(book_move) =
                decode_obk_row(row.map_err(|err| err.to_string())?, left_right_swap)
            {
                moves.push(book_move);
            }
        }
    } else {
        let rows = statement
            .query_map(params![signed_key], read_obk_row)
            .map_err(|err| err.to_string())?;
        for row in rows {
            if let Some(book_move) =
                decode_obk_row(row.map_err(|err| err.to_string())?, left_right_swap)
            {
                moves.push(book_move);
            }
        }
    }

    Ok(())
}

fn read_obk_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ObkRow> {
    Ok(ObkRow {
        vmove: row.get("vmove")?,
        score: row.get("vscore")?,
        win: row.get("vwin")?,
        draw: row.get("vdraw")?,
        lost: row.get("vlost")?,
    })
}

#[derive(Debug, Clone, Copy)]
struct ObkRow {
    vmove: i32,
    score: i32,
    win: i32,
    draw: i32,
    lost: i32,
}

fn decode_obk_row(row: ObkRow, left_right_swap: bool) -> Option<XiangqiBookMove> {
    let uci = decode_obk_move(row.vmove, left_right_swap)?;
    Some(XiangqiBookMove {
        uci,
        score: row.score,
        win: row.win,
        draw: row.draw,
        lost: row.lost,
    })
}

pub(crate) fn obk_zobrist(position: &XiangqiPosition, left_right_swap: bool) -> u64 {
    let mut zobrist = 0u64;
    for fen_row in 0..10 {
        let rank = 9 - fen_row;
        for file in 0..9 {
            let Some(piece) = position.board[rank][file] else {
                continue;
            };
            let table_piece = obk_piece_code(piece);
            let table_file = if left_right_swap { 8 - file } else { file };
            let square = OBK_C90[fen_row * 9 + table_file] as usize;
            zobrist ^= XIANGQI_OBK_ZOBRIST_TABLE[table_piece * 256 + square];
        }
    }
    if position.turn == XiangqiColor::Red {
        zobrist ^= XIANGQI_OBK_ZOBRIST_PLAYER;
    }
    zobrist
}

fn obk_piece_code(piece: XiangqiPiece) -> usize {
    let offset = if piece.color == XiangqiColor::Red {
        0
    } else {
        7
    };
    offset
        + match piece.role {
            XiangqiRole::King => 0,
            XiangqiRole::Advisor => 1,
            XiangqiRole::Elephant => 2,
            XiangqiRole::Horse => 3,
            XiangqiRole::Rook => 4,
            XiangqiRole::Cannon => 5,
            XiangqiRole::Pawn => 6,
        }
}

fn decode_obk_move(vmove: i32, left_right_swap: bool) -> Option<String> {
    let mut from = (vmove >> 8) & 0xff;
    let mut to = vmove & 0xff;
    if left_right_swap {
        from = mirror_obk_square(from);
        to = mirror_obk_square(to);
    }
    let from = obk_square_to_uci(from)?;
    let to = obk_square_to_uci(to)?;
    Some(format!("{from}{to}"))
}

fn mirror_obk_square(square: i32) -> i32 {
    (square & !15) | (14 - (square & 15))
}

fn obk_square_to_uci(square: i32) -> Option<String> {
    let file = (square & 0x0f) - 3;
    let row_from_top = (square >> 4) - 3;
    if !(0..9).contains(&file) || !(0..10).contains(&row_from_top) {
        return None;
    }
    let rank = 9 - row_from_top;
    Some(format!("{}{}", XIANGQI_FILES[file as usize], rank))
}

fn query_xqb(
    connection: &Connection,
    position: &XiangqiPosition,
) -> Result<Vec<XiangqiBookMove>, String> {
    let key = xqb_key_from_fen(&position.to_fen())?;
    let mut statement = connection
        .prepare("SELECT Move, Score, Win, Draw, Lost FROM book WHERE key = ?1")
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map(params![key.bytes], |row| {
            Ok(XqbRow {
                raw_move: row.get("Move")?,
                score: row.get("Score")?,
                win: row.get("Win")?,
                draw: row.get("Draw")?,
                lost: row.get("Lost")?,
            })
        })
        .map_err(|err| err.to_string())?;
    let mut moves = Vec::new();
    for row in rows {
        let row = row.map_err(|err| err.to_string())?;
        let mirrored = mirror_xqb_move(
            row.raw_move,
            key.mirror_ud,
            key.mirror_lr,
            key.rows,
            key.cols,
        );
        let Some(uci) = decode_xqb_move(mirrored, key.rows, key.cols) else {
            continue;
        };
        moves.push(XiangqiBookMove {
            uci,
            score: row.score,
            win: row.win,
            draw: row.draw,
            lost: row.lost,
        });
    }
    Ok(moves)
}

#[derive(Debug, Clone, Copy)]
struct XqbRow {
    raw_move: i32,
    score: i32,
    win: i32,
    draw: i32,
    lost: i32,
}

struct XqbKey {
    bytes: Vec<u8>,
    mirror_ud: bool,
    mirror_lr: bool,
    rows: usize,
    cols: usize,
}

fn xqb_key_from_fen(fen: &str) -> Result<XqbKey, String> {
    let board_text = fen
        .split_whitespace()
        .next()
        .ok_or_else(|| "missing XQB FEN board".to_string())?;
    let turn_text = fen.split_whitespace().nth(1).unwrap_or("w");
    let turn = if turn_text.eq_ignore_ascii_case("b") {
        0
    } else {
        1
    };
    let rows_text = board_text.split('/').collect::<Vec<_>>();
    let rows = rows_text.len();
    let cols = rows_text
        .first()
        .map(|row| fen_rank_width(row))
        .unwrap_or(0);
    if rows == 0 || cols == 0 || rows_text.iter().any(|row| fen_rank_width(row) != cols) {
        return Err("invalid XQB FEN board".to_string());
    }

    let mut board = vec![-1i8; rows * cols];
    for (row, row_text) in rows_text.iter().enumerate() {
        let mut col = 0usize;
        for ch in row_text.chars() {
            if ch.is_ascii_digit() {
                col += ch.to_digit(10).unwrap_or(0) as usize;
            } else {
                let mapped = if turn == 0 { flip_ascii_case(ch) } else { ch };
                let piece = xqb_piece_code(mapped)
                    .ok_or_else(|| format!("invalid XQB piece in FEN: {ch}"))?;
                if col >= cols {
                    return Err("invalid XQB FEN board".to_string());
                }
                board[row * cols + col] = piece as i8;
                col += 1;
            }
        }
    }

    let mut mirror_ud = false;
    if turn == 0 {
        for row in 0..rows / 2 {
            for col in 0..cols {
                let left = row * cols + col;
                let right = (rows - 1 - row) * cols + (cols - 1 - col);
                board.swap(left, right);
            }
        }
        mirror_ud = true;
    }

    let mut mirror_lr = false;
    'outer: for row in 0..rows {
        for col in 0..cols / 2 {
            let left = row * cols + col;
            let right = row * cols + (cols - 1 - col);
            if board[left] != board[right] {
                mirror_lr = board[right] > board[left];
                break 'outer;
            }
        }
    }
    if mirror_lr {
        for row in 0..rows {
            for col in 0..cols / 2 {
                let left = row * cols + col;
                let right = row * cols + (cols - 1 - col);
                board.swap(left, right);
            }
        }
    }

    Ok(XqbKey {
        bytes: pack_xqb_key(&board),
        mirror_ud,
        mirror_lr,
        rows,
        cols,
    })
}

fn fen_rank_width(rank: &str) -> usize {
    rank.chars()
        .map(|ch| {
            if ch.is_ascii_digit() {
                ch.to_digit(10).unwrap_or(0) as usize
            } else {
                1
            }
        })
        .sum()
}

fn flip_ascii_case(ch: char) -> char {
    if ch.is_ascii_lowercase() {
        ch.to_ascii_uppercase()
    } else if ch.is_ascii_uppercase() {
        ch.to_ascii_lowercase()
    } else {
        ch
    }
}

fn xqb_piece_code(ch: char) -> Option<u8> {
    Some(match ch {
        'X' | 'x' => 0,
        'R' => 1,
        'N' => 2,
        'B' => 3,
        'A' => 4,
        'K' => 5,
        'C' => 6,
        'P' => 7,
        'r' => 9,
        'n' => 10,
        'b' => 11,
        'a' => 12,
        'k' => 13,
        'c' => 14,
        'p' => 15,
        _ => return None,
    })
}

fn pack_xqb_key(board: &[i8]) -> Vec<u8> {
    let mut key = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0usize;
    for (index, piece) in board.iter().enumerate() {
        if *piece == -1 {
            bits += 1;
        } else {
            buffer |= 1 << (32 - bits - 1);
            buffer |= (*piece as u32) << (32 - bits - 1 - 4);
            bits += 5;
        }
        let next_bits = if index == board.len() - 1 {
            0
        } else if board[index + 1] == -1 {
            1
        } else {
            5
        };
        if index == board.len() - 1 || 32 - bits < next_bits {
            let threshold = if index == board.len() - 1 { 1 } else { 8 };
            while bits >= threshold {
                key.push((buffer >> 24) as u8);
                buffer <<= 8;
                bits -= 8;
            }
        }
    }
    key
}

fn mirror_xqb_move(
    raw_move: i32,
    mirror_ud: bool,
    mirror_lr: bool,
    rows: usize,
    cols: usize,
) -> i32 {
    if !mirror_ud && !mirror_lr {
        return raw_move;
    }
    let mut from_row = (raw_move >> 12) & 0x0f;
    let mut from_col = (raw_move >> 8) & 0x0f;
    let mut to_row = (raw_move >> 4) & 0x0f;
    let mut to_col = raw_move & 0x0f;
    if mirror_ud {
        from_row = rows as i32 - 1 - from_row;
        to_row = rows as i32 - 1 - to_row;
        from_col = cols as i32 - 1 - from_col;
        to_col = cols as i32 - 1 - to_col;
    }
    if mirror_lr {
        from_col = cols as i32 - 1 - from_col;
        to_col = cols as i32 - 1 - to_col;
    }
    (from_row << 12) | (from_col << 8) | (to_row << 4) | to_col
}

fn decode_xqb_move(raw_move: i32, rows: usize, cols: usize) -> Option<String> {
    let from = raw_move >> 8;
    let to = raw_move & 0xff;
    let from_row = from >> 4;
    let from_col = from & 0x0f;
    let to_row = to >> 4;
    let to_col = to & 0x0f;
    if !(0..cols as i32).contains(&from_col)
        || !(0..cols as i32).contains(&to_col)
        || !(0..rows as i32).contains(&from_row)
        || !(0..rows as i32).contains(&to_row)
    {
        return None;
    }
    let from_rank = rows as i32 - 1 - from_row;
    let to_rank = rows as i32 - 1 - to_row;
    Some(format!(
        "{}{}{}{}",
        XIANGQI_FILES[from_col as usize], from_rank, XIANGQI_FILES[to_col as usize], to_rank
    ))
}

const OBK_C90: [i32; 90] = [
    0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x4b, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5b, 0x63, 0x64, 0x65, 0x66, 0x67,
    0x68, 0x69, 0x6a, 0x6b, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x7b, 0x83, 0x84, 0x85,
    0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0xa3,
    0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba,
    0xbb, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xcb,
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_book_path(extension: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("cn-croissant-opening-book-{stamp}.{extension}"))
    }

    fn obk_square_from_uci(file: usize, rank: usize) -> i32 {
        let row_from_top = 9 - rank;
        (((row_from_top + 3) as i32) << 4) | ((file + 3) as i32)
    }

    fn obk_move(from_file: usize, from_rank: usize, to_file: usize, to_rank: usize) -> i32 {
        (obk_square_from_uci(from_file, from_rank) << 8) | obk_square_from_uci(to_file, to_rank)
    }

    #[test]
    fn reads_bundled_obk_table() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../engine/database/Obk开局库/素颜芳华 250509.obk");
        if !path.exists() {
            return;
        }

        let connection = Connection::open(path).expect("bundled OBK should open");
        let count: i64 = connection
            .query_row("SELECT count(*) FROM bhobk", [], |row| row.get(0))
            .expect("bhobk table should be queryable");
        let sample: (i64, i32) = connection
            .query_row(
                "SELECT vkey, vmove FROM bhobk WHERE vvalid = 1 LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("bhobk should contain valid moves");
        assert!(count > 0);
        assert_ne!(sample.1, 0);
    }

    #[test]
    fn queries_bundled_obk_initial_position() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../engine/database/Obk开局库/素颜芳华 250509.obk");
        if !path.exists() {
            return;
        }

        let book = XiangqiOpeningBook::new(XiangqiOpeningBookConfig {
            path: path.to_string_lossy().to_string(),
            max_ply: 40,
        })
        .expect("bundled OBK should load");
        let position =
            XiangqiPosition::parse(crate::INITIAL_XIANGQI_FEN).expect("initial FEN should parse");
        let moves = book
            .query(&position)
            .expect("initial position should query bundled OBK");
        assert!(!moves.is_empty());
        assert!(moves.iter().any(|book_move| {
            crate::parse_xiangqi_uci_move(&book_move.uci)
                .and_then(|mv| crate::apply_xiangqi_move(&position, mv).map(|_| ()))
                .is_ok()
        }));
    }

    #[test]
    fn queries_temporary_pfbook_initial_position() {
        let path = temp_book_path("pfBook");
        let position =
            XiangqiPosition::parse(crate::INITIAL_XIANGQI_FEN).expect("initial FEN should parse");
        let key = obk_zobrist(&position, false) as i64;
        let move_c3c4 = obk_move(2, 3, 2, 4);

        {
            let connection = Connection::open(&path).expect("temporary pfBook should be created");
            connection
                .execute(
                    "CREATE TABLE pfBook (
                        vkey INTEGER NOT NULL,
                        vmove INTEGER NOT NULL,
                        vscore INTEGER NOT NULL,
                        vwin INTEGER NOT NULL,
                        vdraw INTEGER NOT NULL,
                        vlost INTEGER NOT NULL,
                        vvalid INTEGER NOT NULL
                    )",
                    [],
                )
                .expect("pfBook table should be created");
            connection
                .execute(
                    "INSERT INTO pfBook (vkey, vmove, vscore, vwin, vdraw, vlost, vvalid)
                     VALUES (?1, ?2, 10, 7, 2, 1, 1)",
                    params![key, move_c3c4],
                )
                .expect("pfBook move should be inserted");
        }

        let book = XiangqiOpeningBook::new(XiangqiOpeningBookConfig {
            path: path.to_string_lossy().to_string(),
            max_ply: 40,
        })
        .expect("temporary pfBook should load");
        let moves = book
            .query(&position)
            .expect("initial position should query temporary pfBook");

        let _ = std::fs::remove_file(&path);
        assert_eq!(
            moves.first().map(|book_move| book_move.uci.as_str()),
            Some("c3c4")
        );
    }
}
