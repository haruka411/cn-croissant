export type XiangqiColor = "red" | "black";
export type XiangqiRole = "king" | "advisor" | "elephant" | "horse" | "rook" | "cannon" | "pawn";
export type Square = `${string}${number}`;

export type XiangqiPiece = {
    color: XiangqiColor;
    role: XiangqiRole;
};

export type XiangqiMove = {
    from: Square;
    to: Square;
};

export type XiangqiDrawBrush =
    | "green"
    | "red"
    | "blue"
    | "yellow"
    | "paleGreen"
    | "paleRed"
    | "paleBlue"
    | "silver"
    | "variation";

export type XiangqiDrawShape = {
    orig: Square;
    dest?: Square;
    brush?: XiangqiDrawBrush;
    modifiers?: {
        lineWidth?: number;
        opacity?: number;
        outlineWidth?: number;
        outlineColor?: string;
        outlineOpacity?: number;
        glow?: boolean;
    };
};

export type XiangqiPosition = {
    board: Map<Square, XiangqiPiece>;
    turn: XiangqiColor;
    halfmove: number;
    fullmove: number;
};

export type MoveResult = {
    position: XiangqiPosition;
    captured: XiangqiPiece | null;
    san: string;
    check: boolean;
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h", "i"] as const;
const BOARD_WIDTH = 9;
const BOARD_HEIGHT = 10;

const ROLE_TO_ENGINE_CHAR: Record<XiangqiRole, string> = {
    king: "k",
    advisor: "a",
    elephant: "b",
    horse: "n",
    rook: "r",
    cannon: "c",
    pawn: "p",
};

const FEN_CHAR_TO_ROLE: Record<string, XiangqiRole> = {
    k: "king",
    a: "advisor",
    b: "elephant",
    e: "elephant",
    n: "horse",
    h: "horse",
    r: "rook",
    c: "cannon",
    p: "pawn",
};

export const INITIAL_XIANGQI_FEN =
    "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

export const PIECE_LABELS: Record<XiangqiColor, Record<XiangqiRole, string>> = {
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

export const PIECE_VALUES: Record<XiangqiRole, number> = {
    king: 0,
    advisor: 2,
    elephant: 2,
    horse: 4,
    rook: 9,
    cannon: 4.5,
    pawn: 1,
};

export const XIANGQI_ROLES: XiangqiRole[] = [
    "king",
    "advisor",
    "elephant",
    "horse",
    "rook",
    "cannon",
    "pawn",
];

export const XIANGQI_COLORS: XiangqiColor[] = ["red", "black"];

export function opposite(color: XiangqiColor): XiangqiColor {
    return color === "red" ? "black" : "red";
}

export function square(file: number, rank: number): Square {
    return `${FILES[file]}${rank}`;
}

export function coords(sq: Square): { file: number; rank: number } {
    const file = FILES.indexOf(sq[0] as (typeof FILES)[number]);
    const rank = Number.parseInt(sq.slice(1), 10);
    if (!inBounds(file, rank)) {
        throw new Error(`Invalid square: ${sq}`);
    }
    return { file, rank };
}

export function inBounds(file: number, rank: number): boolean {
    return file >= 0 && file < BOARD_WIDTH && rank >= 0 && rank < BOARD_HEIGHT;
}

export function clonePosition(position: XiangqiPosition): XiangqiPosition {
    return {
        board: new Map(position.board),
        turn: position.turn,
        halfmove: position.halfmove,
        fullmove: position.fullmove,
    };
}

export function setPieceAt(
    position: XiangqiPosition,
    target: Square,
    piece: XiangqiPiece | null,
): XiangqiPosition {
    const next = clonePosition(position);
    if (piece) {
        next.board.set(target, piece);
    } else {
        next.board.delete(target);
    }
    return next;
}

export function parseFen(fen: string): XiangqiPosition {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 1 || !parts[0]) {
        throw new Error("Missing FEN board");
    }

    const ranks = parts[0].split("/");
    if (ranks.length !== BOARD_HEIGHT) {
        throw new Error("Xiangqi FEN must have 10 ranks");
    }

    const board = new Map<Square, XiangqiPiece>();
    ranks.forEach((rankText, rankIndex) => {
        let file = 0;
        const rank = BOARD_HEIGHT - 1 - rankIndex;
        for (const char of rankText) {
            if (/^\d$/.test(char)) {
                file += Number.parseInt(char, 10);
                continue;
            }
            const role = FEN_CHAR_TO_ROLE[char.toLowerCase()];
            if (!role) {
                throw new Error(`Invalid Xiangqi piece: ${char}`);
            }
            if (!inBounds(file, rank)) {
                throw new Error(`Too many files in rank: ${rankText}`);
            }
            board.set(square(file, rank), {
                color: char === char.toUpperCase() ? "red" : "black",
                role,
            });
            file += 1;
        }
        if (file !== BOARD_WIDTH) {
            throw new Error(`Rank does not contain 9 files: ${rankText}`);
        }
    });

    const turn = parseTurn(parts[1] ?? "w");
    const halfmove = Number.parseInt(parts[4] ?? "0", 10);
    const fullmove = Number.parseInt(parts[5] ?? "1", 10);

    return {
        board,
        turn,
        halfmove: Number.isFinite(halfmove) ? halfmove : 0,
        fullmove: Number.isFinite(fullmove) ? fullmove : 1,
    };
}

function parseTurn(raw: string): XiangqiColor {
    const value = raw.toLowerCase();
    if (value === "w" || value === "r" || value === "red") return "red";
    if (value === "b" || value === "black") return "black";
    throw new Error(`Invalid side to move: ${raw}`);
}

export function makeFen(position: XiangqiPosition, engineFormat = true): string {
    const ranks: string[] = [];
    for (let rank = BOARD_HEIGHT - 1; rank >= 0; rank -= 1) {
        let text = "";
        let empty = 0;
        for (let file = 0; file < BOARD_WIDTH; file += 1) {
            const piece = position.board.get(square(file, rank));
            if (!piece) {
                empty += 1;
                continue;
            }
            if (empty > 0) {
                text += empty.toString();
                empty = 0;
            }
            let char = ROLE_TO_ENGINE_CHAR[piece.role];
            if (!engineFormat) {
                if (piece.role === "horse") char = "h";
                if (piece.role === "elephant") char = "e";
            }
            text += piece.color === "red" ? char.toUpperCase() : char;
        }
        if (empty > 0) text += empty.toString();
        ranks.push(text);
    }

    const turn = position.turn === "red" ? "w" : "b";
    return `${ranks.join("/")} ${turn} - - ${position.halfmove} ${position.fullmove}`;
}

export function positionKey(fen: string): string {
    const position = parseFen(fen);
    return makeFen(
        {
            ...position,
            halfmove: 0,
            fullmove: 1,
        },
        true,
    )
        .split(" ")
        .slice(0, 2)
        .join(" ");
}

export function legalMoves(position: XiangqiPosition): XiangqiMove[] {
    const moves: XiangqiMove[] = [];
    for (const [from, piece] of position.board.entries()) {
        if (piece.color !== position.turn) continue;
        for (const move of pseudoMovesForPiece(position, from, piece)) {
            const next = applyMoveUnchecked(position, move).position;
            if (!isInCheck(next, piece.color)) {
                moves.push(move);
            }
        }
    }
    return moves;
}

export function legalDests(position: XiangqiPosition): Map<Square, Square[]> {
    const result = new Map<Square, Square[]>();
    for (const move of legalMoves(position)) {
        const current = result.get(move.from) ?? [];
        current.push(move.to);
        result.set(move.from, current);
    }
    return result;
}

export function isLegalMove(position: XiangqiPosition, move: XiangqiMove): boolean {
    return legalMoves(position).some((m) => m.from === move.from && m.to === move.to);
}

export function applyMove(position: XiangqiPosition, move: XiangqiMove): MoveResult {
    if (!isLegalMove(position, move)) {
        throw new Error(`Illegal move: ${move.from}${move.to}`);
    }
    return applyMoveUnchecked(position, move);
}

function applyMoveUnchecked(position: XiangqiPosition, move: XiangqiMove): MoveResult {
    const piece = position.board.get(move.from);
    if (!piece) {
        throw new Error(`No piece on ${move.from}`);
    }
    const next = clonePosition(position);
    const captured = next.board.get(move.to) ?? null;
    next.board.delete(move.from);
    next.board.set(move.to, piece);
    next.turn = opposite(position.turn);
    next.halfmove = captured ? 0 : position.halfmove + 1;
    next.fullmove = position.turn === "black" ? position.fullmove + 1 : position.fullmove;
    const check = isInCheck(next, next.turn);

    return {
        position: next,
        captured,
        san: moveToText(position, move, captured, check),
        check,
    };
}

function pseudoMovesForPiece(
    position: XiangqiPosition,
    from: Square,
    piece: XiangqiPiece,
): XiangqiMove[] {
    switch (piece.role) {
        case "king":
            return kingMoves(position, from, piece);
        case "advisor":
            return advisorMoves(position, from, piece);
        case "elephant":
            return elephantMoves(position, from, piece);
        case "horse":
            return horseMoves(position, from, piece);
        case "rook":
            return rookMoves(position, from, piece);
        case "cannon":
            return cannonMoves(position, from, piece);
        case "pawn":
            return pawnMoves(position, from, piece);
    }
}

function pushIfAvailable(
    moves: XiangqiMove[],
    position: XiangqiPosition,
    piece: XiangqiPiece,
    from: Square,
    file: number,
    rank: number,
) {
    if (!inBounds(file, rank)) return;
    const to = square(file, rank);
    const target = position.board.get(to);
    if (!target || target.color !== piece.color) {
        moves.push({ from, to });
    }
}

function inPalace(color: XiangqiColor, file: number, rank: number): boolean {
    if (file < 3 || file > 5) return false;
    return color === "red" ? rank >= 0 && rank <= 2 : rank >= 7 && rank <= 9;
}

function kingMoves(position: XiangqiPosition, from: Square, piece: XiangqiPiece): XiangqiMove[] {
    const { file, rank } = coords(from);
    const moves: XiangqiMove[] = [];
    for (const [df, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ]) {
        const nf = file + df;
        const nr = rank + dr;
        if (inPalace(piece.color, nf, nr)) {
            pushIfAvailable(moves, position, piece, from, nf, nr);
        }
    }

    const opposingKing = findKing(position, opposite(piece.color));
    if (opposingKing) {
        const enemy = coords(opposingKing);
        if (enemy.file === file && clearFile(position, file, rank, enemy.rank)) {
            moves.push({ from, to: opposingKing });
        }
    }
    return moves;
}

function advisorMoves(position: XiangqiPosition, from: Square, piece: XiangqiPiece): XiangqiMove[] {
    const { file, rank } = coords(from);
    const moves: XiangqiMove[] = [];
    for (const [df, dr] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
    ]) {
        const nf = file + df;
        const nr = rank + dr;
        if (inPalace(piece.color, nf, nr)) {
            pushIfAvailable(moves, position, piece, from, nf, nr);
        }
    }
    return moves;
}

