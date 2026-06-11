import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  HoverCard,
  Paper,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronsRight,
  IconGripVertical,
  IconInfoCircle,
  IconPlayerPause,
  IconSelector,
  IconSettings,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { enginesAtom, xiangqiEngineArrowsAtom, xiangqiEvaluationAtom } from "@/state/atoms";
import type { LocalEngine } from "@/utils/engines";
import EngineSelection from "../panels/analysis/EngineSelection";
import { formatXiangqiMove } from "@/xiangqi/notation";
import {
  applyMove,
  makeFen,
  parseFen,
  parseUciMove,
  type XiangqiMove,
  type XiangqiPosition,
} from "@/xiangqi/xiangqi";
import { useXiangqiStore } from "@/xiangqi/store";
import { XiangqiBoard } from "@/xiangqi/XiangqiBoard";

type EngineLine = {
  multipv: number;
  depth: number;
  score: string;
  pv: string[];
};

type EngineAnalysis = {
  engineName: string;
  bestmove: string;
  lines: EngineLine[];
  logs: string[];
};

type EngineResult = {
  fen: string;
  loading: boolean;
  error?: string;
  analysis?: EngineAnalysis;
};

function XiangqiAnalysisPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [engines] = useAtom(enginesAtom);
  const setEngineArrows = useSetAtom(xiangqiEngineArrowsAtom);
  const setEvaluation = useSetAtom(xiangqiEvaluationAtom);
  const fen = useXiangqiStore((s) => s.currentNode().fen);
  const playMove = useXiangqiStore((s) => s.makeMove);
  const [results, setResults] = useState<Record<string, EngineResult>>({});

  const localEngines = useMemo(
    () => (engines ?? []).filter((engine): engine is LocalEngine => engine.type === "local"),
    [engines],
  );
  const loadedEngines = useMemo(
    () => localEngines.filter((engine) => engine.loaded && engine.enabled !== false),
    [localEngines],
  );

  useEffect(() => {
    let cancelled = false;
    if (loadedEngines.length === 0) {
      setResults({});
      return;
    }

    setResults((previous) => {
      const next = { ...previous };
      for (const engine of loadedEngines) {
        next[engine.id] = { fen, loading: true };
      }
      return next;
    });

    for (const engine of loadedEngines) {
      void analyze(engine, fen)
        .then((analysis) => {
          if (cancelled) return;
          setResults((previous) => ({
            ...previous,
            [engine.id]: { fen, loading: false, analysis },
          }));
        })
        .catch((error) => {
          if (cancelled) return;
          setResults((previous) => ({
            ...previous,
            [engine.id]: {
              fen,
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        });
    }

    return () => {
      cancelled = true;
    };
  }, [fen, loadedEngines]);

  useEffect(() => {
    const arrows = loadedEngines
      .map((engine, index) => {
        const firstMove = results[engine.id]?.analysis?.lines[0]?.pv[0];
        const parsed = firstMove ? parseUciMove(firstMove) : null;
        if (!parsed) return null;
        return {
          orig: parsed.from,
          dest: parsed.to,
          brush: ENGINE_ARROW_BRUSHES[index % ENGINE_ARROW_BRUSHES.length],
          modifiers: { lineWidth: 9 },
        };
      })
      .filter((shape): shape is NonNullable<typeof shape> => shape !== null);
    setEngineArrows(arrows);
    return () => setEngineArrows([]);
  }, [loadedEngines, results, setEngineArrows]);

  useEffect(() => {
    if (loadedEngines.length === 0) {
      setEvaluation(null);
      return () => setEvaluation(null);
    }

    const engineResults = loadedEngines.map((engine) => results[engine.id]);
    const score = engineResults.find(
      (result) => result?.fen === fen && result.analysis?.lines[0]?.score,
    )?.analysis?.lines[0]?.score;

    if (score) {
      setEvaluation({ fen, pending: false, score });
      return () => setEvaluation(null);
    }

    const pending = engineResults.some((result) => !result || result.fen !== fen || result.loading);
    setEvaluation(pending ? { fen, pending: true, score: null } : null);

    return () => setEvaluation(null);
  }, [fen, loadedEngines, results, setEvaluation]);

  return (
    <Stack h="100%" pl="sm">
      <ScrollArea offsetScrollbars>
        <Stack gap="sm" py="sm">
          {loadedEngines.length === 0 && (
            <Alert icon={<IconInfoCircle size="1rem" />} color="yellow">
              <Stack gap="xs">
                <Text size="sm">{t("Board.Analysis.NoLocalXiangqiEngine")}</Text>
                <EngineSelection />
              </Stack>
            </Alert>
          )}

          {loadedEngines.length > 0 && (
            <Paper withBorder p="xs">
              <Group gap="xs">
                <ActionIcon size="lg" variant="default">
                  <IconChevronsRight size="1.25rem" />
                </ActionIcon>
                <Text size="sm" fw={600} flex={1}>
                  {loadedEngines.length === 1
                    ? loadedEngines[0].name
                    : t("Board.Analysis.EngineCount", { count: loadedEngines.length })}
                </Text>
                <Popover width={250} position="bottom-end" shadow="md">
                  <Popover.Target>
                    <ActionIcon variant="default" size="lg">
                      <IconSelector />
                    </ActionIcon>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <EngineSelection />
                  </Popover.Dropdown>
                </Popover>
                <Button
                  variant="default"
                  leftSection={<IconSettings size="0.875rem" />}
                  onClick={() => navigate({ to: "/engines" })}
                >
                  {t("Board.Analysis.ManageEngines")}
                </Button>
              </Group>
            </Paper>
          )}

          <Stack gap="sm">
            {loadedEngines.map((engine, index) => {
              const result = results[engine.id];
              return (
                <EngineAnalysisCard
                  key={engine.id}
                  engine={engine}
                  result={result}
                  fen={fen}
                  color={ENGINE_ARROW_COLORS[index % ENGINE_ARROW_COLORS.length]}
                  onPlay={playMove}
                  onManage={() => navigate({ to: "/engines" })}
                />
              );
            })}
          </Stack>
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

const ENGINE_ARROW_BRUSHES = ["green", "blue", "red", "yellow"] as const;
const ENGINE_ARROW_COLORS = ["green", "blue", "red", "yellow"] as const;

function EngineAnalysisCard({
  engine,
  result,
  fen,
  color,
  onPlay,
  onManage,
}: {
  engine: LocalEngine;
  result: EngineResult | undefined;
  fen: string;
  color: string;
  onPlay: (move: XiangqiMove) => void;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  const bestLine = result?.analysis?.lines[0];
  const bestMove = result?.analysis?.bestmove;
  const parsedBest = bestMove ? parseUciMove(bestMove) : null;

  return (
    <Paper
      withBorder
      p={0}
      style={{
        overflow: "hidden",
        borderTop: `3px solid var(--mantine-color-${color}-6)`,
      }}
    >
      <Group px="sm" py="xs" gap="sm" wrap="nowrap">
        <ActionIcon color={color} variant="filled" size="lg" radius="sm">
          {result?.loading ? <IconPlayerPause size="1rem" /> : <IconChevronsRight size="1rem" />}
        </ActionIcon>
        <Text fw={800} flex={1} lineClamp={1}>
          {engine.name}
        </Text>
        <Metric
          label={t("Board.Analysis.Eval")}
          value={bestLine ? formatScore(bestLine.score) : result?.loading ? "..." : "-"}
        />
        <Metric label={t("Board.Analysis.Depth")} value={bestLine?.depth?.toString() ?? "-"} />
        <Tooltip label={t("Board.Analysis.ManageEngines")}>
          <ActionIcon variant="subtle" onClick={onManage}>
            <IconSettings size="1rem" />
          </ActionIcon>
        </Tooltip>
        <ActionIcon variant="subtle" style={{ cursor: "grab" }}>
          <IconGripVertical size="1rem" />
        </ActionIcon>
      </Group>

      <Divider />

      <Stack gap="xs" px="sm" py="xs">
        {result?.error && (
          <Alert color="red" title={t("Board.Analysis.EngineError")}>
            {result.error}
          </Alert>
        )}
        {bestLine ? (
          <Group gap="sm" align="center" wrap="nowrap">
            <Box
              px="sm"
              py={4}
              style={{
                borderRadius: 4,
                background: "var(--mantine-color-default)",
                color: "var(--mantine-color-text)",
                fontWeight: 900,
                minWidth: 64,
                textAlign: "center",
              }}
            >
              {formatScore(bestLine.score)}
            </Box>
            <PvLine fen={fen} pv={bestLine.pv} />
          </Group>
        ) : (
          <Text size="sm" c="dimmed">
            {result?.loading ? t("Board.Analysis.Thinking") : t("Board.Analysis.NoAnalysisYet")}
          </Text>
        )}
        {parsedBest && (
          <Button size="xs" variant="light" w="fit-content" onClick={() => onPlay(parsedBest)}>
            {t("Board.Analysis.PlayMove", { move: formatMoveFromFen(fen, parsedBest) })}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={0} align="end">
      <Text size="0.65rem" fw={800} c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={900}>
        {value}
      </Text>
    </Stack>
  );
}

function PvLine({ fen, pv }: { fen: string; pv: string[] }) {
  const tokens = useMemo(() => buildPvTokens(fen, pv), [fen, pv]);
  return (
    <Group gap={6} wrap="wrap" style={{ minWidth: 0 }}>
      {tokens.map((token) => (
        <HoverCard key={`${token.ply}-${token.uci}`} width={250} shadow="md" openDelay={180}>
          <HoverCard.Target>
            <Box
              component="span"
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                gap: 3,
                cursor: "default",
                whiteSpace: "nowrap",
              }}
            >
              {token.showMoveNumber && (
                <Text span size="xs" c="dimmed" fw={700}>
                  {token.moveNumber}
                  {token.side === "red" ? "." : "..."}
                </Text>
              )}
              <Text span size="sm" fw={700}>
                {token.text}
              </Text>
            </Box>
          </HoverCard.Target>
          <HoverCard.Dropdown p="xs">
            <PreviewBoard fen={token.fenAfter} />
          </HoverCard.Dropdown>
        </HoverCard>
      ))}
    </Group>
  );
}

async function analyze(engine: LocalEngine, fen: string): Promise<EngineAnalysis> {
  return invoke<EngineAnalysis>("analyze_position", {
    request: {
      engine: {
        id: engine.id,
        name: engine.name,
        path: engine.path,
        protocol: engine.protocol ?? "uci",
        threads: Number(engine.settings?.find((setting) => setting.name === "Threads")?.value) || 1,
        hash: Number(engine.settings?.find((setting) => setting.name === "Hash")?.value) || 64,
        moveTimeMs:
          engine.go?.t === "Time" && Number.isFinite(engine.go.c)
            ? Math.max(50, Math.trunc(engine.go.c))
            : null,
      },
      fen,
      moves: [],
      depth: engine.go?.t === "Depth" ? Math.max(1, Math.min(engine.go.c, 30)) : 10,
      multipv: Number(engine.settings?.find((setting) => setting.name === "MultiPV")?.value) || 1,
    },
  });
}

function formatScore(score: string): string {
  const [kind, raw] = score.split(/\s+/);
  const value = Number(raw);
  if (kind === "cp" && Number.isFinite(value)) {
    return `${value >= 0 ? "+" : ""}${(value / 100).toFixed(2)}`;
  }
  if (kind === "mate" && Number.isFinite(value)) {
    return `#${value}`;
  }
  return score || "-";
}

function formatMoveFromFen(fen: string, move: ReturnType<typeof parseUciMove>): string {
  if (!move) return "";
  try {
    return formatXiangqiMove(parseFen(fen), move, "chinese");
  } catch {
    return `${move.from}${move.to}`;
  }
}

type PvToken = {
  ply: number;
  moveNumber: number;
  side: "red" | "black";
  showMoveNumber: boolean;
  uci: string;
  text: string;
  fenAfter: string;
};

function buildPvTokens(fen: string, pv: string[]): PvToken[] {
  let position: XiangqiPosition;
  try {
    position = parseFen(fen);
  } catch {
    return [];
  }

  const tokens: PvToken[] = [];
  let previousMoveNumber = 0;
  for (const token of pv.slice(0, 12)) {
    const move = parseUciMove(token);
    if (!move) {
      continue;
    }
    try {
      const side = position.turn;
      const moveNumber = position.fullmove;
      const text = formatXiangqiMove(position, move, "chinese");
      const result = applyMove(position, move);
      tokens.push({
        ply: tokens.length + 1,
        moveNumber,
        side,
        showMoveNumber: side === "red" || moveNumber !== previousMoveNumber,
        uci: token,
        text,
        fenAfter: makeFen(result.position),
      });
      position = result.position;
      previousMoveNumber = moveNumber;
    } catch {
      continue;
    }
  }
  return tokens;
}

function PreviewBoard({ fen }: { fen: string }) {
  const position = useMemo(() => parseFen(fen), [fen]);
  return (
    <Box style={{ width: 220 }}>
      <XiangqiBoard
        position={position}
        selected={null}
        lastMove={null}
        orientation="red"
        boardTheme="classic"
        pieceStyle="classic"
        showDests={false}
        showLastMove={false}
        showCoordinates="no"
        moveMethod="select"
        drawingsEnabled={false}
        onSelect={() => {}}
        onMove={() => {}}
      />
    </Box>
  );
}

export default memo(XiangqiAnalysisPanel);
