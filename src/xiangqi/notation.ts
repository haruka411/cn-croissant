import {
    applyMove,
    coords,
    createRootNode,
    getNodeAtPath,
    INITIAL_XIANGQI_FEN,
    legalDests,
    makeFen,
    makeUciMove,
    parseFen,
    parseUciMove,
    traverseMainline,
    type GameNode,
    type SavedGame,
    type Square,
    type XiangqiColor,
    type XiangqiMove,
    type XiangqiPosition,
    type XiangqiRole,
} from "./xiangqi";

export type NotationMoveFormat = "coordinate" | "wxf" | "chinese";

export type ParsedNotation = {
    headers: Record<string, string>;
    root: GameNode;
};

export function exportGame(
    game: SavedGame,
    options: { moveFormat?: NotationMoveFormat } = {},
): string {
    const headers: Record<string, string> = {
        Event: game.event || "?",
        Red: game.red || "?",
        Black: game.black || "?",
        Result: game.result || "*",
        FEN: game.root.fen,
        Title: game.title,
    };
    if (game.resultReason) {
        headers.Termination = game.resultReason;
    }

    const headerText = Object.entries(headers)
        .map(([key, value]) => `[${key} "${escapeHeader(value)}"]`)
        .join("\n");
    const moves = formatMainlineMoves(game.root, options.moveFormat ?? "coordinate");

    const moveText = moves
        .map((move, index) => {
            if (index % 2 === 0) {
                return `${Math.floor(index / 2) + 1}. ${move}`;
            }
            return move;
        })
        .join(" ");

    return `${headerText}\n\n${moveText} ${game.result}`.trim();
}

function formatMainlineMoves(root: GameNode, format: NotationMoveFormat): string[] {
    if (format === "coordinate") {
        return traverseMainline(root)
            .slice(1)
            .map((node) => node.move)
            .filter((move): move is string => !!move);
    }

    let position = parseFen(root.fen);
    const moves: string[] = [];
    for (const node of traverseMainline(root).slice(1)) {
        const move = node.move ? parseUciMove(node.move) : null;
        if (!move) break;
        moves.push(formatXiangqiMove(position, move, format));
        position = applyMove(position, move).position;
    }
    return moves;
}

export function formatXiangqiMove(
    position: XiangqiPosition,
    move: XiangqiMove,
    format: NotationMoveFormat = "chinese",
): string {
    if (format === "coordinate") return makeUciMove(move);
    return formatRelativeMove(position, move, format);
}

function formatRelativeMove(
    position: XiangqiPosition,
    move: XiangqiMove,
    format: Exclude<NotationMoveFormat, "coordinate">,
): string {
    const piece = position.board.get(move.from);
    if (!piece) return makeUciMove(move);

    const origin = coords(move.from);
    const dest = coords(move.to);
    const color = piece.color;
    const forwardDelta = color === "red" ? dest.rank - origin.rank : origin.rank - dest.rank;
    const sourceNumber = fileToNumber(origin.file, color);
    let op: "+" | "-" | "=";
    let targetNumber: number;

    if (origin.rank === dest.rank) {
        op = "=";
        targetNumber = fileToNumber(dest.file, color);
    } else if (piece.role === "horse" || piece.role === "elephant" || piece.role === "advisor") {
        op = forwardDelta > 0 ? "+" : "-";
        targetNumber = fileToNumber(dest.file, color);
    } else {
        op = forwardDelta > 0 ? "+" : "-";
        targetNumber = Math.abs(forwardDelta);
    }

    if (format === "wxf") {
        return `${WXF_ROLE_LABELS[piece.role]}${sourceNumber}${op}${targetNumber}`;
    }

    return `${CHINESE_ROLE_LABELS[color][piece.role]}${formatChineseNumber(
        sourceNumber,
        color,
    )}${CHINESE_OP_LABELS[op]}${formatChineseNumber(targetNumber, color)}`;
}

function fileToNumber(file: number, color: XiangqiColor): number {
    return color === "red" ? 9 - file : file + 1;
}

const WXF_ROLE_LABELS: Record<XiangqiRole, string> = {
    king: "K",
    advisor: "A",
    elephant: "E",
    horse: "H",
    rook: "R",
    cannon: "C",
    pawn: "P",
};

const CHINESE_ROLE_LABELS: Record<XiangqiColor, Record<XiangqiRole, string>> = {
    red: {
        king: "帅",
        advisor: "仕",
        elephant: "相",
        horse: "马",
        rook: "车",
        cannon: "炮",
        pawn: "兵",
    },
    black: {
        king: "将",
        advisor: "士",
        elephant: "象",
        horse: "马",
        rook: "车",
        cannon: "炮",
        pawn: "卒",
    },
};

const CHINESE_OP_LABELS: Record<"+" | "-" | "=", string> = {
    "+": "进",
    "-": "退",
    "=": "平",
};

const CHINESE_NUMBER_LABELS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function formatChineseNumber(number: number, color: XiangqiColor): string {
    if (color === "black") return String(number);
    return CHINESE_NUMBER_LABELS[number] ?? String(number);
}

