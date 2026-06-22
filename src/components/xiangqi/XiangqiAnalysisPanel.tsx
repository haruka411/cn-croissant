import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvidedDragHandleProps,
} from "@hello-pangea/dnd";
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
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CategoricalChartFunc } from "recharts/types/chart/types";
import type { EngineLog, GoMode } from "@/bindings";
import EngineLogsView from "@/components/common/EngineLogsView";
import TimeInput from "@/components/common/TimeInput";
import {
  boardImageAtom,
  customBoardCalibrationAtom,
  customBoardImageAtom,
  customPieceDirectoryAtom,
  customPieceScaleAtom,
  customPieceThemeConfirmedAtom,
  currentAnalysisTabAtom,
  currentTabAtom,
  enginesAtom,
  pieceSetAtom,
  showArrowsAtom,
  showConsecutiveArrowsAtom,
  xiangqiEngineArrowsAtom,
  xiangqiEvaluationAtom,
  xiangqiReportGoModeAtom,
  xiangqiReportScoresAtom,
} from "@/state/atoms";
import type { Engine, EngineSettings, LocalEngine } from "@/utils/engines";
import EngineSelection from "../panels/analysis/EngineSelection";
import CoresSlider from "../panels/analysis/CoresSlider";
import HashSlider from "../panels/analysis/HashSlider";
import LinesSlider from "../panels/analysis/LinesSlider";
import { formatXiangqiMove } from "@/xiangqi/notation";
import {
  formatXiangqiScore,
  isPositiveXiangqiScore,
  parseXiangqiEvaluation,
  parseXiangqiScore,
  scoreToXiangqiWinChance,
} from "@/xiangqi/evaluation";
import {
  applyMove,
  isCheckmate,
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
import { customBoardImageUrl as getCustomBoardImageUrl } from "@/xiangqi/customBoardTheme";
import { useCustomXiangqiPieces } from "@/xiangqi/customPieceTheme";

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
  reorderEngines: (sourceIndex: number, destinationIndex: number) => void;
  activeResults: Record<string, EngineResult>;
  analysisFen: string;
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
  const [engineSettingsOverrides, setEngineSettingsOverrides] = useState<
    Record<string, XiangqiEngineSettings>
  >({});
  const engineSettingsOverridesRef = useRef<Record<string, XiangqiEngineSettings>>({});
  const [threatMode, setThreatMode] = useState(false);
  const [pinnedEngineIds, setPinnedEngineIds] = useState<string[]>([]);

  useEffect(() => {
    engineSettingsOverridesRef.current = engineSettingsOverrides;
  }, [engineSettingsOverrides]);

  const localEngines = useMemo(
    () => (engines ?? []).filter((engine): engine is LocalEngine => engine.type === "local"),
    [engines],
  );
  const loadedEngines = useMemo(
    () => localEngines.filter((engine) => engine.loaded),
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

      const currentSettings = getXiangqiSettings(
        engine,
        engineSettingsOverridesRef.current[engineId],
      );
      const nextSettings = normalizeXiangqiSettings(updater(currentSettings));
      const nextOverrides = {
        ...engineSettingsOverridesRef.current,
        [engineId]: nextSettings,
      };

      engineSettingsOverridesRef.current = nextOverrides;
      setEngineSettingsOverrides(nextOverrides);

      if (!nextSettings.synced) return;

      setEngines(async (previous) =>
        (await previous).map((candidate) =>
          candidate.id === engineId && candidate.type === "local"
            ? {
                ...candidate,
                enabled: nextSettings.enabled,
                go: nextSettings.go,
                settings: nextSettings.settings,
              }
            : candidate,
        ),
      );
    },
    [loadedEngines, setEngines],
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
    };
  }, [activeEngines, analysisFen]);

  useEffect(() => {
    if (!showArrows) {
      setEngineArrows([]);
      return;
    }

    const activeOrderedEngines = orderedEngines
      .map((engine) => activeEngines.find((candidate) => candidate.id === engine.id))
      .filter((engine): engine is LocalEngine => !!engine);
    const arrows: XiangqiDrawShape[] = [];
    for (const [index, engine] of [...activeOrderedEngines].reverse().entries()) {
      const engineArrows = buildXiangqiEngineArrows(
        results[engine.id]?.analysis?.lines ?? [],
        ENGINE_ARROW_BRUSHES[
          (activeOrderedEngines.length - 1 - index) % ENGINE_ARROW_BRUSHES.length
        ],
        showConsecutiveArrows,
      );

      for (const arrow of engineArrows) {
        arrows.push(arrow);
      }
    }

    setEngineArrows(arrows);
    return () => setEngineArrows([]);
  }, [activeEngines, orderedEngines, results, setEngineArrows, showArrows, showConsecutiveArrows]);

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
      reorderEngines: (sourceIndex, destinationIndex) => {
        setEngines(async (previous) =>
          reorderXiangqiEngines(await previous, sourceIndex, destinationIndex),
        );
      },
      activeResults: results,
      analysisFen,
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
      results,
      setEngines,
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

