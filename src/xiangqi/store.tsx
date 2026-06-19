import { createContext, useContext, useRef } from "react";
import { useStore } from "zustand";
import { createStore, type StateCreator, type StoreApi } from "zustand";
import { persist } from "zustand/middleware";
import { createDebouncedSessionStorage } from "@/state/store/debouncedStorage";
import { exportGame, parseGameNotation, type NotationMoveFormat } from "./notation";
import {
  defaultXiangqiHeaders,
  normalizeResult,
  normalizeResultReason,
  type XiangqiHeaders,
  type XiangqiResult,
  type XiangqiResultReason,
} from "./persistence";
import {
  applyMove,
  cloneGameNode,
  createRootNode,
  getNodeAtPath,
  INITIAL_XIANGQI_FEN,
  isInCheck,
  legalMoves,
  makeFen,
  makeUciMove,
  parseFen,
  positionKey,
  type GameNode,
  type XiangqiDrawShape,
  type XiangqiColor,
  type XiangqiMove,
  type XiangqiPosition,
} from "./xiangqi";

export type { XiangqiHeaders, XiangqiOrientation, XiangqiResult } from "./persistence";

export interface XiangqiStoreState {
  root: GameNode;
  path: number[];
  headers: XiangqiHeaders;
  dirty: boolean;

  currentNode: () => GameNode;
  getNode: (path: number[]) => GameNode | null;

  makeMove: (move: XiangqiMove, options?: { mainline?: boolean; changePosition?: boolean }) => void;
  setShapes: (shapes: XiangqiDrawShape[]) => void;
  clearShapes: () => void;
  setFen: (fen: string) => void;
  setHeaders: (headers: XiangqiHeaders) => void;
  setComment: (comment: string) => void;

  goToNext: () => void;
  goToPrevious: () => void;
  goToStart: () => void;
  goToEnd: () => void;
  goToMove: (path: number[]) => void;
  goToBranchStart: () => void;
  goToBranchEnd: () => void;
  nextBranch: () => void;
  previousBranch: () => void;
  nextBranching: () => void;
  previousBranching: () => void;

  deleteMove: (path?: number[]) => void;
  deleteMovesFrom: (path: number[]) => void;
  promoteVariation: (path: number[]) => void;
  promoteToMainline: (path: number[]) => void;

  exportNotation: (format?: NotationMoveFormat) => string;
  importNotation: (text: string) => void;
  copyNotation: () => void;
  copyVariationNotation: (path: number[]) => void;

  save: () => void;
  reset: () => void;
}

export type XiangqiStore = StoreApi<XiangqiStoreState>;

export const XiangqiStateContext = createContext<XiangqiStore | null>(null);

export function XiangqiStateProvider({ id, children }: { id?: string; children: React.ReactNode }) {
  const store = useRef(createXiangqiStore(id)).current;
  return <XiangqiStateContext.Provider value={store}>{children}</XiangqiStateContext.Provider>;
}

export function useXiangqiStore<T>(selector: (state: XiangqiStoreState) => T): T {
  const store = useContext(XiangqiStateContext);
  if (!store) {
    throw new Error("useXiangqiStore must be used inside XiangqiStateProvider");
  }
  return useStore(store, selector);
}

export function useXiangqiStoreApi(): XiangqiStore {
  const store = useContext(XiangqiStateContext);
  if (!store) {
    throw new Error("useXiangqiStoreApi must be used inside XiangqiStateProvider");
  }
  return store;
}

