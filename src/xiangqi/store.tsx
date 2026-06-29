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
  type GameNode,
  type XiangqiDrawShape,
  type XiangqiMove,
} from "./xiangqi";
import { adjudicateXiangqiRepetition, xiangqiNaturalDrawReached } from "./rules";

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
          adjudicateXiangqiResult(root, nextPath, result.position) ??
          adjudicateXiangqiRepetition(root, nextPath);
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
  root: GameNode,
  path: number[],
  position: ReturnType<typeof parseFen>,
): { result: XiangqiResult; reason: XiangqiResultReason } | null {
  const moves = legalMoves(position);
  if (moves.length === 0) {
    return {
      result: position.turn === "red" ? "0-1" : "1-0",
      reason: isInCheck(position, position.turn) ? "checkmate" : "noLegalMove",
    };
  }
  if (xiangqiNaturalDrawReached(root, path)) {
    return { result: "1/2-1/2", reason: "naturalDraw" };
  }
  return null;
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
