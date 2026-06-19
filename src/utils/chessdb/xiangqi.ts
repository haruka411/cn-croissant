import { commands } from "@/bindings";

export type ChessdbMoveInfo = {
    move: string;
    score: number | null;
    rank: number | null;
    winrate: number | null;
    note: string;
    outcome: ChessdbOutcome | null;
};

export type ChessdbBestMove = {
    move: string;
    kind: "move" | "egtb" | "search";
    raw: string;
};

export type ChessdbPvInfo = {
    score: number | null;
    depth: number | null;
    moves: string[];
    raw: string;
};

export type ChessdbOutcome = {
    result: "win" | "draw" | "loss";
    metric: string;
    distance: number | null;
};

type ChessdbQueryOptions = {
    action: "querybest" | "query" | "querysearch" | "queryall" | "queryscore" | "querypv";
    fen: string;
    endgame?: boolean;
    egtbMetric?: "dtm" | "dtc";
};

const CHESSDB_CACHE_TTL_MS = 5 * 60 * 1000;
const chessdbCache = new Map<string, { value: string; expiresAt: number }>();

export async function queryXiangqiChessdb(options: ChessdbQueryOptions): Promise<string> {
    const cacheKey = [
        options.action,
        chessdbBoardFromFen(options.fen),
        options.endgame ? "egtb" : "cloud",
        options.egtbMetric ?? "dtm",
    ].join("|");
    const cached = chessdbCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const result = await commands.queryChessdb({
        action: options.action,
        board: chessdbBoardFromFen(options.fen),
        endgame: options.endgame ?? false,
        egtbMetric: options.egtbMetric ?? "dtm",
    });
    if (result.status === "error") {
        throw new Error(result.error);
    }
    chessdbCache.set(cacheKey, {
        value: result.data,
        expiresAt: Date.now() + CHESSDB_CACHE_TTL_MS,
    });
    return result.data;
}

export async function queryXiangqiEndgameBestMove(fen: string): Promise<ChessdbBestMove | null> {
    const raw = await queryXiangqiChessdb({
        action: "querybest",
        fen,
        endgame: true,
        egtbMetric: "dtm",
    });
    return parseBestMove(raw);
}

export async function queryXiangqiEndgameMoves(fen: string): Promise<ChessdbMoveInfo[]> {
    const raw = await queryXiangqiChessdb({
        action: "queryall",
        fen,
        endgame: true,
        egtbMetric: "dtm",
    });
    return parseMoveInfos(raw);
}

export async function queryXiangqiPuzzleBestMove(fen: string): Promise<ChessdbBestMove | null> {
    const moves = await queryXiangqiPuzzleMoves(fen);
    const bestMove = moves.find((move) => move.rank !== null && move.rank > 0)?.move;
    if (bestMove) {
        return {
            kind: "move",
            move: bestMove,
            raw: bestMove,
        };
    }

    const pv = await queryXiangqiPuzzlePv(fen);
    const pvMove = pv?.moves[0];
    return pvMove
        ? {
            kind: "search",
            move: pvMove,
            raw: pv.raw,
        }
        : moves[0]?.move
          ? {
              kind: "move",
              move: moves[0].move,
              raw: moves[0].move,
          }
          : null;
}

export async function queryXiangqiPuzzleMoves(fen: string): Promise<ChessdbMoveInfo[]> {
    const raw = await queryXiangqiChessdb({
        action: "queryall",
        fen,
        endgame: false,
        egtbMetric: "dtm",
    });
    return parseMoveInfos(raw);
}

export async function queryXiangqiPuzzlePv(fen: string): Promise<ChessdbPvInfo | null> {
    const raw = await queryXiangqiChessdb({
        action: "querypv",
        fen,
        endgame: false,
        egtbMetric: "dtm",
    });
    return parsePvInfo(raw);
}

export function chessdbBoardFromFen(fen: string): string {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 2) return fen.trim();
    return `${parts[0]} ${parts[1]}`;
}

function parseBestMove(raw: string): ChessdbBestMove | null {
    const clean = cleanChessdbText(raw);
    if (!clean || ["nobestmove", "unknown", "invalid board", "checkmate", "stalemate"].includes(clean)) {
        return null;
    }

    for (const item of clean.split("|")) {
        const [kind, move] = item.split(":");
        if ((kind === "move" || kind === "egtb" || kind === "search") && /^[a-i][0-9][a-i][0-9]$/i.test(move ?? "")) {
            return {
                kind,
                move: move.toLowerCase(),
                raw: clean,
            };
        }
    }
    return null;
}

function parseMoveInfos(raw: string): ChessdbMoveInfo[] {
    const clean = cleanChessdbText(raw);
    if (!clean || ["unknown", "invalid board", "checkmate", "stalemate"].includes(clean)) {
        return [];
    }

    return clean
        .split("|")
        .map((item) => {
            const fields = new Map<string, string>();
            for (const field of item.split(",")) {
                const separator = field.indexOf(":");
                if (separator < 0) continue;
                fields.set(field.slice(0, separator), field.slice(separator + 1));
            }
            const move = fields.get("move") ?? "";
            if (!/^[a-i][0-9][a-i][0-9]$/i.test(move)) return null;
            return {
                move: move.toLowerCase(),
                score: parseOptionalNumber(fields.get("score")),
                rank: parseOptionalNumber(fields.get("rank")),
                winrate: parseOptionalNumber(fields.get("winrate")),
                note: fields.get("note") ?? "",
                outcome: parseChessdbOutcome(fields.get("note") ?? ""),
            };
        })
        .filter((move): move is ChessdbMoveInfo => move !== null);
}

export function topChessdbOutcome(moves: ChessdbMoveInfo[]): ChessdbOutcome | null {
    if (moves.length === 0) return null;
    const bestRank = Math.max(...moves.map((move) => move.rank ?? Number.NEGATIVE_INFINITY));
    return (
        moves.find((move) => move.rank === bestRank && move.outcome)?.outcome ??
        moves.find((move) => move.outcome)?.outcome ??
        null
    );
}

export function parseChessdbOutcome(text: string): ChessdbOutcome | null {
    const match = text.match(/\(([WDL])-([A-Z]+)-(\d+)\)/i);
    if (!match) return null;
    const result = match[1].toUpperCase();
    return {
        result: result === "W" ? "win" : result === "L" ? "loss" : "draw",
        metric: match[2].toUpperCase(),
        distance: parseOptionalNumber(match[3]),
    };
}

function parsePvInfo(raw: string): ChessdbPvInfo | null {
    const clean = cleanChessdbText(raw);
    if (!clean || ["unknown", "invalid board", "checkmate", "stalemate"].includes(clean)) {
        return null;
    }

    const fields = new Map<string, string>();
    for (const field of clean.split(",")) {
        const separator = field.indexOf(":");
        if (separator < 0) continue;
        fields.set(field.slice(0, separator), field.slice(separator + 1));
    }
    const moves = (fields.get("pv") ?? "")
        .trim()
        .split(/\s+/)
        .filter((move) => /^[a-i][0-9][a-i][0-9]$/i.test(move))
        .map((move) => move.toLowerCase());
    if (moves.length === 0) return null;

    return {
        score: parseOptionalNumber(fields.get("score")),
        depth: parseOptionalNumber(fields.get("depth")),
        moves,
        raw: clean,
    };
}

function parseOptionalNumber(value: string | undefined): number | null {
    if (value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function cleanChessdbText(raw: string): string {
    return raw.replaceAll("\u0000", "").trim();
}
