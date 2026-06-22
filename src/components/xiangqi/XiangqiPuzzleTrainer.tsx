import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Paper,
  Portal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";

// Experimental Wukong/chessdb-backed Xiangqi puzzle trainer.
// Kept for future iteration; the public puzzle entry currently shows a "developing" placeholder.
import {
  IconAlertCircle,
  IconBulb,
  IconEraser,
  IconPlayerSkipForward,
  IconRefresh,
  IconTargetArrow,
} from "@tabler/icons-react";
import { useElementSize } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  boardImageAtom,
  customBoardCalibrationAtom,
  customBoardImageAtom,
  customPieceDirectoryAtom,
  customPieceScaleAtom,
  customPieceThemeConfirmedAtom,
  moveHighlightAtom,
  moveMethodAtom,
  pieceSetAtom,
  showCoordinatesAtom,
  showDestsAtom,
  snapArrowsAtom,
  xiangqiPieceInnerRingVisibleAtom,
  xiangqiPieceInnerScaleAtom,
  xiangqiPieceTextScaleAtom,
} from "@/state/atoms";
import { BoardBar } from "@/components/boards/BoardBar";
import { formatXiangqiMove } from "@/xiangqi/notation";
import {
  applyMove,
  legalMoves,
  makeFen,
  parseFen,
  parseUciMove,
  type Square,
  type XiangqiDrawShape,
  type XiangqiMove,
  type XiangqiPosition,
} from "@/xiangqi/xiangqi";
import { XiangqiBoard } from "@/xiangqi/XiangqiBoard";
import { useCustomXiangqiPieces } from "@/xiangqi/customPieceTheme";
import { customBoardImageUrl as getCustomBoardImageUrl } from "@/xiangqi/customBoardTheme";
import {
  queryXiangqiPuzzleBestMove,
  queryXiangqiPuzzleMoves,
  topChessdbOutcome,
  type ChessdbMoveInfo,
  type ChessdbOutcome,
} from "@/utils/chessdb/xiangqi";
import { playSound } from "@/utils/sound";
import wukongPuzzles from "@/data/wukong-xiangqi/puzzles_verified_sorted.json";
import classes from "@/styles/Chessboard.module.css";

type WukongPuzzle = {
  id: string;
  title: string;
  fen: string;
  description: string;
};

const PUZZLES = wukongPuzzles as WukongPuzzle[];
const FIRST_PUZZLE = PUZZLES[0];

type TrainerStatus = "idle" | "loading" | "ready" | "correct" | "wrong" | "finished" | "error";