export function createXiangqiStore(id?: string): XiangqiStore {
  const creator: StateCreator<XiangqiStoreState> = (set, get) => ({
    ...defaultXiangqiState(),

    currentNode: () => safeNode(get().root, get().path),
    getNode: (path) => safeNodeOrNull(get().root, path),

    makeMove: (move, options = {}) =>
      set((state) => {
        const root = cloneGameNode(state.root);
        const parentPath = state.path;
        const parent = safeNode(root, parentPath);
        const position = parseFen(parent.fen);
        let result;
        try {
          result = applyMove(position, move);
        } catch {
          return state;
        }

        const moveText = makeUciMove(move);
        let childIndex = parent.children.findIndex((child) => child.move === moveText);
        if (childIndex < 0) {
          const node: GameNode = {
            id: crypto.randomUUID(),
            fen: makeFen(result.position),
            move: moveText,
            text: result.san,
            comment: "",
            shapes: [],
            children: [],
          };
          if (options.mainline) {
            parent.children.unshift(node);
            childIndex = 0;
          } else {
            parent.children.push(node);
            childIndex = parent.children.length - 1;
          }
        }

        const nextPath =
          options.changePosition === false ? state.path : [...parentPath, childIndex];
        const adjudication =
          adjudicateXiangqiResult(result.position) ?? adjudicateXiangqiRepetition(root, nextPath);
        const headers = {
          ...state.headers,
          result: adjudication?.result ?? state.headers.result,
          resultReason: adjudication?.reason ?? state.headers.resultReason ?? null,
        };

        return {
          ...state,
          root,
          headers,
          path: nextPath,
          dirty: true,
        };
      }),

    setShapes: (shapes) =>
      set((state) => {
        const root = cloneGameNode(state.root);
        safeNode(root, state.path).shapes = shapes;
        return { ...state, root, dirty: true };
      }),

    clearShapes: () =>
      set((state) => {
        const node = safeNode(state.root, state.path);
        if ((node.shapes ?? []).length === 0) return state;
        const root = cloneGameNode(state.root);
        safeNode(root, state.path).shapes = [];
        return { ...state, root, dirty: true };
      }),

    setFen: (fen) =>
      set((state) => {
        const normalized = makeFen(parseFen(fen));
        return {
          ...state,
          root: createRootNode(normalized),
          path: [],
          headers: { ...state.headers, fen: normalized },
          dirty: true,
        };
      }),

    setHeaders: (headers) => set((state) => ({ ...state, headers, dirty: true })),

    setComment: (comment) =>
      set((state) => {
        const root = cloneGameNode(state.root);
        safeNode(root, state.path).comment = comment;
        return { ...state, root, dirty: true };
      }),

    goToNext: () =>
      set((state) => {
        const node = safeNode(state.root, state.path);
        if (!node.children[0]) return state;
        return { ...state, path: [...state.path, 0] };
      }),

    goToPrevious: () => set((state) => ({ ...state, path: state.path.slice(0, -1) })),

    goToStart: () => set((state) => ({ ...state, path: [] })),

    goToEnd: () =>
      set((state) => {
        const path = [...state.path];
        let node = safeNode(state.root, path);
        while (node.children[0]) {
          path.push(0);
          node = node.children[0];
        }
        return { ...state, path };
      }),

    goToMove: (path) => set((state) => ({ ...state, path: safePath(state.root, path) })),

    goToBranchStart: () =>
      set((state) => {
        let path = [...state.path];
        if (path.length > 0 && path[path.length - 1] !== 0) path = path.slice(0, -1);
        while (path.length > 0 && path[path.length - 1] === 0) path = path.slice(0, -1);
        return { ...state, path };
      }),

    goToBranchEnd: () =>
      set((state) => {
        const path = [...state.path];
        let node = safeNode(state.root, path);
        while (node.children[0]) {
          path.push(0);
          node = node.children[0];
        }
        return { ...state, path };
      }),

    nextBranch: () =>
      set((state) => {
        if (state.path.length === 0) return state;
        const parentPath = state.path.slice(0, -1);
        const parent = safeNode(state.root, parentPath);
        const index = state.path[state.path.length - 1];
        return {
          ...state,
          path: [...parentPath, (index + 1) % Math.max(parent.children.length, 1)],
        };
      }),

    previousBranch: () =>
      set((state) => {
        if (state.path.length === 0) return state;
        const parentPath = state.path.slice(0, -1);
        const parent = safeNode(state.root, parentPath);
        const index = state.path[state.path.length - 1];
        return {
          ...state,
          path: [...parentPath, (index + parent.children.length - 1) % parent.children.length],
        };
      }),

    nextBranching: () =>
      set((state) => {
        const path = [...state.path];
        let node = safeNode(state.root, path);
        while (node.children.length === 1) {
          path.push(0);
          node = node.children[0];
        }
        if (node.children.length > 1) path.push(0);
        return { ...state, path };
      }),

    previousBranching: () =>
      set((state) => {
        let path = [...state.path];
        while (path.length > 0) {
          path = path.slice(0, -1);
          if (safeNode(state.root, path).children.length > 1) break;
        }
        return { ...state, path };
      }),

    deleteMove: (path = get().path) =>
      set((state) => {
        if (path.length === 0) return state;
        const root = cloneGameNode(state.root);
        const parentPath = path.slice(0, -1);
        const parent = safeNode(root, parentPath);
        const index = path[path.length - 1];
        if (!parent.children[index]) return state;
        parent.children.splice(index, 1);
        return {
          ...state,
          root,
          path: isPrefix(path, state.path) ? parentPath : safePath(root, state.path),
          dirty: true,
        };
      }),

    deleteMovesFrom: (path) =>
      set((state) => {
        if (path.length === 0) return state;
        const root = cloneGameNode(state.root);
        const parentPath = path.slice(0, -1);
        const parent = safeNode(root, parentPath);
        const index = path[path.length - 1];
        if (!parent.children[index]) return state;
        parent.children.splice(index, 1);
        return {
          ...state,
          root,
          path: parentPath,
          dirty: true,
        };
      }),

    promoteVariation: (path) =>
      set((state) => {
        if (path.length === 0) return state;
        const root = cloneGameNode(state.root);
        const parentPath = path.slice(0, -1);
        const parent = safeNode(root, parentPath);
        const index = path[path.length - 1];
        if (index <= 0 || !parent.children[index]) return state;
        parent.children.unshift(parent.children.splice(index, 1)[0]);
        return { ...state, root, path: [...parentPath, 0], dirty: true };
      }),

    promoteToMainline: (path) =>
      set((state) => {
        let root = cloneGameNode(state.root);
        let nextPath = [...path];
        for (let depth = 0; depth < nextPath.length; depth += 1) {
          const index = nextPath[depth];
          if (index === 0) continue;
          const parentPath = nextPath.slice(0, depth);
          const parent = safeNode(root, parentPath);
          if (!parent.children[index]) continue;
          parent.children.unshift(parent.children.splice(index, 1)[0]);
          nextPath[depth] = 0;
          root = cloneGameNode(root);
        }
        return { ...state, root, path: nextPath, dirty: true };
      }),

    exportNotation: (format) => exportState(get(), format),

    importNotation: (text) =>
      set((state) => {
        const parsed = parseGameNotation(text);
        return {
          ...state,
          root: parsed.root,
          path: [],
          headers: {
            ...state.headers,
            event: parsed.headers.Event || state.headers.event,
            site: parsed.headers.Site || state.headers.site,
            red: parsed.headers.Red || parsed.headers.White || state.headers.red,
            black: parsed.headers.Black || state.headers.black,
            result: normalizeResult(parsed.headers.Result) ?? state.headers.result,
            resultReason:
              normalizeResultReason(parsed.headers.Termination) ??
              state.headers.resultReason ??
              null,
            fen: parsed.root.fen,
            title: parsed.headers.Title || parsed.headers.Event || state.headers.title,
          },
          dirty: true,
        };
      }),

    copyNotation: () => navigator.clipboard.writeText(exportState(get())),

    copyVariationNotation: (path) => {
      const state = get();
      const node = safeNodeOrNull(state.root, path);
      if (!node) return;
      navigator.clipboard.writeText(exportState({ headers: state.headers, root: node }));
    },

    save: () => set((state) => ({ ...state, dirty: false })),
    reset: () => set(() => defaultXiangqiState()),
  });

  const store = id
    ? createStore<XiangqiStoreState>()(
        persist(creator, {
          name: `${id}-xiangqi`,
          storage: createDebouncedSessionStorage<XiangqiStoreState>(),
        }),
      )
    : createStore<XiangqiStoreState>()(creator);

  return store;
}