export function parseGameNotation(text: string): ParsedNotation {
    const normalizedText = normalizeNotationText(text);
    const headers = parseHeaders(normalizedText);
    const initialFen = headers.FEN || INITIAL_XIANGQI_FEN;
    let root = createRootNode(makeFen(parseFen(initialFen)));
    let path: number[] = [];
    let position = parseFen(root.fen);

    for (const token of tokenizeMoves(normalizedText)) {
        const move = parseNotationMove(token, position);
        if (!move) continue;
        const result = applyMove(position, move);
        const parent = getNodeAtPath(root, path);
        parent.children.push({
            id: crypto.randomUUID(),
            fen: makeFen(result.position),
            move: makeUciMove(move),
            text: result.san,
            comment: "",
            children: [],
        });
        path = [...path, parent.children.length - 1];
        position = result.position;
    }

    return { headers, root };
}

export function makeGameFromNotation(text: string): SavedGame {
    const parsed = parseGameNotation(text);
    return {
        id: crypto.randomUUID(),
        title: parsed.headers.Title || parsed.headers.Event || "导入棋局",
        event: parsed.headers.Event || "",
        red: parsed.headers.Red || parsed.headers.White || "Red",
        black: parsed.headers.Black || "Black",
        result: parsed.headers.Result || "*",
        root: parsed.root,
        updatedAt: Date.now(),
    };
}

function parseHeaders(text: string): Record<string, string> {
    const headers: Record<string, string> = {};
    const regex = /^\[([A-Za-z0-9_]+)\s+"((?:\\"|[^"])*)"\]\s*$/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
        headers[match[1]] = match[2].replace(/\\"/g, '"');
    }
    return headers;
}

function normalizeNotationText(text: string): string {
    const cblMoves = extractCblMoves(text);
    if (cblMoves.length > 0) {
        const headers = parseXmlLikeHeaders(text);
        const headerText = Object.entries(headers)
            .map(([key, value]) => `[${key} "${escapeHeader(value)}"]`)
            .join("\n");
        return `${headerText}\n\n${cblMoves.join(" ")} *`;
    }
    return text;
}

function extractCblMoves(text: string): string[] {
    const moves: string[] = [];
    const moveTagRegex = /<\s*Move\b[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = moveTagRegex.exec(text))) {
        const tag = match[0];
        const value = /(?:value|move|iccs|coord|step)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
        if (value) moves.push(value);
    }
    return moves;
}

function parseXmlLikeHeaders(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    const mappings: [string, string[]][] = [
        ["Event", ["event", "title", "match"]],
        ["Red", ["red", "redname", "redplayer", "white"]],
        ["Black", ["black", "blackname", "blackplayer"]],
        ["Result", ["result"]],
        ["FEN", ["fen", "initfen"]],
    ];

    for (const [target, names] of mappings) {
        for (const name of names) {
            const attr = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(text)?.[1];
            if (attr) {
                result[target] = attr;
                break;
            }
            const element = new RegExp(
                `<\\s*${name}\\s*>\\s*([^<]+?)\\s*<\\s*/\\s*${name}\\s*>`,
                "i",
            ).exec(text)?.[1];
            if (element) {
                result[target] = element;
                break;
            }
        }
    }
    return result;
}

