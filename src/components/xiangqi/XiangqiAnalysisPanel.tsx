import { AreaChart } from "@mantine/charts";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  CopyButton,
  Divider,
  Group,
  HoverCard,
  InputWrapper,
  NumberInput,
  Paper,
  Popover,
  Progress,
  ScrollArea,
  Select,
  Skeleton,
  Stack,
  Tabs,
  Table,
  Text,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import {
  IconCheck,
  IconChevronDown,
  IconChevronsRight,
  IconCopy,
  IconInfoCircle,
  IconPinned,
  IconPinnedOff,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStopFilled,
  IconSelector,
  IconSettings,
  IconTargetArrow,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CategoricalChartFunc } from "recharts/types/chart/types";
import type { EngineLog, GoMode } from "@/bindings";
import EngineLogsView from "@/components/common/EngineLogsView";
import TimeInput from "@/components/common/TimeInput";
import {
  currentAnalysisTabAtom,
  enginesAtom,
  showArrowsAtom,
  showConsecutiveArrowsAtom,
  xiangqiEngineArrowsAtom,
  xiangqiEvaluationAtom,
} from "@/state/atoms";
import type { EngineSettings, LocalEngine } from "@/utils/engines";
import EngineSelection from "../panels/analysis/EngineSelection";
import CoresSlider from "../panels/analysis/CoresSlider";
import HashSlider from "../panels/analysis/HashSlider";
import LinesSlider from "../panels/analysis/LinesSlider";
import { formatXiangqiMove } from "@/xiangqi/notation";
import {
  formatXiangqiScore,
  isPositiveXiangqiScore,
  parseXiangqiEvaluation,
  scoreToXiangqiWinChance,
} from "@/xiangqi/evaluation";
import {
  applyMove,
  makeFen,
  opposite,
  parseFen,
  parseUciMove,
  traverseMainline,
  type GameNode,
  type Square,
  type XiangqiDrawShape,
  type XiangqiMove,
  type XiangqiPosition,
} from "@/xiangqi/xiangqi";
import { useXiangqiStore } from "@/xiangqi/store";
import { XiangqiBoard } from "@/xiangqi/XiangqiBoard";

type EngineLine = {
  multipv: number;
  depth: number;
  nodes?: number;
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
  requestId?: string;
  loading: boolean;
  progress?: number;
  error?: string;
  analysis?: EngineAnalysis;
};

type XiangqiAnalysisUpdate = {
  requestId: string;
  engineId: string;
  fen: string;
  progress: number;
  finished: boolean;
  analysis: EngineAnalysis;
};

type XiangqiAnalysisTab = "engines" | "report" | "logs";

type XiangqiAnalysisContextValue = {
  loadedEngines: LocalEngine[];
  effectiveLoadedEngines: LocalEngine[];
  orderedEngines: LocalEngine[];
  activeResults: Record<string, EngineResult>;
  analysisFen: string;
  reportScores: Record<string, string>;
  threatMode: boolean;
  setThreatMode: React.Dispatch<React.SetStateAction<boolean>>;
  pinnedEngineIds: string[];
  playMove: (move: XiangqiMove) => void;
  getSettings: (engine: LocalEngine) => XiangqiEngineSettings;
  updateSettings: (
    engineId: string,
    updater: (previous: XiangqiEngineSettings) => XiangqiEngineSettings,
  ) => void;
  togglePinned: (engineId: string) => void;
};

const XiangqiAnalysisContext = createContext<XiangqiAnalysisContextValue | null>(null);