export default function XiangqiPuzzleTrainer() {
  const [puzzleIndex, setPuzzleIndex] = useState(0);
  const [initialFen, setInitialFen] = useState(FIRST_PUZZLE.fen);
  const [fenInput, setFenInput] = useState(FIRST_PUZZLE.fen);
  const [position, setPosition] = useState(() => parseFen(FIRST_PUZZLE.fen));
  const [selected, setSelected] = useState<Square | null>(null);
  const [lastMove, setLastMove] = useState<XiangqiMove | null>(null);
  const [targetMove, setTargetMove] = useState<string | null>(null);
  const [candidateMoves, setCandidateMoves] = useState<ChessdbMoveInfo[]>([]);
  const [status, setStatus] = useState<TrainerStatus>("idle");
  const [message, setMessage] = useState("请选择正确杀法。");
  const [error, setError] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [stats, setStats] = useState({ solved: 0, mistakes: 0 });
  const [history, setHistory] = useState<string[]>([]);
  const requestIdRef = useRef(0);
  const { ref: boardParentRef, height: boardParentHeight } = useElementSize();

  const boardTheme = useAtomValue(boardImageAtom);
  const customBoardCalibration = useAtomValue(customBoardCalibrationAtom);
  const customBoardImage = useAtomValue(customBoardImageAtom);
  const pieceStyle = useAtomValue(pieceSetAtom);
  const customPieceDirectory = useAtomValue(customPieceDirectoryAtom);
  const customPieceScale = useAtomValue(customPieceScaleAtom);
  const customPieceThemeConfirmed = useAtomValue(customPieceThemeConfirmedAtom);
  const pieceTextScale = useAtomValue(xiangqiPieceTextScaleAtom);
  const pieceInnerScale = useAtomValue(xiangqiPieceInnerScaleAtom);
  const pieceInnerRingVisible = useAtomValue(xiangqiPieceInnerRingVisibleAtom);
  const customPieceTheme = useCustomXiangqiPieces(
    pieceStyle === "custom-svg",
    customPieceDirectory || undefined,
  );
  const customPieceWarningShownRef = useRef(false);
  const showDests = useAtomValue(showDestsAtom);
  const showLastMove = useAtomValue(moveHighlightAtom);
  const showCoordinates = useAtomValue(showCoordinatesAtom);
  const moveMethod = useAtomValue(moveMethodAtom);
  const snapArrows = useAtomValue(snapArrowsAtom);

  const currentPuzzle = PUZZLES[puzzleIndex % PUZZLES.length] ?? FIRST_PUZZLE;
  const normalizedFen = useMemo(() => makeFen(position), [position]);
  const orientation = useMemo(() => fenSide(currentPuzzle.fen), [currentPuzzle.fen]);
  const customBoardUrl =
    boardTheme === "custom-png" && customBoardImage
      ? getCustomBoardImageUrl(customBoardImage)
      : undefined;
  const resolvedBoardTheme =
    boardTheme === "custom-png" && !customBoardUrl ? "classic" : boardTheme;
  const boardAspectRatio = resolvedBoardTheme === "custom-png" ? "767 / 842" : "9 / 10";
  const targetShape = useMemo<XiangqiDrawShape[]>(() => {
    if (!showHint || !targetMove) return [];
    const move = parseUciMove(targetMove);
    return move ? [{ orig: move.from, dest: move.to, brush: "green" }] : [];
  }, [showHint, targetMove]);
  const bestMoveLabel = useMemo(() => {
    if (!targetMove) return null;
    const move = parseUciMove(targetMove);
    if (!move) return targetMove;
    return formatXiangqiMove(position, move, "chinese");
  }, [position, targetMove]);
  const trainerSideLabel = orientation === "red" ? "红方" : "黑方";
  const toMoveLabel = position.turn === "red" ? "红方" : "黑方";
  const canUserMove = status === "ready" || status === "wrong";
  const customPieceThemeChecked = customPieceTheme.checkedDirs.length > 0;
  const useCustomPieces =
    pieceStyle === "custom-svg" &&
    customPieceThemeConfirmed &&
    customPieceThemeChecked &&
    !customPieceTheme.loading &&
    customPieceTheme.missing.length === 0;

  useEffect(() => {
    if (
      pieceStyle !== "custom-svg" ||
      !customPieceThemeConfirmed ||
      customPieceTheme.loading ||
      !customPieceThemeChecked
    )
      return;
    if (customPieceTheme.missing.length === 0) {
      customPieceWarningShownRef.current = false;
      return;
    }
    if (customPieceWarningShownRef.current) return;

    customPieceWarningShownRef.current = true;
    notifications.show({
      color: "red",
      title: "自定义 SVG 棋子不完整",
      message: `已检查：${customPieceTheme.checkedDirs.join("；")}。请补齐文件：${customPieceTheme.missing.join("、")}`,
    });
  }, [
    pieceStyle,
    customPieceThemeConfirmed,
    customPieceTheme.loading,
    customPieceThemeChecked,
    customPieceTheme.missing,
    customPieceTheme.checkedDirs,
  ]);
  const acceptedMoves = useMemo(
    () => acceptedMoveSet(candidateMoves, targetMove),
    [candidateMoves, targetMove],
  );
  const positionOutcome = useMemo(() => topChessdbOutcome(candidateMoves), [candidateMoves]);

  const loadPosition = useCallback(
    async (
      fen: string,
      options: { resetInitial?: boolean; clearHistory?: boolean; keepLastMove?: boolean } = {},
    ) => {
      const requestId = ++requestIdRef.current;
      setStatus("loading");
      setError(null);
      setShowHint(false);
      setSelected(null);
      setCandidateMoves([]);
      setTargetMove(null);
      setMessage("正在准备题目...");

      let parsed: XiangqiPosition;
      try {
        parsed = parseFen(fen);
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
        return;
      }

      setPosition(parsed);
      if (!options.keepLastMove) {
        setLastMove(null);
      }
      if (options.resetInitial) {
        const normalized = makeFen(parsed);
        setInitialFen(normalized);
        setFenInput(normalized);
      }
      if (options.clearHistory) {
        setHistory([]);
      }

      try {
        const [bestMove, moves] = await Promise.all([
          queryXiangqiPuzzleBestMove(makeFen(parsed)),
          queryXiangqiPuzzleMoves(makeFen(parsed)),
        ]);
        if (requestId !== requestIdRef.current) return;
        setCandidateMoves(moves);
        if (!bestMove) {
          setStatus("finished");
          setMessage(endMessage(moves));
          return;
        }
        setTargetMove(bestMove.move);
        setStatus("ready");
        setMessage("请选择正确杀法。");
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  useEffect(() => {
    void loadPosition(currentPuzzle.fen, { resetInitial: true, clearHistory: true });
  }, [currentPuzzle.fen, loadPosition]);

  async function applyPuzzleMove(
    before: XiangqiPosition,
    move: XiangqiMove,
    kind: "user" | "cloud",
  ) {
    let result;
    try {
      result = applyMove(before, move);
    } catch {
      return false;
    }

    setPosition(result.position);
    setLastMove(move);
    setSelected(null);
    setHistory((current) => [
      ...current,
      `${kind === "user" ? "你" : "云库"}: ${formatXiangqiMove(before, move, "chinese")}`,
    ]);
    playSound(result.captured !== null, result.check);
    return result.position;
  }

  async function handleMove(move: XiangqiMove) {
    if (!canUserMove || !targetMove) return;
    const userMove = `${move.from}${move.to}`;
    if (!acceptedMoves.has(userMove)) {
      setStats((current) => ({ ...current, mistakes: current.mistakes + 1 }));
      setStatus("wrong");
      setShowHint(true);
      setMessage("这步不对。可以重试，或查看提示。");
      return;
    }

    const nextPosition = await applyPuzzleMove(position, move, "user");
    if (!nextPosition) return;
    setStats((current) => ({ ...current, solved: current.solved + 1 }));
    setStatus("correct");
    setMessage("正确。");

    const reply = await queryXiangqiPuzzleBestMove(makeFen(nextPosition));
    if (!reply) {
      setStatus("finished");
      setTargetMove(null);
      setCandidateMoves([]);
      setMessage("这一题已经完成。");
      return;
    }

    const replyMove = parseUciMove(reply.move);
    if (!replyMove) {
      setStatus("finished");
      setTargetMove(null);
      setMessage(`云库返回了暂不能识别的应手：${reply.raw}`);
      return;
    }

    let afterReply: XiangqiPosition;
    try {
      afterReply = applyMove(nextPosition, replyMove).position;
    } catch {
      setStatus("finished");
      setTargetMove(null);
      setMessage(`云库应手 ${reply.move} 在当前局面下不合法，训练停止。`);
      return;
    }

    setPosition(afterReply);
    setLastMove(replyMove);
    setHistory((current) => [
      ...current,
      `云库: ${formatXiangqiMove(nextPosition, replyMove, "chinese")}`,
    ]);
    setShowHint(false);
    playSound(false, false);
    await loadPosition(makeFen(afterReply), { keepLastMove: true });
  }

  function restartPuzzle() {
    void loadPosition(initialFen, { clearHistory: true });
  }

  function nextPuzzle() {
    const nextIndex = (puzzleIndex + 1) % PUZZLES.length;
    setPuzzleIndex(nextIndex);
  }

  function loadCustomFen() {
    void loadPosition(fenInput, { resetInitial: true, clearHistory: true });
  }

  const legalMoveCount = legalMoves(position).length;

  return (
    <>
      <Portal target="#left" style={{ height: "100%" }}>
        <Box h="100%" w="100%" ref={boardParentRef}>
          <Stack h="100%" gap="xs">
            <BoardBar name={`杀法训练 · ${toMoveLabel}走`} onNameClick={() => {}} height="1.9rem">
              <Text size="xs" c="dimmed">
                {statusLabel(status)}
              </Text>
            </BoardBar>
            <Center style={{ flex: 1, minHeight: 0 }}>
              <Box
                className={classes.chessboard}
                style={{
                  aspectRatio: boardAspectRatio,
                  height:
                    boardParentHeight > 0
                      ? `min(100%, ${Math.max(0, boardParentHeight - 76)}px)`
                      : "100%",
                  maxHeight:
                    boardParentHeight > 0 ? `${Math.max(0, boardParentHeight - 76)}px` : "100%",
                  maxWidth: "100%",
                  flex: "0 1 auto",
                  minHeight: 0,
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
                    boardTheme={resolvedBoardTheme}
                    pieceStyle={
                      useCustomPieces
                        ? "custom-svg"
                        : pieceStyle === "custom-svg"
                          ? "classic"
                          : pieceStyle
                    }
                    pieceTextScale={pieceTextScale}
                    pieceInnerScale={pieceInnerScale}
                    pieceInnerRingVisible={pieceInnerRingVisible[pieceStyle] ?? true}
                    customBoardImageUrl={customBoardUrl}
                    customBoardCalibration={customBoardCalibration}
                    customPieceUrls={useCustomPieces ? customPieceTheme.urls : undefined}
                    customPieceScale={customPieceScale}
                    showDests={showDests}
                    showLastMove={showLastMove}
                    coordinates={showCoordinates}
                    moveMethod={moveMethod}
                    autoShapes={targetShape}
                    snapDrawings={snapArrows}
                    drawingsEnabled={false}
                    onShapesChange={() => {}}
                    onSelect={canUserMove ? setSelected : () => {}}
                    onMove={handleMove}
                  />
                </div>
              </Box>
            </Center>
            <BoardBar name={`${trainerSideLabel}杀法`} onNameClick={() => {}} height="1.9rem">
              <Text size="xs" c="dimmed">
                合法着法 {legalMoveCount}
              </Text>
            </BoardBar>
          </Stack>
        </Box>
      </Portal>

      <Portal target="#topRight" style={{ height: "100%" }}>
        <Paper h="100%" withBorder p="md" style={{ overflow: "hidden" }}>
          <Stack h="100%" gap="sm">
            <Group justify="space-between" align="flex-start">
              <Box>
                <Title order={3}>杀法训练</Title>
                <Text size="sm" c="dimmed">
                  {currentPuzzle.title} · {currentPuzzle.id}
                </Text>
              </Box>
              <Badge color={statusColor(status)} variant="light">
                {statusLabel(status)}
              </Badge>
            </Group>

            <Text size="sm" style={{ whiteSpace: "pre-line" }}>
              {currentPuzzle.description}
            </Text>

            {error ? (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {error}
              </Alert>
            ) : (
              <Alert
                color={status === "wrong" ? "yellow" : "blue"}
                icon={<IconTargetArrow size={16} />}
              >
                {message}
              </Alert>
            )}

            <Group grow>
              <Paper withBorder p="xs">
                <Text size="xs" c="dimmed">
                  正确
                </Text>
                <Text fw={700}>{stats.solved}</Text>
              </Paper>
              <Paper withBorder p="xs">
                <Text size="xs" c="dimmed">
                  错误
                </Text>
                <Text fw={700}>{stats.mistakes}</Text>
              </Paper>
            </Group>

            <Group grow>
              <Button leftSection={<IconRefresh size={16} />} onClick={restartPuzzle}>
                重来
              </Button>
              <Button
                variant="light"
                leftSection={<IconPlayerSkipForward size={16} />}
                onClick={nextPuzzle}
              >
                下一题
              </Button>
            </Group>

            <Group grow>
              <Tooltip label={bestMoveLabel ?? "当前没有提示"}>
                <Button
                  variant="default"
                  leftSection={<IconBulb size={16} />}
                  disabled={!targetMove}
                  onClick={() => setShowHint((value) => !value)}
                >
                  提示
                </Button>
              </Tooltip>
              <Button
                variant="default"
                leftSection={<IconEraser size={16} />}
                onClick={() => setStats({ solved: 0, mistakes: 0 })}
              >
                清统计
              </Button>
            </Group>

            <Divider />

            <Group grow>
              <Paper withBorder p="xs">
                <Text size="xs" c="dimmed">
                  题库
                </Text>
                <Text fw={700}>Wukong</Text>
              </Paper>
              <Paper withBorder p="xs">
                <Text size="xs" c="dimmed">
                  对手
                </Text>
                <Text fw={700}>云库</Text>
              </Paper>
            </Group>

            {positionOutcome ? (
              <Group gap="xs">
                <Badge color={outcomeColor(positionOutcome.result)} variant="filled">
                  {outcomeLabel(positionOutcome.result)}
                </Badge>
                <Text size="sm" c="dimmed">
                  {outcomeDetail(positionOutcome)}
                </Text>
              </Group>
            ) : null}

            <Stack gap={6}>
              <Text size="sm" fw={600}>
                自定义 FEN
              </Text>
              <TextInput
                value={fenInput}
                onChange={(event) => setFenInput(event.currentTarget.value)}
                size="xs"
              />
              <Button variant="light" onClick={loadCustomFen}>
                从此局面练习
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Portal>

      <Portal target="#bottomRight" style={{ height: "100%" }}>
        <Stack h="100%" gap="xs">
          <Paper withBorder p="md" mih="5rem" style={{ flexShrink: 0 }}>
            <Group justify="space-between" align="center">
              <Text fw={600}>走法记录</Text>
              <Badge variant="light">{history.length}</Badge>
            </Group>
            <Text size="xs" c="dimmed" lineClamp={3} mt="xs">
              {history.length > 0 ? history.join("  ") : "尚未走棋"}
            </Text>
          </Paper>

          <Paper withBorder p="md" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <Stack h="100%" gap="xs">
              <Group justify="space-between">
                <Text fw={600}>候选着法</Text>
                <Badge variant="light">{candidateMoves.length}</Badge>
              </Group>
              <ScrollArea h="100%" offsetScrollbars>
                <Stack gap={4}>
                  {candidateMoves.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      暂无候选着法。
                    </Text>
                  ) : (
                    candidateMoves.slice(0, 24).map((move) => (
                      <Group key={move.move} justify="space-between" wrap="nowrap">
                        <Text size="sm">{formatMoveFromFen(position, move.move)}</Text>
                        <Text size="xs" c="dimmed">
                          {move.outcome
                            ? outcomeDetail(move.outcome)
                            : move.note || scoreLabel(move.score)}
                        </Text>
                      </Group>
                    ))
                  )}
                </Stack>
              </ScrollArea>
              <Text size="xs" c="dimmed" lineClamp={2}>
                {normalizedFen}
              </Text>
            </Stack>
          </Paper>
        </Stack>
      </Portal>
    </>
  );
}

function formatMoveFromFen(position: XiangqiPosition, moveText: string): string {
  const move = parseUciMove(moveText);
  if (!move) return moveText;
  return `${formatXiangqiMove(position, move, "chinese")} (${moveText})`;
}

function fenSide(fen: string): "red" | "black" {
  return fen.trim().split(/\s+/)[1]?.toLowerCase() === "b" ? "black" : "red";
}

function scoreLabel(score: number | null): string {
  return score === null ? "" : `分值 ${score}`;
}

function acceptedMoveSet(moves: ChessdbMoveInfo[], fallback: string | null): Set<string> {
  if (moves.length === 0) return new Set(fallback ? [fallback] : []);
  const bestRank = Math.max(...moves.map((move) => move.rank ?? Number.NEGATIVE_INFINITY));
  const accepted = moves.filter((move) => move.rank === bestRank).map((move) => move.move);
  if (fallback) accepted.push(fallback);
  return new Set(accepted);
}

function endMessage(moves: ChessdbMoveInfo[]): string {
  const outcome = topChessdbOutcome(moves);
  if (!outcome) return "云库没有给出下一步候选着法，当前训练到此结束。";
  return `云库没有给出下一步候选着法。当前结论：${outcomeLabel(outcome.result)}，${outcomeDetail(outcome)}。`;
}

function outcomeLabel(result: ChessdbOutcome["result"]): string {
  switch (result) {
    case "win":
      return "必胜";
    case "draw":
      return "必和";
    case "loss":
      return "必败";
  }
}

function outcomeDetail(outcome: ChessdbOutcome): string {
  if (outcome.distance === null) return outcome.metric;
  if (outcome.result === "draw") return "理论和棋";
  return `${outcome.distance}步内${outcome.result === "win" ? "取胜" : "失利"}`;
}

function outcomeColor(result: ChessdbOutcome["result"]): string {
  switch (result) {
    case "win":
      return "green";
    case "draw":
      return "gray";
    case "loss":
      return "red";
  }
}

function statusLabel(status: TrainerStatus): string {
  switch (status) {
    case "idle":
      return "待开始";
    case "loading":
      return "查询中";
    case "ready":
      return "训练中";
    case "correct":
      return "正确";
    case "wrong":
      return "重试";
    case "finished":
      return "结束";
    case "error":
      return "错误";
  }
}

function statusColor(status: TrainerStatus): string {
  switch (status) {
    case "correct":
      return "green";
    case "wrong":
      return "yellow";
    case "error":
      return "red";
    case "finished":
      return "gray";
    default:
      return "blue";
  }
}