function tokenizeMoves(text: string): string[] {
    return text
        .replace(/^\[[^\n]*\]\s*$/gm, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\{[^}]*\}/g, " ")
        .replace(/\([^)]*\)/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => token.normalize("NFKC"))
        .map((token) => token.replace(/^\d+\.(\.\.)?/, ""))
        .map((token) =>
            token.replace(/^(?:第)?[0-9０-９一二三四五六七八九十百]+(?:回合|着|手)?[.．、:：]/, ""),
        )
        .map((token) => token.replace(/^(?:红方?|黑方?|紅方?|黑方?|先手|后手|後手)[:：]/, ""))
        .map((token) => token.replace(/^[“"'`]+|[”"'`,，。；;]+$/g, ""))
        .filter(Boolean)
        .filter((token) => !["*", "1-0", "0-1", "1/2-1/2"].includes(token));
}

function parseNotationMove(token: string, position: XiangqiPosition): XiangqiMove | null {
    const coordinateToken = token.normalize("NFKC").replace(/[-_\s]/g, "");
    const coordinateMove = parseUciMove(coordinateToken);
    if (coordinateMove) return coordinateMove;

    return parseRelativeNotationMove(token, position);
}

const ROLE_ALIASES: Record<string, XiangqiRole> = {
    k: "king",
    a: "advisor",
    b: "elephant",
    e: "elephant",
    h: "horse",
    n: "horse",
    r: "rook",
    c: "cannon",
    p: "pawn",
    帅: "king",
    帥: "king",
    将: "king",
    將: "king",
    仕: "advisor",
    士: "advisor",
    相: "elephant",
    象: "elephant",
    马: "horse",
    馬: "horse",
    车: "rook",
    車: "rook",
    炮: "cannon",
    砲: "cannon",
    包: "cannon",
    兵: "pawn",
    卒: "pawn",
};

const CHINESE_NUMBERS: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    壹: 1,
    贰: 2,
    貳: 2,
    叁: 3,
    參: 3,
    肆: 4,
    伍: 5,
    陆: 6,
    陸: 6,
    柒: 7,
    捌: 8,
    玖: 9,
};

function parseRelativeNotationMove(
    rawToken: string,
    position: XiangqiPosition,
): XiangqiMove | null {
    const token = normalizeRelativeToken(rawToken);
    const chars = Array.from(token);
    if (chars.length < 4) return null;

    const relativeSelector = parseRelativeSelector(chars[0]);
    const roleChar = relativeSelector ? chars[1] : chars[0];
    const selector = relativeSelector ? chars[0] : chars[1];
    const op = relativeSelector ? chars[2] : chars[2];
    const target = relativeSelector ? chars[3] : chars[3];
    const role = parseRole(roleChar);
    const targetNumber = parseNumber(target);
    if (!role || !["+", "-", "="].includes(op) || !targetNumber) return null;

    let candidates = Array.from(position.board.entries())
        .filter(([, piece]) => piece.color === position.turn && piece.role === role)
        .map(([sq]) => sq);

    if (relativeSelector) {
        candidates = filterByRelativeSelector(candidates, relativeSelector, position.turn);
    } else {
        const fileNumber = parseNumber(selector);
        if (!fileNumber) return null;
        const sourceFile = fileNumberToFile(fileNumber, position.turn);
        candidates = candidates.filter((sq) => coords(sq).file === sourceFile);
    }

    const dests = legalDests(position);
    const matches: XiangqiMove[] = [];
    for (const from of candidates) {
        for (const to of dests.get(from) ?? []) {
            if (
                matchesRelativeTarget(
                    from,
                    to,
                    role,
                    op as "+" | "-" | "=",
                    targetNumber,
                    position.turn,
                )
            ) {
                matches.push({ from, to });
            }
        }
    }

    return matches[0] ?? null;
}

function normalizeRelativeToken(token: string): string {
    return token
        .normalize("NFKC")
        .replace(/\s/g, "")
        .replace(/[进進]/g, "+")
        .replace(/[退]/g, "-")
        .replace(/[平]/g, "=")
        .replace(/[＋]/g, "+")
        .replace(/[－—]/g, "-")
        .replace(/[＝]/g, "=")
        .replace(/[：:]/g, "")
        .replace(/[“”"'`,，。；;]/g, "");
}

function parseRole(char: string): XiangqiRole | null {
    return ROLE_ALIASES[char] ?? ROLE_ALIASES[char.toLowerCase()] ?? null;
}

function parseNumber(char: string): number | null {
    const normalized = char.normalize("NFKC");
    if (/^[1-9]$/.test(normalized)) return Number(normalized);
    return CHINESE_NUMBERS[char] ?? CHINESE_NUMBERS[normalized] ?? null;
}

function parseRelativeSelector(char: string): "front" | "middle" | "rear" | null {
    if (char === "前") return "front";
    if (char === "中") return "middle";
    if (char === "后" || char === "後") return "rear";
    return null;
}

function fileNumberToFile(number: number, color: XiangqiColor): number {
    return color === "red" ? 9 - number : number - 1;
}

function filterByRelativeSelector(
    squares: Square[],
    selector: "front" | "middle" | "rear",
    color: XiangqiColor,
): Square[] {
    const byFile = new Map<number, Square[]>();
    for (const sq of squares) {
        const file = coords(sq).file;
        byFile.set(file, [...(byFile.get(file) ?? []), sq]);
    }

    const result: Square[] = [];
    for (const fileSquares of byFile.values()) {
        if (fileSquares.length <= 1) continue;
        const sorted = [...fileSquares].sort((a, b) => {
            const rankA = coords(a).rank;
            const rankB = coords(b).rank;
            return color === "red" ? rankB - rankA : rankA - rankB;
        });
        if (selector === "front") result.push(sorted[0]);
        if (selector === "rear") result.push(sorted[sorted.length - 1]);
        if (selector === "middle" && sorted.length % 2 === 1)
            result.push(sorted[Math.floor(sorted.length / 2)]);
    }
    return result;
}

function matchesRelativeTarget(
    from: Square,
    to: Square,
    role: XiangqiRole,
    op: "+" | "-" | "=",
    targetNumber: number,
    color: XiangqiColor,
): boolean {
    const origin = coords(from);
    const dest = coords(to);
    const targetFile = fileNumberToFile(targetNumber, color);
    const forwardDelta = color === "red" ? dest.rank - origin.rank : origin.rank - dest.rank;

    if (op === "=") {
        return origin.rank === dest.rank && dest.file === targetFile;
    }

    if (role === "horse" || role === "elephant" || role === "advisor") {
        return dest.file === targetFile && (op === "+" ? forwardDelta > 0 : forwardDelta < 0);
    }

    if (origin.file !== dest.file) return false;
    return op === "+" ? forwardDelta === targetNumber : forwardDelta === -targetNumber;
}

function escapeHeader(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
