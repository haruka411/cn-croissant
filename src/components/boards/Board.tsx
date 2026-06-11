import { Box, Center, Group, Text } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import type { Piece } from "chessops";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import type { ChessgroundRef } from "@/chessground/Chessground";
import {
  boardImageAtom,
  currentGameStateAtom,
  currentPlayersAtom,
  eraseDrawablesOnClickAtom,
  moveHighlightAtom,
  moveMethodAtom,
  pieceSetAtom,
  showCoordinatesAtom,
  showDestsAtom,
  showVariationArrowsAtom,
  snapArrowsAtom,
  xiangqiClearDrawingsSignalAtom,
  xiangqiEngineArrowsAtom,
  xiangqiEvaluationAtom,
} from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import { useAtomValue } from "jotai";
import classes from "@/styles/Chessboard.module.css";
import type { EngineSettings, LocalEngine } from "@/utils/engines";
import { BoardBar } from "./BoardBar";
import {
  applyMove,
  parseFen,
  parseUciMove,
  type Square,
  type XiangqiDrawShape,
  type XiangqiMove,
} from "@/xiangqi/xiangqi";
import { useXiangqiStore, useXiangqiStoreApi } from "@/xiangqi/store";
import { XiangqiBoard } from "@/xiangqi/XiangqiBoard";
import { playSound } from "@/utils/sound";

const BAR_HEIGHT = "1.9rem";

interface ChessboardProps {
  editingMode: boolean;
  viewOnly?: boolean;
  disableVariations?: boolean;
  movable?: "both" | "white" | "black" | "turn" | "none";
  boardRef: React.MutableRefObject<HTMLDivElement | null>;
  whiteTime?: number;
  blackTime?: number;
  practicing?: boolean;
  selectedPiece?: Piece | null;
  onMove?: (uci: string, side: "red" | "black") => void;
  cgRef?: React.Ref<ChessgroundRef>;
  enablePremoves?: boolean;
}

