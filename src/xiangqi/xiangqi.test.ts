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

    it("adjudicates a draw after 60 consecutive non-capturing halfmoves", () => {
        const store = createXiangqiStore();
        store.getState().setFen("4k4/4a4/9/9/9/9/9/9/9/R3K4 w - - 59 1");
        const move = parseUciMove("a0a1");
        expect(move).not.toBeNull();

        store.getState().makeMove(move!);

        expect(store.getState().headers.result).toBe("1/2-1/2");
        expect(store.getState().headers.resultReason).toBe("naturalDraw");
        expect(store.getState().exportNotation()).toContain('[Termination "naturalDraw"]');
    });

    it("adjudicates unresolved threefold repetition as a draw", () => {
        const store = createXiangqiStore();
        store.getState().setFen("r3k4/4a4/9/9/9/9/9/9/9/R3K4 w - - 0 1");
        for (const text of ["a0a1", "a9a8", "a1a0", "a8a9", "a0a1", "a9a8", "a1a0", "a8a9"]) {
            const move = parseUciMove(text);
            expect(move).not.toBeNull();
            store.getState().makeMove(move!);
        }

        expect(store.getState().headers.result).toBe("1/2-1/2");
        expect(store.getState().headers.resultReason).toBe("repetition");
    });
});