function defaultXiangqiState() {
  const root = createRootNode();
  return {
    root,
    path: [],
    dirty: false,
    headers: defaultXiangqiHeaders(INITIAL_XIANGQI_FEN),
  };
}

function adjudicateXiangqiResult(
  position: ReturnType<typeof parseFen>,
): { result: XiangqiResult; reason: XiangqiResultReason } | null {
  const moves = legalMoves(position);
  if (moves.length === 0) {
    return {
      result: position.turn === "red" ? "0-1" : "1-0",
      reason: isInCheck(position, position.turn) ? "checkmate" : "noLegalMove",
    };
  }
  // 120 half-moves (60 full moves) without capture is the standard draw threshold.
  if (position.halfmove >= 120) {
    return { result: "1/2-1/2", reason: "naturalDraw" };
  }
  return null;
}

function adjudicateXiangqiRepetition(
  root: GameNode,
  path: number[],
): { result: XiangqiResult; reason: XiangqiResultReason } | null {
  const line = nodesAtPath(root, path);
  const current = line.at(-1);
  if (!current) return null;

  const currentKey = positionKey(current.fen);
  const occurrences = line
    .map((node, index) => ({ index, key: positionKey(node.fen) }))
    .filter((entry) => entry.key === currentKey);
  if (occurrences.length < 3) return null;

  const previous = occurrences[occurrences.length - 2]?.index;
  if (previous === undefined) return null;
  const cycle = describeRepetitionCycle(line, previous);
  const checkLoser = exclusiveSide(cycle, "checks");
  if (checkLoser) {
    return {
      result: checkLoser === "red" ? "0-1" : "1-0",
      reason: "perpetualCheck",
    };
  }

  const chaseLoser = exclusiveSide(cycle, "chases");
  if (chaseLoser) {
    return {
      result: chaseLoser === "red" ? "0-1" : "1-0",
      reason: "perpetualChase",
    };
  }

  return { result: "1/2-1/2", reason: "repetition" };
}