function reorderXiangqiEngines(
  engines: Engine[],
  sourceIndex: number,
  destinationIndex: number,
): Engine[] {
  const result = [...engines];
  const loaded = result.filter(
    (engine): engine is LocalEngine => engine.type === "local" && !!engine.loaded,
  );
  const [removed] = loaded.splice(sourceIndex, 1);
  if (!removed) return result;
  loaded.splice(destinationIndex, 0, removed);

  return result.map((engine) =>
    engine.type === "local" && engine.loaded ? (loaded.shift() ?? engine) : engine,
  );
}

function XiangqiAnalysisPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useAtom(currentAnalysisTabAtom);
  const {
    loadedEngines,
    effectiveLoadedEngines,
    orderedEngines,
    reorderEngines,
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
            reorderEngines={reorderEngines}
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
  reorderEngines,
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
  reorderEngines: (sourceIndex: number, destinationIndex: number) => void;
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

        <DragDropContext
          onDragEnd={({ destination, source }) => {
            if (destination?.index === undefined || destination.index === source.index) return;
            reorderEngines(source.index, destination.index);
          }}
        >
          <Droppable droppableId="xiangqi-engines" direction="vertical">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}>
                <Stack gap="sm">
                  {orderedEngines.map((engine, index) => {
                    const effectiveEngine =
                      effectiveLoadedEngines.find((candidate) => candidate.id === engine.id) ??
                      engine;
                    const result = activeResults[engine.id];
                    return (
                      <Draggable key={engine.id} draggableId={engine.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            style={provided.draggableProps.style}
                          >
                            <EngineAnalysisCard
                              engine={effectiveEngine}
                              result={result}
                              fen={analysisFen}
                              threatMode={threatMode}
                              pinned={pinnedEngineIds.includes(engine.id)}
                              color={ENGINE_ARROW_COLORS[index % ENGINE_ARROW_COLORS.length]}
                              dragHandleProps={provided.dragHandleProps ?? undefined}
                              dragging={snapshot.isDragging}
                              onPlay={playMove}
                              onManage={onManage}
                              settings={getSettings(engine)}
                              setSettings={(updater) => updateSettings(engine.id, updater)}
                              onTogglePinned={() => togglePinned(engine.id)}
                            />
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </Stack>
              </div>
            )}
          </Droppable>
        </DragDropContext>
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
  dragHandleProps,
  dragging,
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
  dragHandleProps?: DraggableProvidedDragHandleProps;
  dragging?: boolean;
}) {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lines = result?.analysis?.lines ?? [];
  const bestLine = lines[0];
  const expectedLines = Math.max(1, getNumericSetting(settings.settings, "MultiPV", 2));
  const progress = Math.max(0, Math.min(result?.progress ?? 0, 100));

  return (
    <Paper
      withBorder
      p={0}
      style={{
        overflow: "hidden",
        borderTop: `3px solid var(--mantine-color-${color}-6)`,
        opacity: dragging ? 0.85 : 1,
      }}
    >
      <Group px="sm" py="xs" gap="sm" wrap="nowrap">
        <ActionIcon variant="subtle" color="gray" {...dragHandleProps}>
          <IconSelector size="1rem" />
        </ActionIcon>
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
  const multipv = getNumericSetting(settings.settings, "MultiPV", 2);
  const threads = getNumericSetting(settings.settings, "Threads", 2);
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
              settings: setEngineSetting(previous.settings, "MultiPV", value || 2),
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
              settings: setEngineSetting(previous.settings, "Threads", value || 2),
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
  const { loadedEngines } = useXiangqiAnalysisContext();
  const currentTab = useAtomValue(currentTabAtom);
  const root = useXiangqiStore((s) => s.root);
  const path = useXiangqiStore((s) => s.path);
  const goToMove = useXiangqiStore((s) => s.goToMove);
  const reportNodes = useMemo(() => buildXiangqiReportNodes(root), [root]);
  const [engineId, setEngineId] = useState("");
  const [reportScores, setReportScores] = useAtom(xiangqiReportScoresAtom);
  const [reportGoMode, setReportGoMode] = useAtom(xiangqiReportGoModeAtom);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const selectedEngine = loadedEngines.find((engine) => engine.id === engineId) ?? loadedEngines[0];
  const reportKey = useMemo(
    () => `${currentTab?.value ?? "unknown"}:${root.id}`,
    [currentTab?.value, root.id],
  );
  const scores = reportScores[reportKey] ?? {};
  const setScores = useCallback(
    (nextScores: Record<string, string>) =>
      setReportScores((previous) => ({
        ...previous,
        [reportKey]: nextScores,
      })),
    [reportKey, setReportScores],
  );

  useEffect(() => {
    if (!selectedEngine && engineId) {
      setEngineId("");
    } else if (!engineId && selectedEngine) {
      setEngineId(selectedEngine.id);
    }
  }, [engineId, selectedEngine]);

  const data = useMemo(() => buildXiangqiEvalChartData(reportNodes, scores), [reportNodes, scores]);
  const chartXDomain = useMemo(() => getXiangqiEvalChartXDomain(data), [data]);
  const currentPointX = data.find((point) => point.path && samePath(point.path, path))?.x;
  const hasScores = data.some((point) => point.value !== null || point.mateSign !== null);
  const analysedCount = data.filter((point) => point.value !== null || point.mateSign !== null)
    .length;

  const onChartClick: CategoricalChartFunc = (event) => {
    const activeX =
      typeof event.activeLabel === "number" ? event.activeLabel : Number(event.activeLabel);
    const point = findNearestXiangqiEvalChartPoint(data, activeX);
    if (point?.path) goToMove(point.path);
  };

  const generateReport = useCallback(async () => {
    if (!selectedEngine || reportNodes.length === 0) return;
    cancelledRef.current = false;
    setIsGenerating(true);
    setProgress(0);
    setError(null);
    setScores({});

    const nextScores: Record<string, string> = {};
    try {
      for (const [index, entry] of reportNodes.entries()) {
        if (cancelledRef.current) break;

        if (isCheckmate(parseFen(entry.node.fen))) {
          nextScores[entry.node.fen] = "mate -1";
          setScores({ ...nextScores });
          setProgress(((index + 1) / reportNodes.length) * 100);
          continue;
        }

        const analysis = await analyzeXiangqiReportPosition(
          selectedEngine,
          entry.node.fen,
          reportGoMode,
        );
        const score = analysis.lines[0]?.score;
        if (score) {
          nextScores[entry.node.fen] = score;
          setScores({ ...nextScores });
        }
        setProgress(((index + 1) / reportNodes.length) * 100);
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!cancelledRef.current) {
        setProgress(100);
      }
      setIsGenerating(false);
    }
  }, [reportGoMode, reportNodes, selectedEngine, setScores]);

  const stopReport = useCallback(() => {
    cancelledRef.current = true;
    setIsGenerating(false);
  }, []);
  const chartDomain = useMemo(() => getXiangqiEvalChartDomain(data), [data]);
  const chartData = useMemo(
    () => buildXiangqiEvalChartRenderData(data, chartDomain),
    [chartDomain, data],
  );
  const chartTicks = useMemo(() => getXiangqiEvalChartTicks(chartDomain), [chartDomain]);
  const chartTickFormatter = useCallback(
    (value: string | number) => formatXiangqiEvalChartTick(value, chartDomain),
    [chartDomain],
  );

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
              {analysedCount}/{data.length}
            </Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Select
              flex={1}
              size="xs"
              label={t("Common.Engine")}
              allowDeselect={false}
              disabled={isGenerating || loadedEngines.length === 0}
              value={selectedEngine?.id ?? ""}
              onChange={(id) => setEngineId(id ?? "")}
              data={loadedEngines.map((engine) => ({ value: engine.id, label: engine.name }))}
              placeholder={t("Board.Analysis.EngineRequired")}
            />
            <XiangqiReportGoModeInput
              goMode={reportGoMode}
              setGoMode={setReportGoMode}
              disabled={isGenerating}
            />
            <Button
              size="xs"
              variant="light"
              mt="auto"
              disabled={!selectedEngine || data.length === 0}
              loading={isGenerating}
              onClick={generateReport}
            >
              {t("Board.Analysis.GenerateReport")}
            </Button>
            {isGenerating && (
              <Button size="xs" variant="default" mt="auto" onClick={stopReport}>
                {t("Common.Cancel")}
              </Button>
            )}
          </Group>
          <Progress value={isGenerating ? progress : analysedCount > 0 ? 100 : 0} size="xs" />
          {error && (
            <Alert color="red" title={t("Board.Analysis.EngineError")}>
              {error}
            </Alert>
          )}
        </Stack>
      </Paper>

      <Paper withBorder p="sm">
        {hasScores ? (
          <Box h={220}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 12, right: 8, bottom: 12, left: 8 }}
                onClick={onChartClick}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid
                  horizontal
                  vertical={false}
                  horizontalValues={chartTicks}
                  stroke={theme.colors.gray[4]}
                  strokeDasharray="4 4"
                />
                <XAxis allowDataOverflow dataKey="x" domain={chartXDomain} hide type="number" />
                <YAxis
                  allowDataOverflow
                  allowDecimals={false}
                  axisLine={false}
                  domain={chartDomain}
                  interval={0}
                  padding={{ top: 12, bottom: 12 }}
                  tick={{ fill: theme.colors.gray[6], fontSize: 11 }}
                  tickFormatter={chartTickFormatter}
                  tickLine={false}
                  ticks={chartTicks}
                  width={52}
                />
                <ReferenceLine
                  y={0}
                  stroke={theme.colors.gray[5]}
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                />
                {currentPointX !== undefined && (
                  <ReferenceLine
                    x={currentPointX}
                    stroke={theme.colors[theme.primaryColor][7]}
                    ifOverflow="discard"
                  />
                )}
                <Area
                  activeDot={false}
                  baseValue={0}
                  connectNulls={false}
                  dataKey="positiveValue"
                  dot={false}
                  fill={theme.colors.red[5]}
                  fillOpacity={0.32}
                  isAnimationActive={false}
                  stroke="none"
                  type="monotone"
                />
                <Area
                  activeDot={false}
                  baseValue={0}
                  connectNulls={false}
                  dataKey="negativeValue"
                  dot={false}
                  fill={theme.colors.blue[5]}
                  fillOpacity={0.28}
                  isAnimationActive={false}
                  stroke="none"
                  type="monotone"
                />
                <Line
                  activeDot={{ r: 4, strokeWidth: 1 }}
                  connectNulls={false}
                  dataKey="positiveValue"
                  dot={{ r: 2.5, strokeWidth: 1 }}
                  isAnimationActive={false}
                  stroke={theme.colors.red[6]}
                  strokeWidth={2.2}
                  type="monotone"
                />
                <Line
                  activeDot={{ r: 4, strokeWidth: 1 }}
                  connectNulls={false}
                  dataKey="negativeValue"
                  dot={{ r: 2.5, strokeWidth: 1 }}
                  isAnimationActive={false}
                  stroke={theme.colors.blue[6]}
                  strokeWidth={2.2}
                  type="monotone"
                />
                <RechartsTooltip
                  content={({ payload, active }) => (
                    <XiangqiEvalChartTooltip active={active} payload={payload} />
                  )}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </Box>
        ) : (
          <Stack h={220} align="center" justify="center">
            <Text c="dimmed" size="sm">
              {loadedEngines.length === 0
                ? t("Board.Analysis.NoLocalXiangqiEngine")
                : "点击生成报告后，这里会显示局势变化"}
            </Text>
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

type XiangqiEvalChartPoint = {
  x: number;
  name: string;
  mateSign: -1 | 1 | null;
  move: string;
  negativeValue: number | null;
  positiveValue: number | null;
  scoreText: string;
  value: number | null;
  path: number[] | null;
  synthetic?: boolean;
};

type XiangqiReportNode = {
  node: GameNode;
  path: number[];
};

function buildXiangqiReportNodes(root: GameNode): XiangqiReportNode[] {
  const nodes = traverseMainline(root).slice(1);
  return nodes.map((node, index) => ({
    node,
    path: Array.from({ length: index + 1 }, () => 0),
  }));
}

function buildXiangqiEvalChartData(
  reportNodes: XiangqiReportNode[],
  scores: Record<string, string>,
): XiangqiEvalChartPoint[] {
  return reportNodes.map(({ node, path }, index) => {
    const position = parseFen(node.fen);
    const turn = position.turn;
    const score = scores[node.fen];
    const terminalMateSign = score ? getXiangqiTerminalReportMateSign(position) : null;
    const parsedScore = parseXiangqiScore(score);
    const evaluation = score ? parseXiangqiEvaluation(score, turn) : null;
    const engineMateSign =
      parsedScore?.kind === "mate" && evaluation
        ? getXiangqiChartSign(evaluation.redCentipawns)
        : null;
    const mateSign = terminalMateSign ?? engineMateSign;
    const redCentipawns =
      mateSign === null && evaluation?.redCentipawns !== undefined ? evaluation.redCentipawns : null;
    const value = redCentipawns !== null ? redCentipawns / 100 : null;

    return {
      x: index,
      mateSign,
      name: `${index + 1}. ${node.text}`,
      move: node.text,
      negativeValue: getXiangqiEvalNegativeValue(value),
      positiveValue: getXiangqiEvalPositiveValue(value),
      scoreText:
        terminalMateSign !== null
          ? `${terminalMateSign > 0 ? "+" : "-"}M0`
          : evaluation?.label ?? "-",
      value,
      path,
    };
  });
}

function buildXiangqiEvalChartRenderData(
  data: XiangqiEvalChartPoint[],
  chartDomain: [number, number],
): XiangqiEvalChartPoint[] {
  const chartData: XiangqiEvalChartPoint[] = [];
  let previous: XiangqiEvalChartPoint | null = null;

  for (const rawPoint of data) {
    const point = resolveXiangqiEvalChartPoint(rawPoint, chartDomain);
    const zeroCrossing = previous ? getXiangqiEvalZeroCrossing(previous, point) : null;
    if (zeroCrossing) {
      chartData.push(zeroCrossing);
    }
    chartData.push(point);
    previous = point;
  }

  return chartData;
}

function resolveXiangqiEvalChartPoint(
  point: XiangqiEvalChartPoint,
  [min, max]: [number, number],
): XiangqiEvalChartPoint {
  if (point.mateSign === null) return point;

  const value = point.mateSign > 0 ? max : min;
  return {
    ...point,
    negativeValue: getXiangqiEvalNegativeValue(value),
    positiveValue: getXiangqiEvalPositiveValue(value),
    value,
  };
}

function getXiangqiTerminalReportMateSign(position: XiangqiPosition): -1 | 1 | null {
  if (!isCheckmate(position)) return null;
  return position.turn === "red" ? -1 : 1;
}

function getXiangqiChartSign(value: number): -1 | 1 {
  return value < 0 ? -1 : 1;
}

function getXiangqiEvalZeroCrossing(
  previous: XiangqiEvalChartPoint,
  next: XiangqiEvalChartPoint,
): XiangqiEvalChartPoint | null {
  if (previous.value === null || next.value === null) return null;
  if (sameXiangqiChartValue(previous.value, 0) || sameXiangqiChartValue(next.value, 0)) return null;
  if (Math.sign(previous.value) === Math.sign(next.value)) return null;

  const distance =
    Math.abs(previous.value) / (Math.abs(previous.value) + Math.abs(next.value));
  const x = previous.x + (next.x - previous.x) * distance;

  return {
    x,
    mateSign: null,
    name: `${previous.name}-${next.name}-0`,
    move: "",
    negativeValue: 0,
    positiveValue: 0,
    scoreText: "0",
    value: 0,
    path: null,
    synthetic: true,
  };
}

function getXiangqiEvalPositiveValue(value: number | null): number | null {
  return value !== null && value >= 0 ? value : null;
}

function getXiangqiEvalNegativeValue(value: number | null): number | null {
  return value !== null && value <= 0 ? value : null;
}

function getXiangqiEvalChartXDomain(data: XiangqiEvalChartPoint[]): [number, number] {
  if (data.length <= 1) return [0, 1];
  return [0, data[data.length - 1].x];
}

function findNearestXiangqiEvalChartPoint(
  data: XiangqiEvalChartPoint[],
  x: number,
): XiangqiEvalChartPoint | null {
  if (!Number.isFinite(x)) return null;

  return data.reduce<XiangqiEvalChartPoint | null>((nearest, point) => {
    if (!point.path) return nearest;
    if (!nearest) return point;
    return Math.abs(point.x - x) < Math.abs(nearest.x - x) ? point : nearest;
  }, null);
}

async function analyzeXiangqiReportPosition(
  engine: LocalEngine,
  fen: string,
  reportGoMode: XiangqiReportGoMode,
): Promise<EngineAnalysis> {
  const settings = ensureXiangqiEngineSettings(engine.settings);
  const goMode = normalizeXiangqiReportGoMode(reportGoMode);
  const result = await invoke<EngineAnalysis>("analyze_position", {
    request: buildAnalyzeRequest(engine, fen, {
      requestId: createAnalysisRequestId(engine.id),
      goMode,
      multipv: 1,
      settings,
    }),
  });
  return result;
}

function XiangqiReportGoModeInput({
  goMode,
  setGoMode,
  disabled,
}: {
  goMode: XiangqiReportGoMode;
  setGoMode: (goMode: XiangqiReportGoMode) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const normalizedGo = normalizeXiangqiReportGoMode(goMode);
  const modes = ["Time", "Depth", "Nodes"] as const;

  return (
    <>
      <Select
        w={105}
        size="xs"
        label={t("Board.Analysis.GoMode", "Go mode")}
        allowDeselect={false}
        disabled={disabled}
        data={modes.map((value) => ({ value, label: t(`GoMode.${value}`) }))}
        value={normalizedGo.t}
        onChange={(value) => setGoMode(defaultXiangqiReportGoMode(value))}
      />
      <InputWrapper w={130} label={t(`GoMode.${normalizedGo.t}`)}>
        {normalizedGo.t === "Time" ? (
          <TimeInput
            size="xs"
            disabled={disabled}
            defaultType="s"
            value={normalizedGo.c}
            setValue={(value) => setGoMode(normalizeXiangqiReportGoMode(value))}
          />
        ) : (
          <NumberInput
            size="xs"
            disabled={disabled}
            min={1}
            max={normalizedGo.t === "Depth" ? 99 : undefined}
            value={normalizedGo.c}
            onChange={(value) =>
              setGoMode(
                normalizedGo.t === "Depth"
                  ? { t: "Depth", c: normalizeXiangqiReportDepth(value) }
                  : { t: "Nodes", c: normalizeXiangqiReportNodes(value) },
              )
            }
          />
        )}
      </InputWrapper>
    </>
  );
}

type XiangqiReportGoMode =
  | { t: "Time"; c: number }
  | { t: "Depth"; c: number }
  | { t: "Nodes"; c: number };

function defaultXiangqiReportGoMode(value: string | null): XiangqiReportGoMode {
  switch (value) {
    case "Depth":
      return { t: "Depth", c: 15 };
    case "Nodes":
      return { t: "Nodes", c: 1000000 };
    case "Time":
      return { t: "Time", c: 2000 };
    default:
      return { t: "Depth", c: 15 };
  }
}

function normalizeXiangqiReportGoMode(
  goMode: GoMode | XiangqiReportGoMode | null | undefined,
): XiangqiReportGoMode {
  if (goMode?.t === "Depth") {
    return { t: "Depth", c: normalizeXiangqiReportDepth(goMode.c) };
  }

  if (goMode?.t === "Nodes") {
    return { t: "Nodes", c: normalizeXiangqiReportNodes(goMode.c) };
  }

  if (goMode?.t === "Time") {
    const time = Math.trunc(goMode.c || 2000);
    return { t: "Time", c: Math.max(50, time) };
  }

  return { t: "Depth", c: 15 };
}

function normalizeXiangqiReportDepth(value: string | number | null | undefined): number {
  const depth = typeof value === "number" ? value : Number(value);
  return Number.isFinite(depth) ? Math.max(1, Math.min(Math.trunc(depth), 99)) : 15;
}

function normalizeXiangqiReportNodes(value: string | number | null | undefined): number {
  const nodes = typeof value === "number" ? value : Number(value);
  return Number.isFinite(nodes) ? Math.max(1, Math.trunc(nodes)) : 1000000;
}

const XIANGQI_EVAL_CHART_DEFAULT_BOUND = 20;
const XIANGQI_EVAL_CHART_MATE_BOUND = 100;

function getXiangqiEvalChartDomain(data: XiangqiEvalChartPoint[]): [number, number] {
  if (data.some((point) => point.mateSign !== null)) {
    return [-XIANGQI_EVAL_CHART_MATE_BOUND, XIANGQI_EVAL_CHART_MATE_BOUND];
  }

  const values = data
    .map((point) => point.value)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const maxAbs = values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const bound = Math.max(XIANGQI_EVAL_CHART_DEFAULT_BOUND, roundXiangqiChartBound(maxAbs));
  return [-bound, bound];
}

function getXiangqiEvalChartTicks([min, max]: [number, number]): number[] {
  const bound = Math.max(Math.abs(min), Math.abs(max));
  const step = getXiangqiEvalChartTickStep(bound);
  const ticks = new Set<number>([min, 0, max]);
  const firstTick = Math.ceil(min / step) * step;

  for (let value = firstTick; value <= max; value += step) {
    ticks.add(value);
  }

  return [...ticks].sort((a, b) => a - b);
}

function formatXiangqiEvalChartTick(value: string | number, [min, max]: [number, number]): string {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "";
  return sameXiangqiChartValue(number, min) ||
    sameXiangqiChartValue(number, 0) ||
    sameXiangqiChartValue(number, max)
    ? String(number)
    : "";
}

function roundXiangqiChartBound(value: number): number {
  return Math.ceil(Math.abs(value) / 5) * 5;
}

function getXiangqiEvalChartTickStep(bound: number): number {
  return Math.max(5, Math.ceil(bound / 4 / 5) * 5);
}

function sameXiangqiChartValue(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-9;
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
  if (point.synthetic) return null;
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
const DEFAULT_XIANGQI_GO: XiangqiGoMode = { t: "Infinite" };
const DEFAULT_XIANGQI_SETTINGS: EngineSettings = [
  { name: "MultiPV", value: 2 },
  { name: "Threads", value: 2 },
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
  if (override) {
    return normalizeXiangqiSettings(override);
  }

  return normalizeXiangqiSettings({
    enabled: engine.enabled ?? false,
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
      multipv: getNumericSetting(engineSettings, "MultiPV", 2),
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
      threads: getNumericSetting(options.settings, "Threads", 2),
      hash: getNumericSetting(options.settings, "Hash", 64),
      moveTimeMs: goMode.t === "Time" ? goMode.c : null,
    },
    fen,
    moves: [],
    depth,
    multipv: options.multipv,
    extraOptions: options.settings
      .filter((setting) => !["Threads", "Hash", "MultiPV"].includes(setting.name))
      .filter((setting) => setting.value !== null && setting.value !== undefined)
      .map((setting) => ({
        name: setting.name,
        value: String(setting.value),
      })),
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
  const boardTheme = useAtomValue(boardImageAtom);
  const customBoardCalibration = useAtomValue(customBoardCalibrationAtom);
  const customBoardImage = useAtomValue(customBoardImageAtom);
  const pieceStyle = useAtomValue(pieceSetAtom);
  const customPieceDirectory = useAtomValue(customPieceDirectoryAtom);
  const customPieceScale = useAtomValue(customPieceScaleAtom);
  const customPieceThemeConfirmed = useAtomValue(customPieceThemeConfirmedAtom);
  const customPieceTheme = useCustomXiangqiPieces(
    pieceStyle === "custom-svg",
    customPieceDirectory || undefined,
  );
  const customBoardUrl =
    boardTheme === "custom-png" && customBoardImage
      ? getCustomBoardImageUrl(customBoardImage)
      : undefined;
  const resolvedBoardTheme =
    boardTheme === "custom-png" && !customBoardUrl ? "classic" : boardTheme;
  const useCustomPieces =
    pieceStyle === "custom-svg" &&
    customPieceThemeConfirmed &&
    customPieceTheme.checkedDirs.length > 0 &&
    !customPieceTheme.loading &&
    customPieceTheme.missing.length === 0;

  return (
    <Box style={{ width: 220 }}>
      <XiangqiBoard
        position={position}
        selected={null}
        lastMove={null}
        orientation="red"
        boardTheme={resolvedBoardTheme}
        pieceStyle={useCustomPieces ? "custom-svg" : "classic"}
        customBoardImageUrl={customBoardUrl}
        customBoardCalibration={customBoardCalibration}
        customPieceUrls={useCustomPieces ? customPieceTheme.urls : undefined}
        customPieceScale={customPieceScale}
        showDests={false}
        showLastMove={false}
        moveMethod="select"
        drawingsEnabled={false}
        onSelect={() => {}}
        onMove={() => {}}
      />
    </Box>
  );
}

export default memo(XiangqiAnalysisPanel);
