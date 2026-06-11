import { parseGameNotation } from "./notation";
import { createRootNode, INITIAL_XIANGQI_FEN, makeFen, parseFen, type GameNode } from "./xiangqi";

export type XiangqiResult = "*" | "1-0" | "0-1" | "1/2-1/2";
export type XiangqiResultReason =
    | "checkmate"
    | "noLegalMove"
    | "naturalDraw"
    | "perpetualCheck"
    | "perpetualChase"
    | "repetition"
    | "timeout"
    | "resignation";
export type XiangqiOrientation = "red" | "black";

export type XiangqiHeaders = {
    event: string;
    site: string;
    red: string;
    black: string;
    result: XiangqiResult;
    resultReason?: XiangqiResultReason | null;
    fen: string;
    orientation: XiangqiOrientation;
    title?: string;
    date?: string | null;
};

export type XiangqiPersistedState = {
    root: GameNode;
    path: number[];
    headers: XiangqiHeaders;
    dirty: boolean;
};

export type XiangqiHeaderInput = {
    event?: string | null;
    site?: string | null;
    white?: string | null;
    black?: string | null;
    red?: string | null;
    result?: string | null;
    resultReason?: string | null;
    fen?: string | null;
    date?: string | null;
};

export function defaultXiangqiHeaders(
    fen = INITIAL_XIANGQI_FEN,
    headers?: XiangqiHeaderInput,
): XiangqiHeaders {
    return {
        event: headers?.event || "",
        site: headers?.site || "",
        red: headers?.red || headers?.white || "Red",
        black: headers?.black || "Black",
        result: normalizeResult(headers?.result || undefined) ?? "*",
        resultReason: normalizeResultReason(headers?.resultReason || undefined),
        fen,
        orientation: "red",
        title: headers?.event || undefined,
        date: headers?.date || null,
    };
}

export function createXiangqiStateFromFen(
    fen: string,
    headers?: XiangqiHeaderInput,
): XiangqiPersistedState {
    const normalized = makeFen(parseFen(fen));
    return {
        root: createRootNode(normalized),
        path: [],
        headers: defaultXiangqiHeaders(normalized, { ...headers, fen: normalized }),
        dirty: false,
    };
}

export function createXiangqiStateFromNotation(
    text: string,
    headers?: XiangqiHeaderInput,
): XiangqiPersistedState {
    const parsed = parseGameNotation(text);
    return {
        root: parsed.root,
        path: [],
        headers: {
            ...defaultXiangqiHeaders(parsed.root.fen, headers),
            event: parsed.headers.Event || headers?.event || "",
            site: parsed.headers.Site || headers?.site || "",
            red:
                parsed.headers.Red ||
                parsed.headers.White ||
                headers?.red ||
                headers?.white ||
                "Red",
            black: parsed.headers.Black || headers?.black || "Black",
            result:
                normalizeResult(parsed.headers.Result) ??
                normalizeResult(headers?.result || undefined) ??
                "*",
            resultReason:
                normalizeResultReason(parsed.headers.Termination) ??
                normalizeResultReason(headers?.resultReason || undefined),
            title: parsed.headers.Title || parsed.headers.Event || headers?.event || undefined,
            date: parsed.headers.Date || headers?.date || null,
        },
        dirty: false,
    };
}

export function persistXiangqiState(id: string, state: XiangqiPersistedState) {
    sessionStorage.setItem(`${id}-xiangqi`, JSON.stringify({ version: 0, state }));
}

export function readPersistedXiangqiState(id: string): XiangqiPersistedState | null {
    const raw = sessionStorage.getItem(`${id}-xiangqi`);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as { state?: XiangqiPersistedState };
        return parsed.state ?? null;
    } catch {
        return null;
    }
}

export function normalizeResult(result: string | undefined): XiangqiResult | null {
    if (result === "*" || result === "1-0" || result === "0-1" || result === "1/2-1/2") {
        return result;
    }
    return null;
}

export function normalizeResultReason(reason: string | undefined): XiangqiResultReason | null {
    if (
        reason === "checkmate" ||
        reason === "noLegalMove" ||
        reason === "naturalDraw" ||
        reason === "perpetualCheck" ||
        reason === "perpetualChase" ||
        reason === "repetition" ||
        reason === "timeout" ||
        reason === "resignation"
    ) {
        return reason;
    }
    return null;
}

export function resultReasonTranslationKey(reason: XiangqiResultReason): string {
    const keys: Record<XiangqiResultReason, string> = {
        checkmate: "Board.ResultReason.Checkmate",
        noLegalMove: "Board.ResultReason.NoLegalMove",
        naturalDraw: "Board.ResultReason.NaturalDraw",
        perpetualCheck: "Board.ResultReason.PerpetualCheck",
        perpetualChase: "Board.ResultReason.PerpetualChase",
        repetition: "Board.ResultReason.Repetition",
        timeout: "Board.ResultReason.Timeout",
        resignation: "Board.ResultReason.Resignation",
    };
    return keys[reason];
}