function Board({ editingMode, viewOnly, boardRef, whiteTime, blackTime, onMove }: ChessboardProps) {
  const { t } = useTranslation();
  const xiangqiStore = useXiangqiStoreApi();
  const headers = useXiangqiStore((s) => s.headers);
  const setHeaders = useXiangqiStore((s) => s.setHeaders);
  const currentNode = useXiangqiStore((s) => s.currentNode());
  const makeXiangqiMove = useXiangqiStore((s) => s.makeMove);
  const setCurrentNodeShapes = useXiangqiStore((s) => s.setShapes);
  const [selected, setSelected] = useState<Square | null>(null);
  const [engineThinking, setEngineThinking] = useState(false);
  const lastEngineRequest = useRef<string | null>(null);
  const position = useMemo(() => parseFen(currentNode.fen), [currentNode.fen]);
  const lastMove = currentNode.move ? parseUciMove(currentNode.move) : null;
  const boardTheme = useAtomValue(boardImageAtom);
  const pieceStyle = useAtomValue(pieceSetAtom);
  const showDests = useAtomValue(showDestsAtom);
  const showLastMove = useAtomValue(moveHighlightAtom);
  const showCoordinates = useAtomValue(showCoordinatesAtom);
  const moveMethod = useAtomValue(moveMethodAtom);
  const gameState = useAtomValue(currentGameStateAtom);
  const players = useAtomValue(currentPlayersAtom);
  const eraseDrawablesOnClick = useAtomValue(eraseDrawablesOnClickAtom);
  const showVariationArrows = useAtomValue(showVariationArrowsAtom);
  const snapArrows = useAtomValue(snapArrowsAtom);
  const engineArrows = useAtomValue(xiangqiEngineArrowsAtom);
  const engineEvaluation = useAtomValue(xiangqiEvaluationAtom);
  const clearDrawingsSignal = useAtomValue(xiangqiClearDrawingsSignalAtom);
  const previousClearDrawingsSignal = useRef(clearDrawingsSignal);
  const [displayedEngineEval, setDisplayedEngineEval] = useState<{
    redCentipawns: number;
    label: string;
  } | null>(null);

  const orientation = headers.orientation === "black" ? "black" : "red";
  const redLabel = t("Board.Xiangqi.Red");
  const blackLabel = t("Board.Xiangqi.Black");
  const topPlayer = orientation === "red" ? headers.black || blackLabel : headers.red || redLabel;
  const bottomPlayer =
    orientation === "red" ? headers.red || redLabel : headers.black || blackLabel;
  const topTime = orientation === "red" ? blackTime : whiteTime;
  const bottomTime = orientation === "red" ? whiteTime : blackTime;

  const toggleOrientation = () =>
    setHeaders({
      ...headers,
      orientation: headers.orientation === "black" ? "red" : "black",
    });

  const clearCurrentNodeShapes = useCallback(() => {
    if ((currentNode.shapes ?? []).length === 0) return;
    setCurrentNodeShapes([]);
  }, [currentNode.shapes, setCurrentNodeShapes]);

  const keyMap = useAtomValue(keyMapAtom);
  useHotkeys(keyMap.SWAP_ORIENTATION.keys, () => toggleOrientation());
  useHotkeys(keyMap.CLEAR_SHAPES.keys, () => clearCurrentNodeShapes());

  useEffect(() => {
    if (previousClearDrawingsSignal.current === clearDrawingsSignal) return;
    previousClearDrawingsSignal.current = clearDrawingsSignal;
    clearCurrentNodeShapes();
  }, [clearDrawingsSignal, clearCurrentNodeShapes]);

  function makeMove(move: XiangqiMove) {
    if (viewOnly && !editingMode) return;

    let result;
    try {
      result = applyMove(position, move);
    } catch {
      return;
    }

    makeXiangqiMove(move);
    setSelected(null);
    playSound(result.captured !== null, result.check);
    onMove?.(`${move.from}${move.to}`, position.turn);
  }

  const enginePlayer =
    gameState === "playing"
      ? position.turn === "red"
        ? players.white.type === "engine"
          ? players.white
          : null
        : players.black.type === "engine"
          ? players.black
          : null
      : null;

  const engine = enginePlayer?.engine;

  useEffect(() => {
    if (!engine || engineThinking || editingMode || viewOnly) return;

    const requestedFen = currentNode.fen;
    const requestKey = `${engine.id}:${requestedFen}`;
    if (lastEngineRequest.current === requestKey) return;
    lastEngineRequest.current = requestKey;
    setSelected(null);
    setEngineThinking(true);

    void requestXiangqiBestMove(
      engine,
      currentNode.fen,
      enginePlayer.go?.t === "Depth" ? enginePlayer.go.c : 8,
      enginePlayer.engineSettings,
    )
      .then((bestMove) => {
        if (!bestMove) return;
        const parsed = parseUciMove(bestMove);
        if (!parsed) return;
        if (xiangqiStore.getState().currentNode().fen !== requestedFen) return;
        let result;
        try {
          result = applyMove(parseFen(requestedFen), parsed);
        } catch {
          return;
        }
        xiangqiStore.getState().makeMove(parsed);
        playSound(result.captured !== null, result.check);
        onMove?.(bestMove, result.position.turn === "red" ? "black" : "red");
      })
      .finally(() => {
        setEngineThinking(false);
      });
  }, [
    currentNode.fen,
    editingMode,
    engine,
    enginePlayer,
    engineThinking,
    onMove,
    xiangqiStore,
    viewOnly,
  ]);

  const engineEval = useMemo(
    () =>
      engineEvaluation?.fen === currentNode.fen && engineEvaluation.score
        ? parseXiangqiEvaluation(engineEvaluation.score, position.turn)
        : null,
    [currentNode.fen, engineEvaluation?.fen, engineEvaluation?.score, position.turn],
  );

  useEffect(() => {
    if (engineEval) {
      setDisplayedEngineEval(engineEval);
      return;
    }
    if (!engineEvaluation) {
      setDisplayedEngineEval(null);
      return;
    }
    if (engineEvaluation?.pending || engineEvaluation?.fen !== currentNode.fen) return;
    setDisplayedEngineEval(null);
  }, [currentNode.fen, engineEval, engineEvaluation?.fen, engineEvaluation?.pending]);

  const evalFill = displayedEngineEval ? scoreToEvalFill(displayedEngineEval.redCentipawns) : 50;
  const drawnShapes = currentNode.shapes ?? [];
  const variationShapes = useMemo<XiangqiDrawShape[]>(() => {
    if (!showVariationArrows || currentNode.children.length < 2) return [];

    return currentNode.children
      .map((child) => (child.move ? parseUciMove(child.move) : null))
      .filter((move): move is XiangqiMove => move !== null)
      .map((move) => ({
        orig: move.from,
        dest: move.to,
        brush: "variation",
        modifiers: { lineWidth: 7.5 },
      }));
  }, [currentNode.children, showVariationArrows]);
  const analysisShapes = useMemo<XiangqiDrawShape[]>(
    () =>
      engineArrows
        .filter((shape): shape is XiangqiDrawShape => Boolean(shape.orig))
        .map((shape) => ({
          ...shape,
          modifiers: { lineWidth: 8.5, ...shape.modifiers },
        })),
    [engineArrows],
  );

  return (
    <Box w="100%" h="100%">
      <Box
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          gap: "0.5rem",
          flexWrap: "nowrap",
          overflow: "hidden",
          maxWidth:
            "calc(100vh - 2.25rem - var(--mantine-spacing-sm) - 2.5rem - var(--mantine-spacing-sm) - 1.9rem - 1.9rem + 1.563rem + var(--mantine-spacing-md) - 1rem - 0.2rem)",
        }}
      >
        <BoardBar name={topPlayer} onNameClick={() => {}} height={BAR_HEIGHT}>
          <Group gap="xs" wrap="nowrap">
            {topTime !== undefined && (
              <Text size="sm" fw={800}>
                {formatClock(topTime)}
              </Text>
            )}
            <Text size="xs" c="dimmed">
              {engineThinking
                ? t("Board.Xiangqi.EngineThinking")
                : position.turn === "red"
                  ? t("Board.Xiangqi.RedToMove")
                  : t("Board.Xiangqi.BlackToMove")}
            </Text>
          </Group>
        </BoardBar>

        <Group
          style={{
            position: "relative",
            flexWrap: "nowrap",
          }}
          gap="sm"
        >
          <Box h="100%" style={{ width: 25 }}>
            <Center h="100%" w="100%">
              {displayedEngineEval && (
                <Box
                  style={{
                    position: "relative",
                    width: "1.05rem",
                    height: "100%",
                    minHeight: "15rem",
                    borderRadius: 999,
                    overflow: "hidden",
                    background: "light-dark(#20242a, #0d1117)",
                    border: "1px solid light-dark(#c8c1b7, #344050)",
                  }}
                >
                  <Box
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: `${evalFill}%`,
                      background: "#b42124",
                      transition: "height 360ms cubic-bezier(0.22, 1, 0.36, 1)",
                      willChange: "height",
                    }}
                  />
                  <Text
                    size="xs"
                    fw={800}
                    c="white"
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: "50%",
                      transform: "translate(-50%, -50%) rotate(-90deg)",
                      textShadow: "0 1px 2px rgba(0, 0, 0, 0.55)",
                    }}
                  >
                    {displayedEngineEval.label}
                  </Text>
                </Box>
              )}
            </Center>
          </Box>
          <Box
            className={classes.chessboard}
            ref={boardRef}
            style={{ aspectRatio: "9 / 10", minHeight: 0 }}
            onClick={() => {
              if (eraseDrawablesOnClick) clearCurrentNodeShapes();
            }}
          >
            <div
              className="cg-wrap"
              style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}
            >
              <XiangqiBoard
                position={position}
                selected={selected}
                lastMove={lastMove}
                orientation={orientation}
                boardTheme={boardTheme}
                pieceStyle={pieceStyle}
                showDests={showDests}
                showLastMove={showLastMove}
                showCoordinates={showCoordinates}
                moveMethod={moveMethod}
                shapes={drawnShapes}
                autoShapes={[...analysisShapes, ...variationShapes]}
                snapDrawings={snapArrows}
                drawingsEnabled={!editingMode}
                onShapesChange={setCurrentNodeShapes}
                onSelect={enginePlayer || engineThinking ? () => {} : setSelected}
                onMove={makeMove}
              />
            </div>
          </Box>
        </Group>

        <BoardBar name={bottomPlayer} onNameClick={() => {}} height={BAR_HEIGHT}>
          <Group gap="xs" wrap="nowrap">
            {bottomTime !== undefined && (
              <Text size="sm" fw={800}>
                {formatClock(bottomTime)}
              </Text>
            )}
            <Text size="xs" c="dimmed">
              {displayedEngineEval
                ? `${t("Board.Analysis.Eval")}: ${displayedEngineEval.label}`
                : null}
            </Text>
          </Group>
        </BoardBar>
      </Box>
    </Box>
  );
}

