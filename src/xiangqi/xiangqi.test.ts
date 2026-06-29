import { describe, expect, it } from "vitest";
import {
    INITIAL_XIANGQI_FEN,
    applyMove,
    isInCheck,
    legalMoves,
    makeFen,
    parseFen,
    parseUciMove,
} from "./xiangqi";
import { createXiangqiStore } from "./store";

describe("xiangqi rules", () => {
    function playMoves(store: ReturnType<typeof createXiangqiStore>, moves: string[]) {
        for (const text of moves) {
            const move = parseUciMove(text);
            expect(move).not.toBeNull();
            store.getState().makeMove(move!);
        }
    }

    it("round-trips the initial FEN", () => {
        const position = parseFen(INITIAL_XIANGQI_FEN);
        expect(position.board.size).toBe(32);
        expect(makeFen(position)).toBe(INITIAL_XIANGQI_FEN);
    });

    it("generates legal initial moves", () => {
        const position = parseFen(INITIAL_XIANGQI_FEN);
        const moves = legalMoves(position).map((move) => `${move.from}${move.to}`);
        expect(moves).toContain("h0g2");
        expect(moves).toContain("b2b9");
        expect(moves).toContain("a3a4");
        expect(moves).toContain("e0e1");
    });

    it("blocks horse legs", () => {
        const position = parseFen(INITIAL_XIANGQI_FEN);
        const moves = legalMoves(position).map((move) => `${move.from}${move.to}`);
        expect(moves).not.toContain("b0b2");
    });

    it("detects flying-general check", () => {
        const position = parseFen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1");
        expect(isInCheck(position, "red")).toBe(true);
        expect(isInCheck(position, "black")).toBe(true);
    });

    it("applies a legal move and switches turn", () => {
        const position = parseFen(INITIAL_XIANGQI_FEN);
        const move = parseUciMove("h0g2");
        expect(move).not.toBeNull();
        const result = applyMove(position, move!);
        expect(result.position.turn).toBe("black");
        expect(result.position.board.get("g2")?.role).toBe("horse");
    });

    it("accepts Pikafish bestmove coordinates for the initial position", () => {
        const position = parseFen(INITIAL_XIANGQI_FEN);
        const move = parseUciMove("c3c4");
        expect(move).not.toBeNull();
        const result = applyMove(position, move!);
        expect(result.position.turn).toBe("black");
        expect(result.position.board.get("c4")?.role).toBe("pawn");
    });

    it("counts non-capturing pawn moves toward the natural draw counter", () => {
        const position = parseFen(INITIAL_XIANGQI_FEN);
        const move = parseUciMove("c3c4");
        expect(move).not.toBeNull();
        const result = applyMove(position, move!);
        expect(result.position.halfmove).toBe(1);
    });

    it("adjudicates a draw after 120 consecutive non-capturing halfmoves", () => {
        const store = createXiangqiStore();
        store.getState().setFen("4k4/4a4/9/9/9/9/9/9/9/R3K4 w - - 119 1");
        const move = parseUciMove("a0a1");
        expect(move).not.toBeNull();

        store.getState().makeMove(move!);

        expect(store.getState().headers.result).toBe("1/2-1/2");
        expect(store.getState().headers.resultReason).toBe("naturalDraw");
        expect(store.getState().exportNotation()).toContain('[Termination "naturalDraw"]');
    });

    it("adjudicates checkmate when the king is in check with no legal moves", () => {
        // Red king cornered, black rook gives check, red has no escape.
        // k=black king e9, r=black rook a0 giving check to red king on e0
        const store = createXiangqiStore();
        store.getState().setFen("4k4/9/9/9/9/9/9/9/9/r3K4 b - - 0 1");
        const move = parseUciMove("a0e0");
        expect(move).not.toBeNull();
        store.getState().makeMove(move!);

        expect(store.getState().headers.result).toBe("0-1");
        expect(store.getState().headers.resultReason).toBe("checkmate");
    });

    it("adjudicates 困毙 (noLegalMove) when the side to move has no legal moves but is not in check", () => {
        // Black king e9 is not in check, but every escape square is covered:
        // rook on rank 8 covers e8, rook on d-file covers d9, rook on f-file covers f9.
        // Red rook a2 moves to a8 to complete the net; black then has zero legal moves.
        const store = createXiangqiStore();
        store.getState().setFen("4k4/9/9/9/9/9/9/R8/3R1R3/K8 w - - 0 1");
        const move = parseUciMove("a2a8");
        expect(move).not.toBeNull();
        store.getState().makeMove(move!);

        expect(store.getState().headers.result).toBe("1-0");
        expect(store.getState().headers.resultReason).toBe("noLegalMove");
    });

    it("adjudicates perpetual check as a loss for the checking side", () => {
        // Red rook oscillates d1<->e1 giving check every move; black king flees e9<->d9.
        // Red king on f0 keeps off the kings' file so the flying-general rule never interferes.
        const store = createXiangqiStore();
        store.getState().setFen("4k4/9/9/9/9/9/9/9/3R5/5K3 w - - 0 1");
        playMoves(store, ["d1e1", "e9d9", "e1d1", "d9e9", "d1e1", "e9d9", "e1d1", "d9e9"]);

        expect(store.getState().headers.result).toBe("0-1");
        expect(store.getState().headers.resultReason).toBe("perpetualCheck");
    });

    it("adjudicates unresolved threefold repetition as a draw", () => {
        const store = createXiangqiStore();
        store.getState().setFen("r3k4/4a4/9/9/9/9/9/9/9/R3K4 w - - 0 1");
        playMoves(store, ["a0a1", "a9a8", "a1a0", "a8a9", "a0a1", "a9a8", "a1a0", "a8a9"]);

        expect(store.getState().headers.result).toBe("1/2-1/2");
        expect(store.getState().headers.resultReason).toBe("repetition");
    });
});
