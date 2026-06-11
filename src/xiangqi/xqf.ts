import {
    applyMove,
    INITIAL_XIANGQI_FEN,
    makeFen,
    makeUciMove,
    parseFen,
    square,
    type Square,
    type XiangqiMove,
    type XiangqiPosition,
} from "./xiangqi";

const XQF_MAINLINE_OFFSET = 0x408;
const XQF_MOVE_RECORD_SIZE = 8;

export function parseXqfMainline(bytes: Uint8Array): string {
    if (bytes.length < XQF_MAINLINE_OFFSET + XQF_MOVE_RECORD_SIZE) {
        throw new Error("XQF file is too small.");
    }
    if (bytes[0] !== 0x58 || bytes[1] !== 0x51) {
        throw new Error("Unsupported XQF file: missing XQ header.");
    }

    let position = parseFen(INITIAL_XIANGQI_FEN);
    const moves: string[] = [];

    for (
        let offset = XQF_MAINLINE_OFFSET;
        offset + 1 < bytes.length;
        offset += XQF_MOVE_RECORD_SIZE
    ) {
        const fromRaw = bytes[offset] - 24;
        const toRaw = bytes[offset + 1] - 32;
        if (!isXqfCoord(fromRaw) || !isXqfCoord(toRaw)) break;

        const move = decodeLegalMove(position, fromRaw, toRaw);
        if (!move) break;

        const result = applyMove(position, move);
        moves.push(makeUciMove(move));
        position = result.position;
    }

    if (moves.length === 0) {
        throw new Error("No legal mainline moves were decoded from this XQF file.");
    }

    return exportDecodedMoves(moves);
}

function isXqfCoord(value: number): boolean {
    return Number.isInteger(value) && value >= 0 && value <= 99;
}

function decodeLegalMove(
    position: XiangqiPosition,
    fromRaw: number,
    toRaw: number,
): XiangqiMove | null {
    for (const from of coordCandidates(fromRaw)) {
        for (const to of coordCandidates(toRaw)) {
            const move = { from, to };
            try {
                applyMove(position, move);
                return move;
            } catch {
                // Try the next coordinate transform.
            }
        }
    }
    return null;
}

function coordCandidates(raw: number): Square[] {
    const a = raw % 10;
    const b = Math.floor(raw / 10);
    const candidates = [
        [a, b],
        [a, 9 - b],
        [b, a],
        [b, 9 - a],
    ];
    const unique = new Set<Square>();
    for (const [file, rank] of candidates) {
        if (file >= 0 && file <= 8 && rank >= 0 && rank <= 9) {
            unique.add(square(file, rank));
        }
    }
    return [...unique];
}

function exportDecodedMoves(moves: string[]): string {
    const moveText = moves
        .map((move, index) => (index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ${move}` : move))
        .join(" ");

    return `[Event "XQF Import"]\n[FEN "${makeFen(parseFen(INITIAL_XIANGQI_FEN))}"]\n\n${moveText} *`;
}