function elephantMoves(
    position: XiangqiPosition,
    from: Square,
    piece: XiangqiPiece,
): XiangqiMove[] {
    const { file, rank } = coords(from);
    const moves: XiangqiMove[] = [];
    for (const [df, dr] of [
        [2, 2],
        [2, -2],
        [-2, 2],
        [-2, -2],
    ]) {
        const nf = file + df;
        const nr = rank + dr;
        const eye = square(file + df / 2, rank + dr / 2);
        const crossedRiver = piece.color === "red" ? nr > 4 : nr < 5;
        if (!inBounds(nf, nr) || crossedRiver || position.board.has(eye)) continue;
        pushIfAvailable(moves, position, piece, from, nf, nr);
    }
    return moves;
}

function horseMoves(position: XiangqiPosition, from: Square, piece: XiangqiPiece): XiangqiMove[] {
    const { file, rank } = coords(from);
    const moves: XiangqiMove[] = [];
    const candidates = [
        { df: 1, dr: 2, leg: [0, 1] },
        { df: -1, dr: 2, leg: [0, 1] },
        { df: 1, dr: -2, leg: [0, -1] },
        { df: -1, dr: -2, leg: [0, -1] },
        { df: 2, dr: 1, leg: [1, 0] },
        { df: 2, dr: -1, leg: [1, 0] },
        { df: -2, dr: 1, leg: [-1, 0] },
        { df: -2, dr: -1, leg: [-1, 0] },
    ] as const;
    for (const { df, dr, leg } of candidates) {
        const nf = file + df;
        const nr = rank + dr;
        if (!inBounds(nf, nr)) continue;
        if (position.board.has(square(file + leg[0], rank + leg[1]))) continue;
        pushIfAvailable(moves, position, piece, from, nf, nr);
    }
    return moves;
}