export function XiangqiAnalysisProvider({ children }: { children: React.ReactNode }) {
  const [engines, setEngines] = useAtom(enginesAtom);
  const showArrows = useAtomValue(showArrowsAtom);
  const showConsecutiveArrows = useAtomValue(showConsecutiveArrowsAtom);
  const setEngineArrows = useSetAtom(xiangqiEngineArrowsAtom);
  const setEvaluation = useSetAtom(xiangqiEvaluationAtom);
  const fen = useXiangqiStore((s) => s.currentNode().fen);
  const playMove = useXiangqiStore((s) => s.makeMove);
  const [results, setResults] = useState<Record<string, EngineResult>>({});
  const [reportScores, setReportScores] = useState<Record<string, string>>({});
  const [engineSettingsOverrides, setEngineSettingsOverrides] = useState<
    Record<string, XiangqiEngineSettings>
  >({});
  const [threatMode, setThreatMode] = useState(false);
  const [pinnedEngineIds, setPinnedEngineIds] = useState<string[]>([]);

  const localEngines = useMemo(
    () => (engines ?? []).filter((engine): engine is LocalEngine => engine.type === "local"),
    [engines],
  );
  const loadedEngines = useMemo(
    () => localEngines.filter((engine) => engine.loaded && engine.enabled !== false),
    [localEngines],
  );
  const effectiveLoadedEngines = useMemo(
    () =>
      loadedEngines.map((engine) =>
        applyXiangqiSettings(engine, engineSettingsOverrides[engine.id]),
      ),
    [engineSettingsOverrides, loadedEngines],
  );
  const activeEngines = useMemo(
    () => effectiveLoadedEngines.filter((engine) => engine.enabled !== false),
    [effectiveLoadedEngines],
  );
  const analysisFen = useMemo(() => (threatMode ? swapXiangqiTurn(fen) : fen), [fen, threatMode]);
  const orderedEngines = useMemo(
    () =>
      [...loadedEngines].sort((a, b) => {
        const aPinned = pinnedEngineIds.includes(a.id);
        const bPinned = pinnedEngineIds.includes(b.id);
        return Number(bPinned) - Number(aPinned);
      }),
    [loadedEngines, pinnedEngineIds],
  );

  const updateEngineSettings = useCallback(
    (engineId: string, updater: (previous: XiangqiEngineSettings) => XiangqiEngineSettings) => {
      const engine = loadedEngines.find((candidate) => candidate.id === engineId);
      if (!engine) return;

      const currentSettings = getXiangqiSettings(engine, engineSettingsOverrides[engineId]);
      const nextSettings = normalizeXiangqiSettings(updater(currentSettings));

      setEngineSettingsOverrides((previous) => ({
        ...previous,
        [engineId]: nextSettings,
      }));

      if (!nextSettings.synced) return;

      setEngines(async (previous) =>
        (await previous).map((candidate) =>
          candidate.id === engineId && candidate.type === "local"
            ? { ...candidate, go: nextSettings.go, settings: nextSettings.settings }
            : candidate,
        ),
      );
    },
    [engineSettingsOverrides, loadedEngines, setEngines],
  );

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    if (activeEngines.length === 0) {
      setResults({});
      return;
    }

    const requestIds: Record<string, string> = Object.fromEntries(
      activeEngines.map((engine) => [engine.id, createAnalysisRequestId(engine.id)]),
    );

    void (async () => {
      const removeListener = await listen<XiangqiAnalysisUpdate>(
        "xiangqi_analysis_update",
        ({ payload }) => {
          if (cancelled) return;
          if (payload.fen !== analysisFen) return;
          if (requestIds[payload.engineId] !== payload.requestId) return;

          setResults((previous) => ({
            ...previous,
            [payload.engineId]: {
              fen: analysisFen,
              requestId: payload.requestId,
              loading: !payload.finished,
              progress: payload.progress,
              analysis: payload.analysis,
            },
          }));
        },
      );

      if (cancelled) {
        removeListener();
        return;
      }

      unlisten = removeListener;

      setResults((previous) => {
        const next = { ...previous };
        for (const engine of activeEngines) {
          next[engine.id] = {
            fen: analysisFen,
            requestId: requestIds[engine.id],
            loading: true,
            progress: 0,
            analysis: previous[engine.id]?.analysis,
          };
        }
        return next;
      });

      for (const engine of activeEngines) {
        void startAnalysis(engine, analysisFen, requestIds[engine.id]).catch((error) => {
          if (cancelled) return;
          setResults((previous) => ({
            ...previous,
            [engine.id]: {
              fen: analysisFen,
              requestId: requestIds[engine.id],
              loading: false,
              progress: 0,
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        });
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      for (const requestId of Object.values(requestIds)) {
        void stopXiangqiAnalysis(requestId);
      }
    };
  }, [activeEngines, analysisFen]);

  useEffect(() => {
    if (threatMode) return;
    const score = activeEngines
      .map((engine) => results[engine.id])
      .find((result) => result?.fen === analysisFen && result.analysis?.lines[0]?.score)?.analysis
      ?.lines[0]?.score;
    if (!score) return;

    setReportScores((previous) =>
      previous[analysisFen] === score ? previous : { ...previous, [analysisFen]: score },
    );
  }, [activeEngines, analysisFen, results, threatMode]);

  useEffect(() => {
    if (!showArrows) {
      setEngineArrows([]);
      return;
    }

    const arrows: XiangqiDrawShape[] = [];
    for (const [index, engine] of activeEngines.entries()) {
      const engineArrows = buildXiangqiEngineArrows(
        results[engine.id]?.analysis?.lines ?? [],
        ENGINE_ARROW_BRUSHES[index % ENGINE_ARROW_BRUSHES.length],
        showConsecutiveArrows,
      );

      for (const arrow of engineArrows) {
        if (!hasSameXiangqiArrow(arrows, arrow)) arrows.push(arrow);
      }
    }

    setEngineArrows(arrows);
    return () => setEngineArrows([]);
  }, [activeEngines, results, setEngineArrows, showArrows, showConsecutiveArrows]);

  useEffect(() => {
    if (activeEngines.length === 0) {
      setEvaluation(null);
      return () => setEvaluation(null);
    }

    const engineResults = activeEngines.map((engine) => results[engine.id]);
    const score = engineResults.find(
      (result) => result?.fen === analysisFen && result.analysis?.lines[0]?.score,
    )?.analysis?.lines[0]?.score;

    if (score) {
      setEvaluation({ fen: analysisFen, pending: false, score });
      return () => setEvaluation(null);
    }

    const pending = engineResults.some(
      (result) => !result || result.fen !== analysisFen || result.loading,
    );
    setEvaluation(pending ? { fen: analysisFen, pending: true, score: null } : null);

    return () => setEvaluation(null);
  }, [activeEngines, analysisFen, results, setEvaluation]);

  const context = useMemo<XiangqiAnalysisContextValue>(
    () => ({
      loadedEngines,
      effectiveLoadedEngines,
      orderedEngines,
      activeResults: results,
      analysisFen,
      reportScores,
      threatMode,
      setThreatMode,
      pinnedEngineIds,
      playMove,
      getSettings: (engine) => getXiangqiSettings(engine, engineSettingsOverrides[engine.id]),
      updateSettings: updateEngineSettings,
      togglePinned: (engineId) =>
        setPinnedEngineIds((previous) =>
          previous.includes(engineId)
            ? previous.filter((id) => id !== engineId)
            : [...previous, engineId],
        ),
    }),
    [
      analysisFen,
      effectiveLoadedEngines,
      engineSettingsOverrides,
      loadedEngines,
      orderedEngines,
      pinnedEngineIds,
      playMove,
      reportScores,
      results,
      threatMode,
      updateEngineSettings,
    ],
  );

  return (
    <XiangqiAnalysisContext.Provider value={context}>{children}</XiangqiAnalysisContext.Provider>
  );
}

function useXiangqiAnalysisContext() {
  const context = useContext(XiangqiAnalysisContext);
  if (!context) {
    throw new Error("XiangqiAnalysisPanel must be used inside XiangqiAnalysisProvider");
  }
  return context;
}

function XiangqiAnalysisPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useAtom(currentAnalysisTabAtom);
  const {
    loadedEngines,
    effectiveLoadedEngines,
    orderedEngines,
    activeResults,
    analysisFen,
    threatMode,
    setThreatMode,
    pinnedEngineIds,
    playMove,
    getSettings,
    updateSettings,
    togglePinned,
  } = useXiangqiAnalysisContext();

  const analysisTab: XiangqiAnalysisTab =
    tab === "report" || tab === "logs" || tab === "engines" ? tab : "engines";

  return (
    <Stack h="100%" pl="sm">
      <Tabs
        h="100%"
        orientation="vertical"
        placement="right"
        value={analysisTab}
        onChange={(value) => setTab((value as XiangqiAnalysisTab | null) ?? "engines")}
        keepMounted={false}
        style={{ display: "flex" }}
      >
        <Tabs.List>
          <Tabs.Tab value="engines">{t("Board.Analysis.Engines")}</Tabs.Tab>
          <Tabs.Tab value="report">{t("Board.Analysis.Report")}</Tabs.Tab>
          <Tabs.Tab value="logs" disabled={loadedEngines.length === 0}>
            {t("Board.Analysis.Logs")}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel
          value="engines"
          pt="sm"
          style={{
            overflow: "hidden",
            display: analysisTab === "engines" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <XiangqiEnginesPanel
            loadedEngines={loadedEngines}
            effectiveLoadedEngines={effectiveLoadedEngines}
            orderedEngines={orderedEngines}
            activeResults={activeResults}
            analysisFen={analysisFen}
            threatMode={threatMode}
            pinnedEngineIds={pinnedEngineIds}
            setThreatMode={setThreatMode}
            playMove={playMove}
            onManage={() => navigate({ to: "/engines" })}
            getSettings={getSettings}
            updateSettings={updateSettings}
            togglePinned={togglePinned}
          />
        </Tabs.Panel>

        <Tabs.Panel
          value="report"
          pt="sm"
          style={{
            overflow: "hidden",
            display: analysisTab === "report" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <XiangqiReportPanel />
        </Tabs.Panel>

        <Tabs.Panel
          value="logs"
          pt="sm"
          style={{
            overflow: "hidden",
            display: analysisTab === "logs" ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <XiangqiLogsPanel engines={loadedEngines} results={activeResults} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function XiangqiEnginesPanel({
  loadedEngines,
  effectiveLoadedEngines,
  orderedEngines,
  activeResults,
  analysisFen,
  threatMode,
  pinnedEngineIds,
  setThreatMode,
  playMove,
  onManage,
  getSettings,
  updateSettings,
  togglePinned,
}: {
  loadedEngines: LocalEngine[];
  effectiveLoadedEngines: LocalEngine[];
  orderedEngines: LocalEngine[];
  activeResults: Record<string, EngineResult>;
  analysisFen: string;
  threatMode: boolean;
  pinnedEngineIds: string[];
  setThreatMode: React.Dispatch<React.SetStateAction<boolean>>;
  playMove: (move: XiangqiMove) => void;
  onManage: () => void;
  getSettings: (engine: LocalEngine) => XiangqiEngineSettings;
  updateSettings: (
    engineId: string,
    updater: (previous: XiangqiEngineSettings) => XiangqiEngineSettings,
  ) => void;
  togglePinned: (engineId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <ScrollArea offsetScrollbars flex={1}>
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
              <Tooltip label={t("Board.Analysis.Threat", "Threat analysis")}>
                <ActionIcon
                  variant={threatMode ? "filled" : "default"}
                  color={threatMode ? "red" : undefined}
                  size="lg"
                  onClick={() => setThreatMode((enabled) => !enabled)}
                >
                  <IconTargetArrow size="1rem" />
                </ActionIcon>
              </Tooltip>
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
                onClick={onManage}
              >
                {t("Board.Analysis.ManageEngines")}
              </Button>
            </Group>
          </Paper>
        )}

        <Stack gap="sm">
          {orderedEngines.map((engine, index) => {
            const effectiveEngine =
              effectiveLoadedEngines.find((candidate) => candidate.id === engine.id) ?? engine;
            const result = activeResults[engine.id];
            return (
              <EngineAnalysisCard
                key={engine.id}
                engine={effectiveEngine}
                result={result}
                fen={analysisFen}
                threatMode={threatMode}
                pinned={pinnedEngineIds.includes(engine.id)}
                color={ENGINE_ARROW_COLORS[index % ENGINE_ARROW_COLORS.length]}
                onPlay={playMove}
                onManage={onManage}
                settings={getSettings(engine)}
                setSettings={(updater) => updateSettings(engine.id, updater)}
                onTogglePinned={() => togglePinned(engine.id)}
              />
            );
          })}
        </Stack>
      </Stack>
    </ScrollArea>
  );
}

const ENGINE_ARROW_BRUSHES = [
  { strong: "green", pale: "paleGreen" },
  { strong: "blue", pale: "paleBlue" },
  { strong: "red", pale: "paleRed" },
  { strong: "yellow", pale: "yellow" },
] as const satisfies readonly EngineArrowBrush[];
const ENGINE_ARROW_COLORS = ["green", "blue", "red", "yellow"] as const;
const LARGE_ARROW = 11;
const MEDIUM_ARROW = 7.5;
const SMALL_ARROW = 4;
const MAX_CONSECUTIVE_ARROW_PLY = 5;
const WIN_CHANCE_ARROW_THRESHOLD = 10;
type EngineArrowBrush = {
  strong: NonNullable<XiangqiDrawShape["brush"]>;
  pale: NonNullable<XiangqiDrawShape["brush"]>;
};

function buildXiangqiEngineArrows(
  lines: EngineLine[],
  brushes: EngineArrowBrush,
  showConsecutiveArrows: boolean,
): XiangqiDrawShape[] {
  const candidates = lines.filter((line) => line.pv.length > 0);
  const bestWinChance = scoreToXiangqiWinChance(candidates[0]?.score);
  if (bestWinChance === null) return [];

  const shapes: XiangqiDrawShape[] = [];
  for (const [candidateIndex, line] of candidates.entries()) {
    const winChance = scoreToXiangqiWinChance(line.score);
    if (winChance === null || bestWinChance - winChance >= WIN_CHANCE_ARROW_THRESHOLD) continue;

    const lineWidth = arrowWidthForWinChanceDiff(bestWinChance - winChance);
    let previousSquare: Square | null = null;

    for (const [ply, uci] of line.pv.entries()) {
      const move = parseUciMove(uci);
      if (!move) break;
      if (previousSquare === null) previousSquare = move.from;

      const shouldDraw =
        ply === 0 || (showConsecutiveArrows && candidateIndex === 0 && ply % 2 === 0);
      if (!shouldDraw) continue;

      if (
        ply >= MAX_CONSECUTIVE_ARROW_PLY ||
        previousSquare !== move.from ||
        hasSameXiangqiArrow(shapes, { orig: move.from, dest: move.to })
      ) {
        break;
      }

      shapes.push({
        orig: move.from,
        dest: move.to,
        brush: candidateIndex === 0 ? brushes.strong : brushes.pale,
        modifiers: { lineWidth },
      });
      previousSquare = move.to;
    }
  }

  return shapes;
}

function hasSameXiangqiArrow(
  shapes: XiangqiDrawShape[],
  shape: Pick<XiangqiDrawShape, "orig" | "dest">,
): boolean {
  return shapes.some((candidate) => candidate.orig === shape.orig && candidate.dest === shape.dest);
}

function arrowWidthForWinChanceDiff(diff: number): number {
  if (diff < 2.5) return LARGE_ARROW;
  if (diff < 5) return MEDIUM_ARROW;
  return SMALL_ARROW;
}

function EngineAnalysisCard({
  engine,
  result,
  fen,
  threatMode,
  pinned,
  color,
  onPlay,
  onManage,
  settings,
  setSettings,
  onTogglePinned,
}: {
  engine: LocalEngine;
  result: EngineResult | undefined;
  fen: string;
  threatMode: boolean;
  pinned: boolean;
  color: string;
  onPlay: (move: XiangqiMove) => void;
  onManage: () => void;
  settings: XiangqiEngineSettings;
  setSettings: (updater: (previous: XiangqiEngineSettings) => XiangqiEngineSettings) => void;
  onTogglePinned: () => void;
}) {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lines = result?.analysis?.lines ?? [];
  const bestLine = lines[0];
  const expectedLines = Math.max(1, getNumericSetting(settings.settings, "MultiPV", 1));
  const progress = Math.max(0, Math.min(result?.progress ?? 0, 100));

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
        <ActionIcon
          color={color}
          variant={settings.enabled ? "filled" : "default"}
          size="lg"
          radius="sm"
          onClick={() => {
            if (result?.loading) void stopXiangqiAnalysis(result.requestId);
            setSettings((previous) => ({ ...previous, enabled: !previous.enabled }));
          }}
        >
          {settings.enabled ? <IconPlayerPause size="1rem" /> : <IconPlayerPlay size="1rem" />}
        </ActionIcon>
        <Text fw={800} flex={1} lineClamp={1}>
          {engine.name}
        </Text>
        {threatMode && (
          <Badge color="red" variant="light">
            {t("Board.Analysis.Threat", "Threat")}
          </Badge>
        )}
        <Metric
          label={t("Board.Analysis.Eval")}
          value={
            settings.enabled
              ? bestLine
                ? formatXiangqiScore(bestLine.score)
                : result?.loading
                  ? "..."
                  : "-"
              : "-"
          }
        />
        <Metric label={t("Board.Analysis.Depth")} value={bestLine?.depth?.toString() ?? "-"} />
        <Tooltip
          label={pinned ? t("Board.Analysis.Unpin", "Unpin") : t("Board.Analysis.Pin", "Pin")}
        >
          <ActionIcon variant={pinned ? "light" : "subtle"} onClick={onTogglePinned}>
            {pinned ? <IconPinnedOff size="1rem" /> : <IconPinned size="1rem" />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t("Board.Opponent.EngineSettings", "Engine Settings")}>
          <ActionIcon
            variant={settingsOpen ? "light" : "subtle"}
            color={settingsOpen ? color : undefined}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <IconSettings size="1rem" />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Collapse in={settingsOpen}>
        <Box px="sm" pb="sm">
          <XiangqiEngineSettingsPanel
            color={color}
            settings={settings}
            setSettings={setSettings}
            onManage={onManage}
            onStop={() => {
              if (result?.loading) void stopXiangqiAnalysis(result.requestId);
              setSettings((previous) => ({ ...previous, enabled: false }));
            }}
          />
        </Box>
      </Collapse>

      <Progress
        value={settings.enabled ? progress : 0}
        animated={settings.enabled && !!result?.loading && progress < 100}
        striped={settings.enabled && !!result?.loading && progress < 100}
        color={color}
        size="xs"
      />
      <Divider />

      <Stack gap="xs" px="sm" py="xs">
        {result?.error && (
          <Alert color="red" title={t("Board.Analysis.EngineError")}>
            {result.error}
          </Alert>
        )}
        <Table withRowBorders={false}>
          <Table.Tbody>
            {lines.length > 0 &&
              lines.map((line) => (
                <XiangqiAnalysisRow
                  key={`${line.multipv}-${line.pv.join(" ")}`}
                  engine={engine.name}
                  line={line}
                  fen={fen}
                  threatMode={threatMode}
                  onPlay={onPlay}
                />
              ))}
            {lines.length === 0 &&
              settings.enabled &&
              result?.loading &&
              Array.from({ length: expectedLines }).map((_, index) => (
                <Table.Tr key={index}>
                  <Table.Td colSpan={3}>
                    <Skeleton height={35} radius="xl" p={5} />
                  </Table.Td>
                </Table.Tr>
              ))}
            {lines.length === 0 && (!settings.enabled || !result?.loading) && (
              <Table.Tr>
                <Table.Td colSpan={3}>
                  <Text ta="center" my="lg" size="sm" c="dimmed">
                    {!settings.enabled
                      ? t("Board.Analysis.InactiveEngine")
                      : t("Board.Analysis.NoAnalysisYet")}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Stack>
    </Paper>
  );
}

function XiangqiAnalysisRow({
  engine,
  line,
  fen,
  threatMode,
  onPlay,
}: {
  engine: string;
  line: EngineLine;
  fen: string;
  threatMode: boolean;
  onPlay: (move: XiangqiMove) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const outputMoves = useMemo(
    () => buildPvTokens(fen, line.pv, null).map((token) => token.text),
    [fen, line.pv],
  );
  const engineOutput = [engine, formatXiangqiScore(line.score), outputMoves.join(" ")]
    .filter(Boolean)
    .join(" ");
  const canExpand = line.pv.length > 12;

  const playPv = useCallback(
    (ply: number) => {
      for (const token of line.pv.slice(0, ply)) {
        const move = parseUciMove(token);
        if (!move) break;
        onPlay(move);
      }
    },
    [line.pv, onPlay],
  );

  return (
    <Table.Tr style={{ verticalAlign: "top" }}>
      <Table.Td width={70} py={5}>
        <XiangqiScoreBubble score={line.score} />
      </Table.Td>
      <Table.Td py={5}>
        <Box
          style={{
            minHeight: 35,
            overflow: open ? "visible" : "hidden",
            display: "flex",
            alignItems: "center",
          }}
        >
          <PvLine
            fen={fen}
            pv={line.pv}
            limit={open ? null : 12}
            onMoveClick={threatMode ? undefined : playPv}
          />
        </Box>
      </Table.Td>
      <Table.Td width={34} py={5}>
        <Stack gap={4} align="center">
          {canExpand && (
            <ActionIcon
              variant="subtle"
              style={{
                transition: "transform 200ms ease",
                transform: open ? "rotate(180deg)" : "none",
              }}
              onClick={() => setOpen((value) => !value)}
            >
              <IconChevronDown size={16} />
            </ActionIcon>
          )}
          {open && (
            <CopyButton value={engineOutput} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip
                  label={copied ? t("Common.Copied") : t("Menu.Edit.Copy")}
                  withArrow
                  position="right"
                >
                  <ActionIcon
                    color={copied ? "teal" : undefined}
                    variant="subtle"
                    onClick={copy}
                    aria-label={copied ? t("Common.Copied") : t("Menu.Edit.Copy")}
                  >
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          )}
        </Stack>
      </Table.Td>
    </Table.Tr>
  );
}

function XiangqiScoreBubble({ score }: { score: string }) {
  const positive = isPositiveXiangqiScore(score);
  return (
    <Box
      style={(theme) => ({
        backgroundColor: positive ? theme.colors.gray[0] : theme.colors.dark[9],
        textAlign: "center",
        padding: "0.15rem",
        borderRadius: theme.radius.sm,
        width: "4rem",
        height: "1.85rem",
        boxShadow: theme.shadows.md,
      })}
    >
      <Text
        fw={700}
        c={positive ? "black" : "white"}
        size="sm"
        ta="center"
        style={(theme) => ({
          fontFamily: theme.fontFamilyMonospace,
        })}
      >
        {formatXiangqiScore(score)}
      </Text>
    </Box>
  );
}

function XiangqiEngineSettingsPanel({
  color,
  settings,
  setSettings,
  onManage,
  onStop,
}: {
  color: string;
  settings: XiangqiEngineSettings;
  setSettings: (updater: (previous: XiangqiEngineSettings) => XiangqiEngineSettings) => void;
  onManage: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const multipv = getNumericSetting(settings.settings, "MultiPV", 1);
  const threads = getNumericSetting(settings.settings, "Threads", 1);
  const hash = getNumericSetting(settings.settings, "Hash", 64);

  return (
    <Stack gap="sm" pt="xs">
      <XiangqiGoModeInput
        goMode={settings.go}
        setGoMode={(go) =>
          setSettings((previous) => ({
            ...previous,
            go,
          }))
        }
      />

      <Group grow>
        <Text size="sm" fw="bold">
          {t("Engines.Settings.NumOfLines")}
        </Text>
        <LinesSlider
          value={multipv}
          setValue={(value) =>
            setSettings((previous) => ({
              ...previous,
              settings: setEngineSetting(previous.settings, "MultiPV", value || 1),
            }))
          }
          color={color}
        />
      </Group>

      <Group grow>
        <Text size="sm" fw="bold">
          {t("Engines.Settings.NumOfCores")}
        </Text>
        <CoresSlider
          value={threads}
          setValue={(value) =>
            setSettings((previous) => ({
              ...previous,
              settings: setEngineSetting(previous.settings, "Threads", value || 1),
            }))
          }
          color={color}
        />
      </Group>

      <Group grow>
        <Text size="sm" fw="bold">
          {t("Engines.Settings.SizeOfHash")}
        </Text>
        <HashSlider
          value={hash}
          setValue={(value) =>
            setSettings((previous) => ({
              ...previous,
              settings: setEngineSetting(previous.settings, "Hash", value || 64),
            }))
          }
          color={color}
        />
      </Group>

      <Group justify="space-between" wrap="nowrap">
        <Checkbox
          label={t("Board.Analysis.SyncGlobally")}
          checked={settings.synced}
          onChange={(event) =>
            setSettings((previous) => ({
              ...previous,
              synced: event.currentTarget.checked,
            }))
          }
        />
        <ActionIcon.Group>
          <Tooltip label={t("Board.Analysis.StopEngine", "Stop engine")}>
            <ActionIcon variant="default" onClick={onStop}>
              <IconPlayerStopFilled size="1rem" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("Engines.Settings.AdvancedSettings")}>
            <ActionIcon variant="default" onClick={onManage}>
              <IconSettings size="1rem" />
            </ActionIcon>
          </Tooltip>
        </ActionIcon.Group>
      </Group>
    </Stack>
  );
}

function XiangqiGoModeInput({
  goMode,
  setGoMode,
}: {
  goMode: XiangqiGoMode;
  setGoMode: (goMode: XiangqiGoMode) => void;
}) {
  const { t } = useTranslation();
  const normalizedGo = normalizeXiangqiGoMode(goMode);
  const modes = ["Time", "Depth", "Nodes", "Infinite"] as const;

  return (
    <Group grow align="flex-end" wrap="nowrap">
      <InputWrapper label={t("Board.Analysis.GoMode", "Go mode")}>
        <Select
          allowDeselect={false}
          data={modes.map((value) => ({ value, label: t(`GoMode.${value}`) }))}
          value={normalizedGo.t}
          onChange={(value) => setGoMode(defaultGoMode(value))}
        />
      </InputWrapper>

      {normalizedGo.t !== "Infinite" && (
        <InputWrapper label={t(`GoMode.${normalizedGo.t}`)}>
          {normalizedGo.t === "Time" ? (
            <TimeInput
              value={normalizedGo.c}
              setValue={(value) => setGoMode(normalizeXiangqiGoMode(value))}
            />
          ) : (
            <NumberInput
              min={1}
              max={normalizedGo.t === "Depth" ? 99 : undefined}
              value={normalizedGo.c}
              onChange={(value) =>
                setGoMode(
                  normalizedGo.t === "Depth"
                    ? { t: "Depth", c: typeof value === "number" ? value : 1 }
                    : { t: "Nodes", c: typeof value === "number" ? value : 1 },
                )
              }
            />
          )}
        </InputWrapper>
      )}
    </Group>
  );
}

function XiangqiReportPanel() {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const { reportScores } = useXiangqiAnalysisContext();
  const root = useXiangqiStore((s) => s.root);
  const path = useXiangqiStore((s) => s.path);
  const goToMove = useXiangqiStore((s) => s.goToMove);

  const data = useMemo(
    () => buildXiangqiEvalChartData(root, reportScores),
    [reportScores, root],
  );
  const currentPointName = data.find((point) => samePath(point.path, path))?.name;
  const hasScores = data.some((point) => point.value !== "none");

  const onChartClick: CategoricalChartFunc = (event) => {
    const point = data.find((candidate) => candidate.name === event.activeLabel);
    if (point) goToMove(point.path);
  };

  if (data.length === 0) {
    return (
      <Stack h="100%" align="center" justify="center">
        <Text c="dimmed">{t("Board.Analysis.NoAnalysisYet")}</Text>
      </Stack>
    );
  }

  return (
    <Stack h="100%" p="sm" gap="sm">
      <Paper withBorder p="sm">
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <Text fw={800}>{t("Board.Analysis.Report")}</Text>
            <Text size="xs" c="dimmed">
              {data.filter((point) => point.value !== "none").length}/{data.length}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            当前曲线来自本次会话中已由引擎分析过的主线局面
          </Text>
        </Stack>
      </Paper>

      <Paper withBorder p="sm">
        {hasScores ? (
          <AreaChart
            h={220}
            data={data}
            dataKey="name"
            series={[{ name: "value", color: "red.6" }]}
            curveType="monotone"
            connectNulls={false}
            withXAxis={false}
            withYAxis
            yAxisProps={{ domain: [-1, 1], width: 34 }}
            type="split"
            fillOpacity={0.7}
            splitColors={["red.1", "dark.8"]}
            splitOffset={0.5}
            activeDotProps={{ r: 3, strokeWidth: 1 }}
            dotProps={{ r: 0 }}
            gridAxis="none"
            referenceLines={
              currentPointName
                ? [
                    {
                      x: currentPointName,
                      color: theme.colors[theme.primaryColor][7],
                    },
                  ]
                : []
            }
            areaChartProps={{
              onClick: onChartClick,
              style: { cursor: "pointer" },
            }}
            areaProps={{ isAnimationActive: false }}
            tooltipProps={{
              content: ({ payload, active }) => (
                <XiangqiEvalChartTooltip active={active} payload={payload} />
              ),
            }}
          />
        ) : (
          <Stack h={220} align="center" justify="center">
            <Text c="dimmed" size="sm">
              打开引擎并浏览主线局面后，这里会显示局势变化
            </Text>
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

type XiangqiEvalChartPoint = {
  name: string;
  move: string;
  scoreText: string;
  value: number | "none";
  path: number[];
};

function buildXiangqiEvalChartData(
  root: GameNode,
  scores: Record<string, string>,
): XiangqiEvalChartPoint[] {
  const nodes = traverseMainline(root).slice(1);
  return nodes.map((node, index) => {
    const path = Array.from({ length: index + 1 }, () => 0);
    const turn = parseFen(node.fen).turn;
    const score = scores[node.fen];
    const evaluation = score ? parseXiangqiEvaluation(score, turn) : null;
    const value =
      evaluation?.redCentipawns !== undefined
        ? 2 / (1 + Math.exp(-0.004 * evaluation.redCentipawns)) - 1
        : "none";

    return {
      name: `${index + 1}. ${node.text}`,
      move: node.text,
      scoreText: evaluation?.label ?? "-",
      value,
      path,
    };
  });
}

function XiangqiEvalChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload: XiangqiEvalChartPoint }[];
}) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload;
  return (
    <Paper shadow="md" withBorder p="xs">
      <Text size="sm" fw={700}>
        {point.move}
      </Text>
      <Text size="xs" c="dimmed">
        红方视角: {point.scoreText}
      </Text>
    </Paper>
  );
}

function samePath(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function XiangqiLogsPanel({
  engines,
  results,
}: {
  engines: LocalEngine[];
  results: Record<string, EngineResult>;
}) {
  const [engineId, setEngineId] = useState("");
  const selectedEngine = engines.find((engine) => engine.id === engineId) ?? engines[0];
  const logs = useMemo(
    () => convertXiangqiLogs(results[selectedEngine?.id ?? ""]?.analysis?.logs ?? []),
    [results, selectedEngine?.id],
  );

  useEffect(() => {
    if (!selectedEngine && engineId) {
      setEngineId("");
    } else if (!engineId && selectedEngine) {
      setEngineId(selectedEngine.id);
    }
  }, [engineId, selectedEngine]);

  return (
    <Stack flex={1} h="100%">
      <EngineLogsView
        logs={logs}
        additionalControls={
          <Select
            allowDeselect={false}
            value={selectedEngine?.id ?? ""}
            onChange={(id) => setEngineId(id ?? "")}
            data={engines.map((engine) => ({ value: engine.id, label: engine.name }))}
            style={{ minWidth: 140 }}
          />
        }
      />
    </Stack>
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

function PvLine({
  fen,
  pv,
  limit = 12,
  onMoveClick,
}: {
  fen: string;
  pv: string[];
  limit?: number | null;
  onMoveClick?: (ply: number) => void;
}) {
  const tokens = useMemo(() => buildPvTokens(fen, pv, limit), [fen, limit, pv]);
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
                cursor: onMoveClick ? "pointer" : "default",
                whiteSpace: "nowrap",
              }}
              onClick={() => onMoveClick?.(token.ply)}
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

type XiangqiGoMode =
  | { t: "Depth"; c: number }
  | { t: "Time"; c: number }
  | { t: "Nodes"; c: number }
  | { t: "Infinite" };

type XiangqiEngineSettings = {
  enabled: boolean;
  go: XiangqiGoMode;
  settings: EngineSettings;
  synced: boolean;
};

const DEFAULT_XIANGQI_DEPTH = 10;
const DEFAULT_XIANGQI_GO: XiangqiGoMode = { t: "Depth", c: DEFAULT_XIANGQI_DEPTH };
const DEFAULT_XIANGQI_SETTINGS: EngineSettings = [
  { name: "MultiPV", value: 1 },
  { name: "Threads", value: 1 },
  { name: "Hash", value: 64 },
];

function applyXiangqiSettings(
  engine: LocalEngine,
  override: XiangqiEngineSettings | undefined,
): LocalEngine {
  const settings = getXiangqiSettings(engine, override);
  return {
    ...engine,
    enabled: settings.enabled,
    go: settings.go,
    settings: settings.settings,
  };
}

function getXiangqiSettings(
  engine: LocalEngine,
  override: XiangqiEngineSettings | undefined,
): XiangqiEngineSettings {
  if (override && !override.synced) {
    return normalizeXiangqiSettings(override);
  }

  return normalizeXiangqiSettings({
    enabled: override?.enabled ?? false,
    go: normalizeXiangqiGoMode(engine.go),
    settings: engine.settings ?? [],
    synced: true,
  });
}

function normalizeXiangqiSettings(settings: XiangqiEngineSettings): XiangqiEngineSettings {
  return {
    ...settings,
    go: normalizeXiangqiGoMode(settings.go),
    settings: ensureXiangqiEngineSettings(settings.settings),
  };
}

function normalizeXiangqiGoMode(
  goMode: GoMode | XiangqiGoMode | null | undefined,
  fallback: XiangqiGoMode = DEFAULT_XIANGQI_GO,
): XiangqiGoMode {
  if (goMode?.t === "Time") {
    return { t: "Time", c: Math.max(50, Math.trunc(goMode.c || fallbackValue(fallback, 8000))) };
  }

  if (goMode?.t === "Depth") {
    return { t: "Depth", c: Math.max(1, Math.min(Math.trunc(goMode.c || 10), 99)) };
  }

  if (goMode?.t === "Nodes") {
    return { t: "Nodes", c: Math.max(1, Math.trunc(goMode.c || 1000000)) };
  }

  if (goMode?.t === "Infinite") {
    return { t: "Infinite" };
  }

  return fallback;
}

function fallbackValue(goMode: XiangqiGoMode, fallback: number) {
  return "c" in goMode ? goMode.c : fallback;
}

function defaultGoMode(value: string | null): XiangqiGoMode {
  switch (value) {
    case "Time":
      return { t: "Time", c: 8000 };
    case "Depth":
      return { t: "Depth", c: DEFAULT_XIANGQI_DEPTH };
    case "Nodes":
      return { t: "Nodes", c: 1000000 };
    case "Infinite":
      return { t: "Infinite" };
    default:
      return DEFAULT_XIANGQI_GO;
  }
}

function ensureXiangqiEngineSettings(settings: EngineSettings | null | undefined): EngineSettings {
  const next = [...(settings ?? [])];
  for (const defaultSetting of DEFAULT_XIANGQI_SETTINGS) {
    if (!next.some((setting) => setting.name === defaultSetting.name)) {
      next.push({ ...defaultSetting });
    }
  }
  return next;
}

function setEngineSetting(
  settings: EngineSettings,
  name: "MultiPV" | "Threads" | "Hash",
  value: number,
): EngineSettings {
  const normalized = ensureXiangqiEngineSettings(settings);
  return normalized.map((setting) => (setting.name === name ? { ...setting, value } : setting));
}

function getNumericSetting(
  settings: EngineSettings,
  name: "MultiPV" | "Threads" | "Hash",
  fallback: number,
): number {
  const value = Number(settings.find((setting) => setting.name === name)?.value);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createAnalysisRequestId(engineId: string): string {
  return `${engineId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function swapXiangqiTurn(fen: string): string {
  try {
    const position = parseFen(fen);
    return makeFen({
      ...position,
      turn: opposite(position.turn),
    });
  } catch {
    const parts = fen.trim().split(/\s+/);
    parts[1] = parts[1] === "b" ? "w" : "b";
    return parts.join(" ");
  }
}

async function startAnalysis(engine: LocalEngine, fen: string, requestId: string): Promise<void> {
  const goMode = normalizeXiangqiGoMode(engine.go);
  const engineSettings = ensureXiangqiEngineSettings(engine.settings);

  await invoke("start_xiangqi_analysis", {
    request: buildAnalyzeRequest(engine, fen, {
      requestId,
      goMode,
      multipv: getNumericSetting(engineSettings, "MultiPV", 1),
      settings: engineSettings,
    }),
  });
}

function buildAnalyzeRequest(
  engine: LocalEngine,
  fen: string,
  options: {
    requestId?: string;
    goMode: XiangqiGoMode;
    multipv: number;
    settings: EngineSettings;
  },
) {
  const goMode = normalizeXiangqiGoMode(options.goMode);
  const depth = goMode.t === "Depth" ? goMode.c : DEFAULT_XIANGQI_DEPTH;

  return {
    requestId: options.requestId,
    engine: {
      id: engine.id,
      name: engine.name,
      path: engine.path,
      protocol: engine.protocol ?? "uci",
      threads: getNumericSetting(options.settings, "Threads", 1),
      hash: getNumericSetting(options.settings, "Hash", 64),
      moveTimeMs: goMode.t === "Time" ? goMode.c : null,
    },
    fen,
    moves: [],
    depth,
    multipv: options.multipv,
    goMode,
  };
}

async function stopXiangqiAnalysis(requestId?: string): Promise<void> {
  await invoke("stop_analysis", { requestId: requestId ?? null });
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

function buildPvTokens(fen: string, pv: string[], limit: number | null = 12): PvToken[] {
  let position: XiangqiPosition;
  try {
    position = parseFen(fen);
  } catch {
    return [];
  }

  const tokens: PvToken[] = [];
  let previousMoveNumber = 0;
  for (const token of limit === null ? pv : pv.slice(0, limit)) {
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

function convertXiangqiLogs(logs: string[]): EngineLog[] {
  return logs.map((line) => {
    const gui = line.match(/^gui:\s?(.*)$/i);
    if (gui) return { type: "gui", value: gui[1] };
    const engine = line.match(/^engine:\s?(.*)$/i);
    if (engine) return { type: "engine", value: engine[1] };
    return { type: "engine", value: line };
  });
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
