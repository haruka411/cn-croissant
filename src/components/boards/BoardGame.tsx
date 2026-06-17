import {
  Box,
  Button,
  Divider,
  Group,
  Paper,
  Portal,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconArrowBackUp,
  IconArrowsExchange,
  IconFlag,
  IconPlus,
  IconZoomCheck,
} from "@tabler/icons-react";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { match } from "ts-pattern";
import {
  currentGameStateAtom,
  currentGameStartFromCurrentAtom,
  currentPlayersAtom,
  currentTabAtom,
  gameInputColorAtom,
  gamePlayer1SettingsAtom,
  gamePlayer2SettingsAtom,
  gameSameTimeControlAtom,
} from "@/state/atoms";
import { useXiangqiStore } from "@/xiangqi/store";
import {
  resultReasonTranslationKey,
  type XiangqiResult,
  type XiangqiResultReason,
} from "@/xiangqi/persistence";
import XiangqiBoardControls from "../xiangqi/XiangqiBoardControls";
import XiangqiGameNotation from "../xiangqi/XiangqiGameNotation";
import XiangqiMoveControls from "../xiangqi/XiangqiMoveControls";
import Board from "./Board";
import { OpponentForm, type OpponentSettings } from "./OpponentForm";

function BoardGame() {
  const { t } = useTranslation();
  const [inputColor, setInputColor] = useAtom(gameInputColorAtom);
  const [player1Settings, setPlayer1Settings] = useAtom(gamePlayer1SettingsAtom);
  const [player2Settings, setPlayer2Settings] = useAtom(gamePlayer2SettingsAtom);
  const [sameTimeControl, setSameTimeControl] = useAtom(gameSameTimeControlAtom);
  const [gameState, setGameState] = useAtom(currentGameStateAtom);
  const [gameStartFromCurrent, setGameStartFromCurrent] = useAtom(currentGameStartFromCurrentAtom);
  const [players, setPlayers] = useAtom(currentPlayersAtom);
  const [, setCurrentTab] = useAtom(currentTabAtom);
  const boardRef = useRef(null);
  const resetGame = useXiangqiStore((s) => s.reset);
  const headers = useXiangqiStore((s) => s.headers);
  const setHeaders = useXiangqiStore((s) => s.setHeaders);
  const currentNode = useXiangqiStore((s) => s.currentNode());
  const currentPath = useXiangqiStore((s) => s.path);
  const deleteMove = useXiangqiStore((s) => s.deleteMove);
  const deleteMovesFrom = useXiangqiStore((s) => s.deleteMovesFrom);
  const dirty = useXiangqiStore((s) => s.dirty);
  const [error, setError] = useState<string | null>(null);
  const [clocks, setClocks] = useState<{ red: number | null; black: number | null }>({
    red: null,
    black: null,
  });
  const lastClockTick = useRef<number | null>(null);
  const timeoutHandled = useRef(false);

  const currentSide = useMemo<"red" | "black">(
    () => (currentNode.fen.split(/\s+/)[1] === "b" ? "black" : "red"),
    [currentNode.fen],
  );
  const redLabel = t("Board.Xiangqi.Red");
  const blackLabel = t("Board.Xiangqi.Black");
  const randomLabel = t("Board.Game.Random");
  const sideToMove = currentSide === "red" ? redLabel : blackLabel;
  const resultReason = headers.resultReason
    ? t(resultReasonTranslationKey(headers.resultReason))
    : null;

  const finishGame = useCallback(
    (result: XiangqiResult, reason: XiangqiResultReason) => {
      setHeaders({
        ...headers,
        result,
        resultReason: reason,
      });
      setGameState("gameOver");
      lastClockTick.current = null;
    },
    [headers, setGameState, setHeaders],
  );

  useEffect(() => {
    if (gameState === "playing" && headers.result !== "*") {
      setGameState("gameOver");
    }
  }, [gameState, headers.result, setGameState]);

  useEffect(() => {
    if (gameState !== "playing") {
      lastClockTick.current = null;
      return;
    }

    const activeTimeControl =
      currentSide === "red" ? players.white?.timeControl : players.black?.timeControl;
    lastClockTick.current = Date.now();
    if (!activeTimeControl) return;

    const timer = window.setInterval(() => {
      const now = Date.now();
      const elapsed = now - (lastClockTick.current ?? now);
      lastClockTick.current = now;

      setClocks((prev) => {
        const remaining = prev[currentSide];
        if (remaining === null) return prev;

        const nextRemaining = Math.max(0, remaining - elapsed);
        if (nextRemaining === 0 && remaining > 0 && !timeoutHandled.current) {
          timeoutHandled.current = true;
          window.setTimeout(() => {
            finishGame(currentSide === "red" ? "0-1" : "1-0", "timeout");
          }, 0);
        }
        return {
          ...prev,
          [currentSide]: nextRemaining,
        };
      });
    }, 250);

    return () => window.clearInterval(timer);
  }, [currentSide, finishGame, gameState, players.black?.timeControl, players.white?.timeControl]);

  function cycleColor() {
    setInputColor((prev) =>
      match(prev)
        .with("white", () => "black" as const)
        .with("black", () => "random" as const)
        .with("random", () => "white" as const)
        .exhaustive(),
    );
  }

  function getPlayers() {
    let isPlayer1Red = inputColor === "white";
    if (inputColor === "random") {
      isPlayer1Red = Math.random() > 0.5;
    }
    return {
      white: isPlayer1Red ? player1Settings : player2Settings,
      black: isPlayer1Red ? player2Settings : player1Settings,
      orientation: isPlayer1Red ? ("red" as const) : ("black" as const),
    };
  }

  const handleMove = useCallback(
    (_uci: string, side: "red" | "black") => {
      const timeControl = side === "red" ? players.white?.timeControl : players.black?.timeControl;
      if (timeControl?.increment) {
        setClocks((prev) =>
          prev[side] === null
            ? prev
            : {
                ...prev,
                [side]: (prev[side] ?? 0) + (timeControl.increment ?? 0),
              },
        );
      }
      lastClockTick.current = Date.now();
    },
    [players.black?.timeControl, players.white?.timeControl],
  );

  function startGame() {
    const nextPlayers = getPlayers();
    const missingEngine = [nextPlayers.white, nextPlayers.black].some(
      (player) => player.type === "engine" && !player.engine,
    );
    if (missingEngine) {
      setError(t("Board.Game.SelectEngineBeforeStart"));
      return;
    }

    if (!gameStartFromCurrent) {
      resetGame();
    }
    setPlayers({
      white: nextPlayers.white,
      black: nextPlayers.black,
    });
    setClocks({
      red: nextPlayers.white.timeControl?.seconds ?? null,
      black: nextPlayers.black.timeControl?.seconds ?? null,
    });
    timeoutHandled.current = false;
    lastClockTick.current = Date.now();
    setHeaders({
      ...headers,
      red: displayName(nextPlayers.white, redLabel),
      black: displayName(nextPlayers.black, blackLabel),
      result: "*",
      resultReason: null,
      orientation: nextPlayers.orientation,
    });
    setGameState("playing");
    setGameStartFromCurrent(false);
    setError(null);
  }

  function newGame() {
    resetGame();
    setGameState("settingUp");
    setGameStartFromCurrent(false);
    setClocks({ red: null, black: null });
    timeoutHandled.current = false;
    lastClockTick.current = null;
    setError(null);
  }

  function resign() {
    finishGame(currentSide === "red" ? "0-1" : "1-0", "resignation");
  }

  function undoMove() {
    const undoPath = findUndoPath(currentPath, players);
    if (undoPath.length === 0) return;
    if (hasEngine) {
      deleteMovesFrom(undoPath);
    } else {
      deleteMove(undoPath);
    }
    setHeaders({
      ...headers,
      result: "*",
      resultReason: null,
    });
    setGameState("playing");
    timeoutHandled.current = false;
    lastClockTick.current = Date.now();
  }

  function changeToAnalysisMode() {
    setCurrentTab((tab) => ({ ...tab, type: "analysis" }));
    setGameState("settingUp");
  }

  const hasEngine = players.white?.type === "engine" || players.black?.type === "engine";
  const canUndo = findUndoPath(currentPath, players).length > 0;

  return (
    <>
      <Portal target="#left" style={{ height: "100%" }}>
        <Board
          editingMode={false}
          viewOnly={gameState !== "playing"}
          disableVariations
          boardRef={boardRef}
          whiteTime={clocks.red ?? undefined}
          blackTime={clocks.black ?? undefined}
          onMove={handleMove}
          enablePremoves={hasEngine && gameState === "playing"}
        />
      </Portal>
      <Portal target="#topRight" style={{ height: "100%", overflow: "hidden" }}>
        <Paper withBorder shadow="sm" p="md" h="100%">
          {gameState === "settingUp" && (
            <Stack h="100%" gap={0}>
              <ScrollArea style={{ flex: 1 }} offsetScrollbars>
                <Stack>
                  <Group>
                    <Text flex={1} ta="center" fz="lg" fw="bold">
                      {match(inputColor)
                        .with("white", () => redLabel)
                        .with("random", () => randomLabel)
                        .with("black", () => blackLabel)
                        .exhaustive()}
                    </Text>
                    <ActionButton onClick={cycleColor} />
                    <Text flex={1} ta="center" fz="lg" fw="bold">
                      {match(inputColor)
                        .with("white", () => blackLabel)
                        .with("random", () => randomLabel)
                        .with("black", () => redLabel)
                        .exhaustive()}
                    </Text>
                  </Group>
                  <Box flex={1}>
                    <Group style={{ alignItems: "start" }}>
                      <OpponentForm
                        sameTimeControl={sameTimeControl}
                        opponent={player1Settings}
                        setOpponent={setPlayer1Settings}
                        setOtherOpponent={setPlayer2Settings}
                      />
                      <Divider orientation="vertical" />
                      <OpponentForm
                        sameTimeControl={sameTimeControl}
                        opponent={player2Settings}
                        setOpponent={setPlayer2Settings}
                        setOtherOpponent={setPlayer1Settings}
                      />
                    </Group>
                  </Box>
                  <Paper withBorder p="sm">
                    <SegmentedControl
                      fullWidth
                      value={sameTimeControl ? "same" : "separate"}
                      onChange={(value) => setSameTimeControl(value === "same")}
                      data={[
                        { value: "same", label: t("Board.Opponent.SameTimeControl") },
                        { value: "separate", label: t("Board.Game.SeparateClocks") },
                      ]}
                    />
                  </Paper>
                  {error && (
                    <Text c="red" size="sm">
                      {error}
                    </Text>
                  )}
                </Stack>
              </ScrollArea>
              <Divider pb="sm" />
              <Button onClick={startGame} fullWidth variant="light">
                {t("Board.Opponent.StartGame")}
              </Button>
            </Stack>
          )}

          {(gameState === "playing" || gameState === "gameOver") && (
            <Stack h="100%">
              <Stack flex={1} gap="xs">
                <Text fw={700} fz="lg">
                  {t("Board.Game.Versus", {
                    red: headers.red || redLabel,
                    black: headers.black || blackLabel,
                  })}
                </Text>
                <Text size="sm" c="dimmed">
                  {t("Board.Game.SideToMove", { side: sideToMove })}
                </Text>
                <Group grow>
                  <Paper withBorder p="xs">
                    <Text size="xs" c="dimmed">
                      {t("Board.Game.RedClock")}
                    </Text>
                    <Text fw={800}>{formatClock(clocks.red) || t("Board.Opponent.Unlimited")}</Text>
                  </Paper>
                  <Paper withBorder p="xs">
                    <Text size="xs" c="dimmed">
                      {t("Board.Game.BlackClock")}
                    </Text>
                    <Text fw={800}>
                      {formatClock(clocks.black) || t("Board.Opponent.Unlimited")}
                    </Text>
                  </Paper>
                </Group>
                <Text size="sm" c={headers.result === "*" ? "dimmed" : undefined}>
                  {t("Board.Game.Result", { result: headers.result })}
                </Text>
                {resultReason && (
                  <Text size="sm" c="dimmed">
                    {t("Board.Game.ResultReason", { reason: resultReason })}
                  </Text>
                )}
                {hasEngine && (
                  <Text size="sm" c="dimmed">
                    {t("Board.Game.EngineMovesHint")}
                  </Text>
                )}
              </Stack>
              <Group grow>
                {gameState === "gameOver" && (
                  <Button variant="default" onClick={newGame} leftSection={<IconPlus />}>
                    {t("Board.Game.NewGame")}
                  </Button>
                )}
                {gameState === "playing" && (
                  <Button variant="default" onClick={newGame} leftSection={<IconPlus />}>
                    {t("Board.Game.Abort")}
                  </Button>
                )}
                {gameState === "playing" && (
                  <Button
                    variant="default"
                    onClick={undoMove}
                    disabled={!canUndo}
                    leftSection={<IconArrowBackUp />}
                  >
                    {t("Board.Game.Undo")}
                  </Button>
                )}
                {gameState === "playing" && (
                  <Button color="red" variant="light" onClick={resign} leftSection={<IconFlag />}>
                    {t("Board.Game.Resign")}
                  </Button>
                )}
                <Button
                  variant="default"
                  onClick={changeToAnalysisMode}
                  leftSection={<IconZoomCheck />}
                >
                  {t("Board.Analysis.Analyze")}
                </Button>
              </Group>
            </Stack>
          )}
        </Paper>
      </Portal>
      <Portal target="#bottomRight" style={{ height: "100%" }}>
        <Stack h="100%" gap="xs">
          <XiangqiGameNotation
            topBar
            controls={
              <XiangqiBoardControls
                editingMode={false}
                toggleEditingMode={() => {}}
                dirty={dirty}
                disableVariations
                allowEditing={false}
              />
            }
          />
          <XiangqiMoveControls readOnly={gameState === "playing"} />
        </Stack>
      </Portal>
    </>
  );
}

function ActionButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="subtle" px="xs" onClick={onClick}>
      <IconArrowsExchange size="1.2rem" />
    </Button>
  );
}

function displayName(player: OpponentSettings, fallback: string) {
  if (player.type === "engine") {
    return player.engine?.name || fallback;
  }
  return player.name || fallback;
}

function findUndoPath(
  currentPath: number[],
  players: { white?: OpponentSettings; black?: OpponentSettings },
) {
  const hasEngine = players.white?.type === "engine" || players.black?.type === "engine";
  if (!hasEngine) return currentPath;

  for (let length = currentPath.length; length > 0; length -= 1) {
    const sideThatMoved = length % 2 === 1 ? "white" : "black";
    const player = sideThatMoved === "white" ? players.white : players.black;
    if (player?.type === "human") {
      return currentPath.slice(0, length);
    }
  }
  return [];
}

function formatClock(milliseconds: number | null): string {
  if (milliseconds === null) return "";
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default BoardGame;