function rookMoves(position: XiangqiPosition, from: Square, piece: XiangqiPiece): XiangqiMove[] {
    return lineMoves(position, from, piece, false);
}

function cannonMoves(position: XiangqiPosition, from: Square, piece: XiangqiPiece): XiangqiMove[] {
    return lineMoves(position, from, piece, true);
}

function lineMoves(
    position: XiangqiPosition,
    from: Square,
    piece: XiangqiPiece,
    cannon: boolean,
): XiangqiMove[] {
    const { file, rank } = coords(from);
    const moves: XiangqiMove[] = [];
    for (const [df, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ]) {
        let nf = file + df;
        let nr = rank + dr;
        let screenSeen = false;
        while (inBounds(nf, nr)) {
            const to = square(nf, nr);
            const target = position.board.get(to);
            if (!cannon) {
                if (!target) {
                    moves.push({ from, to });
                } else {
                    if (target.color !== piece.color) moves.push({ from, to });
                    break;
                }
            } else if (!screenSeen) {
                if (!target) {
                    moves.push({ from, to });
                } else {
                    screenSeen = true;
                }
            } else if (target) {
                if (target.color !== piece.color) moves.push({ from, to });
                break;
            }
            nf += df;
            nr += dr;
        }
    }
    return moves;
}

function pawnMoves(position: XiangqiPosition, from: Square, piece: XiangqiPiece): XiangqiMove[] {
    const { file, rank } = coords(from);
    const moves: XiangqiMove[] = [];
    const forward = piece.color === "red" ? 1 : -1;
    pushIfAvailable(moves, position, piece, from, file, rank + forward);

    const crossedRiver = piece.color === "red" ? rank >= 5 : rank <= 4;
    if (crossedRiver) {
        pushIfAvailable(moves, position, piece, from, file - 1, rank);
        pushIfAvailable(moves, position, piece, from, file + 1, rank);
    }
    return moves;
}

