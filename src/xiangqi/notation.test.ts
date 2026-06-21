import { describe, expect, it } from "vitest";
import { exportGame, formatXiangqiMove, makeGameFromNotation, parseGameNotation } from "./notation";
import { parseXqfMainline } from "./xqf";
import {
    createXiangqiStateFromFen,
    createXiangqiStateFromNotation,
    persistXiangqiState,
    readPersistedXiangqiState,
} from "./persistence";
import {
    applyMove,
    createRootNode,
    getNodeAtPath,
    makeFen,
    parseFen,
    parseUciMove,
} from "./xiangqi";

describe("xiangqi notation", () => {
    it("parses coordinate moves from PGN-like text", () => {
        const parsed = parseGameNotation(
            `[Event "Sample"]\n[Red "A"]\n[Black "B"]\n\n1. h0g2 h9g7 2. b2e2`,
        );
        const first = parsed.root.children[0];
        expect(parsed.headers.Event).toBe("Sample");
        expect(first.move).toBe("h0g2");
        expect(first.children[0].move).toBe("h9g7");
    });

    it("parses WXF and Chinese file notation", () => {
        const wxf = parseGameNotation(`[Event "WXF"]\n\n1. C2=5 H8+7`);
        expect(getNodeAtPath(wxf.root, [0]).move).toBe("h2e2");
        expect(getNodeAtPath(wxf.root, [0, 0]).move).toBe("h9g7");

        const chinese = parseGameNotation(`[Event "Chinese"]\n\n1. 炮二平五 马8进7`);
        expect(getNodeAtPath(chinese.root, [0]).move).toBe("h2e2");
        expect(getNodeAtPath(chinese.root, [0, 0]).move).toBe("h9g7");
    });

    it("decodes a simple XQF mainline", () => {
        const bytes = new Uint8Array(0x408 + 16);
        bytes[0] = 0x58;
        bytes[1] = 0x51;
        bytes[0x408] = 27 + 24;
        bytes[0x409] = 24 + 32;
        bytes[0x410] = 97 + 24;
        bytes[0x411] = 76 + 32;

        const parsed = parseGameNotation(parseXqfMainline(bytes));
        expect(getNodeAtPath(parsed.root, [0]).move).toBe("h2e2");
        expect(getNodeAtPath(parsed.root, [0, 0]).move).toBe("h9g7");
    });

    it("extracts coordinate moves from CBL-style XML move tags", () => {
        const parsed = parseGameNotation(`
      <ChineseChessRecord event="CBL Sample" red="A" black="B">
        <Move value="h0g2" />
        <Move value="h9g7" />
      </ChineseChessRecord>
    `);
        expect(parsed.headers.Event).toBe("CBL Sample");
        expect(getNodeAtPath(parsed.root, [0]).move).toBe("h0g2");
        expect(getNodeAtPath(parsed.root, [0, 0]).move).toBe("h9g7");
    });

    it("parses vertical Chinese notation with fullwidth move numbers and side prefixes", () => {
        const parsed = parseGameNotation(`
      １、红方：炮二平五
      １...黑方：马８进７
    `);
        expect(getNodeAtPath(parsed.root, [0]).move).toBe("h2e2");
        expect(getNodeAtPath(parsed.root, [0, 0]).move).toBe("h9g7");
    });

    it("exports and imports a saved game", () => {
        const root = createRootNode();
        const position = parseFen(root.fen);
        const move = parseUciMove("h0g2")!;
        const result = applyMove(position, move);
        root.children.push({
            id: "move",
            fen: makeFen(result.position),
            move: "h0g2",
            text: result.san,
            comment: "",
            children: [],
        });
        const game = {
            id: "game",
            title: "Test",
            event: "Event",
            red: "Red",
            black: "Black",
            result: "*",
            root,
            updatedAt: 1,
        };
        const imported = makeGameFromNotation(exportGame(game));
        expect(imported.title).toBe("Test");
        expect(getNodeAtPath(imported.root, [0]).move).toBe("h0g2");
    });

    it("exports WXF and Chinese file notation", () => {
        const game = makeGameFromNotation(`[Event "Export"]\n\n1. h2e2 h9g7`);
        const wxf = exportGame(game, { moveFormat: "wxf" });
        const chinese = exportGame(game, { moveFormat: "chinese" });

        expect(wxf).toContain("1. C2=5 H8+7");
        expect(chinese).toContain("1. 炮二平五 马８进７");
        expect(getNodeAtPath(makeGameFromNotation(wxf).root, [0]).move).toBe("h2e2");
        expect(getNodeAtPath(makeGameFromNotation(chinese).root, [0, 0]).move).toBe("h9g7");
    });

    it("uses front and rear when same pieces share a file", () => {
        const position = parseFen("4k4/9/9/9/R8/9/R8/9/9/4K4 w - - 0 1");

        expect(formatXiangqiMove(position, parseUciMove("a5b5")!, "chinese")).toBe("前车平八");
        expect(formatXiangqiMove(position, parseUciMove("a3b3")!, "chinese")).toBe("后车平八");
    });

    it("uses front middle rear for three pawns on one file", () => {
        const position = parseFen("4k4/9/9/4P4/4P4/4P4/9/9/9/4K4 w - - 0 1");

        expect(formatXiangqiMove(position, parseUciMove("e6e7")!, "chinese")).toBe("前兵进一");
        expect(formatXiangqiMove(position, parseUciMove("e5f5")!, "chinese")).toBe("中兵平四");
        expect(formatXiangqiMove(position, parseUciMove("e4f4")!, "chinese")).toBe("后兵平四");
    });

    it("uses ordinals for five pawns on one file", () => {
        const position = parseFen("4k4/9/4P4/4P4/4P4/4P4/4P4/9/9/4K4 w - - 0 1");

        expect(formatXiangqiMove(position, parseUciMove("e7f7")!, "chinese")).toBe("前兵平四");
        expect(formatXiangqiMove(position, parseUciMove("e6f6")!, "chinese")).toBe("二兵平四");
        expect(formatXiangqiMove(position, parseUciMove("e5f5")!, "chinese")).toBe("三兵平四");
        expect(formatXiangqiMove(position, parseUciMove("e4f4")!, "chinese")).toBe("四兵平四");
        expect(formatXiangqiMove(position, parseUciMove("e3f3")!, "chinese")).toBe("后兵平四");
    });

    it("parses disambiguated same-file Chinese notation", () => {
        const parsed = parseGameNotation(
            `[FEN "4k4/9/4P4/4P4/4P4/4P4/4P4/9/9/4K4 w - - 0 1"]\n\n1. 三兵平四`,
        );

        expect(getNodeAtPath(parsed.root, [0]).move).toBe("e5f5");
    });

    it("creates and persists tab state from notation", () => {
        const state = createXiangqiStateFromNotation(
            `[Event "Persisted"]\n[Red "A"]\n[Black "B"]\n\n1. h0g2`,
        );
        persistXiangqiState("test-tab", state);
        const restored = readPersistedXiangqiState("test-tab");
        expect(restored?.headers.event).toBe("Persisted");
        expect(restored?.root.children[0].move).toBe("h0g2");
    });

    it("creates tab state from Xiangqi FEN", () => {
        const state = createXiangqiStateFromFen("4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 1");
        expect(state.root.fen).toBe("4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 1");
        expect(state.headers.orientation).toBe("red");
    });
});
