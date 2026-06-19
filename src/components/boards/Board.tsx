import { Box, Center, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { invoke } from "@tauri-apps/api/core";
import type { Piece } from "chessops";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import type { GoMode } from "@/bindings";
import type { ChessgroundRef } from "@/chessground/Chessground";
import {
  boardImageAtom,
  currentGameStateAtom,
  currentPlayersAtom,
  currentTabAtom,
  eraseDrawablesOnClickAtom,
  moveHighlightAtom,
  moveMethodAtom,
  pieceSetAtom,
  showDestsAtom,
  showVariationArrowsAtom,
  snapArrowsAtom,
  xiangqiPieceInnerScaleAtom,
  xiangqiPieceInnerRingVisibleAtom,
  xiangqiPieceTextScaleAtom,
  xiangqiClearDrawingsSignalAtom,
  xiangqiCloudArrowsAtom,
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
import { parseXiangqiEvaluation, scoreToEvalFill } from "@/xiangqi/evaluation";
import { useXiangqiStore, useXiangqiStoreApi } from "@/xiangqi/store";
import { useCustomXiangqiPieces } from "@/xiangqi/customPieceTheme";
import { XiangqiBoard } from "@/xiangqi/XiangqiBoard";
import { playSound } from "@/utils/sound";

const BAR_HEIGHT = "1.9rem";
const BOARD_GAP = "0.35rem";

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
  const pieceTextScale = useAtomValue(xiangqiPieceTextScaleAtom);
  const pieceInnerScale = useAtomValue(xiangqiPieceInnerScaleAtom);
  const pieceInnerRingVisible = useAtomValue(xiangqiPieceInnerRingVisibleAtom);
  const customPieceTheme = useCustomXiangqiPieces(pieceStyle === "custom-svg");
  const customPieceWarningShownRef = useRef(false);
  const showDests = useAtomValue(showDestsAtom);
  const showLastMove = useAtomValue(moveHighlightAtom);
  const moveMethod = useAtomValue(moveMethodAtom);
  const gameState = useAtomValue(currentGameStateAtom);
  const players = useAtomValue(currentPlayersAtom);
  const currentTab = useAtomValue(currentTabAtom);
  const eraseDrawablesOnClick = useAtomValue(eraseDrawablesOnClickAtom);
  const showVariationArrows = useAtomValue(showVariationArrowsAtom);
  const snapArrows = useAtomValue(snapArrowsAtom);
  const engineArrows = useAtomValue(xiangqiEngineArrowsAtom);
  const cloudArrows = useAtomValue(xiangqiCloudArrowsAtom);
  const engineEvaluation = useAtomValue(xiangqiEvaluationAtom);
  const clearDrawingsSignal = useAtomValue(xiangqiClearDrawingsSignalAtom);
  const previousClearDrawingsSignal = useRef(clearDrawingsSignal);
  const clockRef = useRef<XiangqiClockSnapshot>({
    red: whiteTime,
    black: blackTime,
    redIncrement: players.white?.timeControl?.increment ?? 0,
    blackIncrement: players.black?.timeControl?.increment ?? 0,
  });
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
  const useCustomPieces =
    pieceStyle === "custom-svg" &&
    !customPieceTheme.loading &&
    customPieceTheme.missing.length === 0;

  useEffect(() => {
    if (pieceStyle !== "custom-svg" || customPieceTheme.loading) return;
    if (customPieceTheme.missing.length === 0) {
      customPieceWarningShownRef.current = false;
      return;
    }
    if (customPieceWarningShownRef.current) return;

    customPieceWarningShownRef.current = true;
    notifications.show({
      color: "red",
      title: "自定义 SVG 棋子不完整",
      message: `请补齐 ${customPieceTheme.dir || "custom-pieces"} 中的文件：${customPieceTheme.missing.join("、")}`,
    });
  }, [pieceStyle, customPieceTheme.loading, customPieceTheme.missing, customPieceTheme.dir]);

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

  useEffect(() => {
    clockRef.current = {
      red: whiteTime,
      black: blackTime,
      redIncrement: players.white?.timeControl?.increment ?? 0,
      blackIncrement: players.black?.timeControl?.increment ?? 0,
    };
  }, [
    blackTime,
    players.black?.timeControl?.increment,
    players.white?.timeControl?.increment,
    whiteTime,
  ]);

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
    currentTab?.type === "play" && gameState === "playing"
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

    let canceled = false;
    const requestedFen = currentNode.fen;
    const requestKey = `${engine.id}:${currentNode.id}:${requestedFen}`;
    if (lastEngineRequest.current === requestKey) return;
    lastEngineRequest.current = requestKey;
    setSelected(null);
    setEngineThinking(true);

    void requestXiangqiBestMove(
      engine,
      currentNode.fen,
      resolveXiangqiGameGoMode(enginePlayer.go, enginePlayer.timeControl ? clockRef.current : null),
      enginePlayer.engineSettings,
    )
      .then((bestMove) => {
        if (canceled) return;
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
        if (!canceled) {
          setEngineThinking(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [
    currentNode.fen,
    currentNode.id,
    currentTab?.type,
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
          gap: BOARD_GAP,
          flexWrap: "nowrap",
          overflow: "hidden",
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
            flex: "1 1 0",
            flexWrap: "nowrap",
            minHeight: 0,
            width: "100%",
          }}
          gap="sm"
          justify="center"
          align="stretch"
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
            style={{
              aspectRatio: "9 / 10",
              flex: "0 1 auto",
              height: "100%",
              maxHeight: "100%",
              maxWidth: "calc(100% - 25px - var(--mantine-spacing-sm))",
              minHeight: 0,
            }}
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
                pieceStyle={useCustomPieces ? pieceStyle : "classic"}
                pieceTextScale={pieceTextScale}
                pieceInnerScale={pieceInnerScale}
                pieceInnerRingVisible={pieceInnerRingVisible[pieceStyle] ?? true}
                customPieceUrls={useCustomPieces ? customPieceTheme.urls : undefined}
                showDests={showDests}
                showLastMove={showLastMove}
                moveMethod={moveMethod}
                shapes={drawnShapes}
                autoShapes={[...cloudArrows, ...analysisShapes, ...variationShapes]}
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

type EngineAnalysis = {
  bestmove: string;
};

type XiangqiClockSnapshot = {
  red?: number;
  black?: number;
  redIncrement: number;
  blackIncrement: number;
};

async function requestXiangqiBestMove(
  engine: LocalEngine,
  fen: string,
  goMode: GoMode,
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
      depth: goMode.t === "Depth" ? Math.max(1, Math.min(goMode.c, 20)) : 8,
      multipv: 1,
      extraOptions: engineSettings
        .filter((setting) => !["Threads", "Hash", "MultiPV"].includes(setting.name))
        .filter((setting) => setting.value !== null && setting.value !== undefined)
        .map((setting) => ({
          name: setting.name,
          value: String(setting.value),
        })),
      goMode,
    },
  });

  if (!result.bestmove || result.bestmove === "0000") return null;
  return result.bestmove;
}

function resolveXiangqiGameGoMode(goMode: GoMode | undefined, clock: XiangqiClockSnapshot | null) {
  if (clock) {
    return {
      t: "PlayersTime",
      c: {
        white: toUciClockValue(clock.red),
        black: toUciClockValue(clock.black),
        winc: toUciClockValue(clock.redIncrement),
        binc: toUciClockValue(clock.blackIncrement),
      },
    } satisfies GoMode;
  }

  if (!goMode || goMode.t === "Infinite" || goMode.t === "PlayersTime") {
    return { t: "Depth", c: 8 } satisfies GoMode;
  }

  return goMode;
}

function toUciClockValue(value: number | undefined) {
  const MAX_UCI_TIME = 2_147_483_647;
  if (value === undefined || !Number.isFinite(value)) return MAX_UCI_TIME;
  return Math.max(1, Math.min(Math.round(value), MAX_UCI_TIME));
}

export default memo(Board);