export function isInCheck(position: XiangqiPosition, color: XiangqiColor): boolean {
    const king = findKing(position, color);
    if (!king) return true;

    for (const [from, piece] of position.board.entries()) {
        if (piece.color === color) continue;
        const moves = pseudoMovesForPiece(position, from, piece);
        if (moves.some((move) => move.to === king)) {
            return true;
        }
    }
    return false;
}

export function isCheckmate(position: XiangqiPosition): boolean {
    return isInCheck(position, position.turn) && legalMoves(position).length === 0;
}

export function findKing(position: XiangqiPosition, color: XiangqiColor): Square | null {
    for (const [sq, piece] of position.board.entries()) {
        if (piece.color === color && piece.role === "king") return sq;
    }
    return null;
}

function clearFile(
    position: XiangqiPosition,
    file: number,
    fromRank: number,
    toRank: number,
): boolean {
    const step = fromRank < toRank ? 1 : -1;
    for (let rank = fromRank + step; rank !== toRank; rank += step) {
        if (position.board.has(square(file, rank))) return false;
    }
    return true;
}

export function parseUciMove(text: string): XiangqiMove | null {
    const clean = text.trim().toLowerCase();
    if (!/^[a-i][0-9][a-i][0-9]$/.test(clean)) return null;
    return {
        from: clean.slice(0, 2) as Square,
        to: clean.slice(2, 4) as Square,
    };
}

export function makeUciMove(move: XiangqiMove): string {
    return `${move.from}${move.to}`;
}