function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function parseXiangqiEvaluation(
  score: string,
  turn: "red" | "black",
): { redCentipawns: number; label: string } | null {
  const [kind, raw] = score.split(/\s+/);
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;

  const redValue = turn === "red" ? value : -value;
  if (kind === "cp") {
    return {
      redCentipawns: redValue,
      label: `${redValue >= 0 ? "+" : ""}${(redValue / 100).toFixed(2)}`,
    };
  }

  if (kind === "mate") {
    return {
      redCentipawns: Math.sign(redValue || 1) * 1200,
      label: `${redValue >= 0 ? "+" : "-"}M${Math.abs(redValue)}`,
    };
  }

  return null;
}

function scoreToEvalFill(redCentipawns: number): number {
  const winChance = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * redCentipawns)) - 1);
  return Math.max(3, Math.min(97, winChance));
}

type EngineAnalysis = {
  bestmove: string;
};

async function requestXiangqiBestMove(
  engine: LocalEngine,
  fen: string,
  depth: number,
  settings: EngineSettings | undefined,
): Promise<string | null> {
  const engineSettings = settings ?? engine.settings ?? [];
  const result = await invoke<EngineAnalysis>("analyze_position", {
    request: {
      engine: {
        id: engine.id,
        name: engine.name,
        path: engine.path,
        protocol: engine.protocol ?? "uci",
        threads: Number(engineSettings.find((setting) => setting.name === "Threads")?.value) || 1,
        hash: Number(engineSettings.find((setting) => setting.name === "Hash")?.value) || 64,
        moveTimeMs: null,
      },
      fen,
      moves: [],
      depth: Math.max(1, Math.min(depth, 20)),
      multipv: 1,
    },
  });

  if (!result.bestmove || result.bestmove === "0000") return null;
  return result.bestmove;
}

export default memo(Board);