function nodesAtPath(root: GameNode, path: number[]): GameNode[] {
  const nodes = [root];
  let node = root;
  for (const index of path) {
    const child = node.children[index];
    if (!child) break;
    node = child;
    nodes.push(child);
  }
  return nodes;
}

function describeRepetitionCycle(line: GameNode[], startIndex: number) {
  const result: Record<XiangqiColor, { moves: number; checks: number; chases: number }> = {
    red: { moves: 0, checks: 0, chases: 0 },
    black: { moves: 0, checks: 0, chases: 0 },
  };

  for (let index = startIndex + 1; index < line.length; index += 1) {
    const before = parseFen(line[index - 1].fen);
    const after = parseFen(line[index].fen);
    const mover = before.turn;
    result[mover].moves += 1;
    if (isInCheck(after, after.turn)) {
      result[mover].checks += 1;
    }
    if (isChasingNonKingPiece(after, mover)) {
      result[mover].chases += 1;
    }
  }

  return result;
}

function exclusiveSide(
  cycle: Record<XiangqiColor, { moves: number; checks: number; chases: number }>,
  kind: "checks" | "chases",
): XiangqiColor | null {
  const red = cycle.red.moves > 0 && cycle.red[kind] === cycle.red.moves;
  const black = cycle.black.moves > 0 && cycle.black[kind] === cycle.black.moves;
  if (red === black) return null;
  return red ? "red" : "black";
}

// NOTE: This is an approximate heuristic. It detects whether the given color can
// capture any non-king enemy piece, but does not verify that the same piece is being
// chased on every move, nor whether the threatened piece is protected (making the
// capture a fair exchange). A full implementation of 长捉 requires tracking the
// chased piece's identity and protection across the cycle, which is non-trivial.
// Until then, perpetualChase verdicts should be treated as approximate.
function isChasingNonKingPiece(position: XiangqiPosition, color: XiangqiColor): boolean {
  const probe: XiangqiPosition = { ...position, turn: color };
  for (const move of legalMoves(probe)) {
    const target = position.board.get(move.to);
    if (target && target.color !== color && target.role !== "king") {
      return true;
    }
  }
  return false;
}

function exportState(
  state: Pick<XiangqiStoreState, "headers" | "root">,
  format: NotationMoveFormat = "coordinate",
): string {
  return exportGame(
    {
      id: "current",
      title: state.headers.title || state.headers.event || "Xiangqi Game",
      event: state.headers.event,
      red: state.headers.red,
      black: state.headers.black,
      result: state.headers.result,
      resultReason: state.headers.resultReason,
      root: state.root,
      updatedAt: Date.now(),
    },
    { moveFormat: format },
  );
}

function safeNode(root: GameNode, path: number[]): GameNode {
  return safeNodeOrNull(root, path) ?? root;
}

function safeNodeOrNull(root: GameNode, path: number[]): GameNode | null {
  try {
    return getNodeAtPath(root, path);
  } catch {
    return null;
  }
}

function safePath(root: GameNode, path: number[]): number[] {
  const next: number[] = [];
  let node = root;
  for (const index of path) {
    if (!node.children[index]) break;
    next.push(index);
    node = node.children[index];
  }
  return next;
}

function isPrefix(prefix: number[], path: number[]): boolean {
  return prefix.every((value, index) => path[index] === value);
}