export function moveToText(
    position: XiangqiPosition,
    move: XiangqiMove,
    _captured: XiangqiPiece | null = position.board.get(move.to) ?? null,
    check = false,
): string {
    const piece = position.board.get(move.from);
    if (!piece) return makeUciMove(move);
    const origin = coords(move.from);
    const dest = coords(move.to);
    const forwardDelta = piece.color === "red" ? dest.rank - origin.rank : origin.rank - dest.rank;
    let op: "进" | "退" | "平";
    let targetNumber: number;

    if (origin.rank === dest.rank) {
        op = "平";
        targetNumber = notationFileNumber(dest.file, piece.color);
    } else if (piece.role === "horse" || piece.role === "elephant" || piece.role === "advisor") {
        op = forwardDelta > 0 ? "进" : "退";
        targetNumber = notationFileNumber(dest.file, piece.color);
    } else {
        op = forwardDelta > 0 ? "进" : "退";
        targetNumber = Math.abs(forwardDelta);
    }

    const prefix = disambiguatedPrefix(position, move.from, piece.role, piece.color);
    const label = CHINESE_NOTATION_LABELS[piece.color][piece.role];
    const source = prefix
        ? `${prefix}${label}`
        : `${label}${formatNotationNumber(notationFileNumber(origin.file, piece.color), piece.color)}`;

    return `${source}${op}${formatNotationNumber(targetNumber, piece.color)}${check ? "+" : ""}`;
}

function disambiguatedPrefix(
    position: XiangqiPosition,
    from: Square,
    role: XiangqiRole,
    color: XiangqiColor,
): string | null {
    const file = coords(from).file;
    const sameFile = [...position.board.entries()]
        .filter(([sq, p]) => p.color === color && p.role === role && coords(sq).file === file)
        .map(([sq]) => sq);
    if (sameFile.length <= 1) return null;
    // Sort front-to-rear: red = descending rank, black = ascending rank
    const sorted = sameFile.sort((a, b) =>
        color === "red" ? coords(b).rank - coords(a).rank : coords(a).rank - coords(b).rank,
    );
    const index = sorted.indexOf(from);
    const count = sorted.length;
    if (count === 2) return index === 0 ? "前" : "后";
    if (count === 3) return index === 0 ? "前" : index === 1 ? "中" : "后";
    if (index === 0) return "前";
    if (index === count - 1) return "后";
    return CHINESE_NOTATION_NUMBERS[index + 1] ?? String(index + 1);
}

const CHINESE_NOTATION_LABELS: Record<XiangqiColor, Record<XiangqiRole, string>> = {
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

const CHINESE_NOTATION_NUMBERS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function notationFileNumber(file: number, color: XiangqiColor): number {
    return color === "red" ? 9 - file : file + 1;
}

function formatNotationNumber(number: number, color: XiangqiColor): string {
    if (color === "black") return String(number);
    return CHINESE_NOTATION_NUMBERS[number] ?? String(number);
}

export function materialBalance(position: XiangqiPosition): number {
    let score = 0;
    for (const piece of position.board.values()) {
        const value = PIECE_VALUES[piece.role];
        score += piece.color === "red" ? value : -value;
    }
    return score;
}

export function traverseMainline(root: GameNode): GameNode[] {
    const nodes = [root];
    let current = root;
    while (current.children[0]) {
        current = current.children[0];
        nodes.push(current);
    }
    return nodes;
}

export type GameNode = {
    id: string;
    fen: string;
    move: string | null;
    text: string;
    comment: string;
    shapes?: XiangqiDrawShape[];
    children: GameNode[];
};

export type SavedGame = {
    id: string;
    title: string;
    event: string;
    red: string;
    black: string;
    result: string;
    resultReason?: string | null;
    root: GameNode;
    updatedAt: number;
};

export function createRootNode(fen = INITIAL_XIANGQI_FEN): GameNode {
    return {
        id: crypto.randomUUID(),
        fen,
        move: null,
        text: "起始局面",
        comment: "",
        shapes: [],
        children: [],
    };
}

export function getNodeAtPath(root: GameNode, path: number[]): GameNode {
    let current = root;
    for (const index of path) {
        current = current.children[index];
        if (!current) throw new Error(`Invalid game path: ${path.join(".")}`);
    }
    return current;
}

export function cloneGameNode(node: GameNode): GameNode {
    return {
        ...node,
        shapes: node.shapes ? [...node.shapes] : [],
        children: node.children.map(cloneGameNode),
    };
}

export function collectPositions(root: GameNode): { node: GameNode; path: number[] }[] {
    const result: { node: GameNode; path: number[] }[] = [];
    const visit = (node: GameNode, path: number[]) => {
        result.push({ node, path });
        node.children.forEach((child, index) => visit(child, [...path, index]));
    };
    visit(root, []);
    return result;
}
