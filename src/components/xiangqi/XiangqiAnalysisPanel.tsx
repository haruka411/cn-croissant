import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
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
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronsRight,
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
import { useAtom, useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GoMode } from "@/bindings";
import TimeInput from "@/components/common/TimeInput";
import { enginesAtom, xiangqiEngineArrowsAtom, xiangqiEvaluationAtom } from "@/state/atoms";
import type { EngineSettings, LocalEngine } from "@/utils/engines";
import EngineSelection from "../panels/analysis/EngineSelection";
import CoresSlider from "../panels/analysis/CoresSlider";
import HashSlider from "../panels/analysis/HashSlider";
import LinesSlider from "../panels/analysis/LinesSlider";
import { formatXiangqiMove } from "@/xiangqi/notation";
import {
  applyMove,
  makeFen,
  opposite,
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

function XiangqiAnalysisPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [engines, setEngines] = useAtom(enginesAtom);
  const setEngineArrows = useSetAtom(xiangqiEngineArrowsAtom);
  const setEvaluation = useSetAtom(xiangqiEvaluationAtom);
  const fen = useXiangqiStore((s) => s.currentNode().fen);
  const playMove = useXiangqiStore((s) => s.makeMove);
  const [results, setResults] = useState<Record<string, EngineResult>>({});
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
    const arrows = activeEngines
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
  }, [activeEngines, results, setEngineArrows]);

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
                  onClick={() => navigate({ to: "/engines" })}
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
              const result = results[engine.id];
              return (
                <EngineAnalysisCard
                  key={engine.id}
                  engine={effectiveEngine}
                  result={result}
                  fen={analysisFen}
                  realFen={fen}
                  threatMode={threatMode}
                  pinned={pinnedEngineIds.includes(engine.id)}
                  color={ENGINE_ARROW_COLORS[index % ENGINE_ARROW_COLORS.length]}
                  onPlay={playMove}
                  onManage={() => navigate({ to: "/engines" })}
                  settings={getXiangqiSettings(engine, engineSettingsOverrides[engine.id])}
                  setSettings={(updater) => updateEngineSettings(engine.id, updater)}
                  onTogglePinned={() =>
                    setPinnedEngineIds((previous) =>
                      previous.includes(engine.id)
                        ? previous.filter((id) => id !== engine.id)
                        : [...previous, engine.id],
                    )
                  }
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
  realFen,
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
  realFen: string;
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
  const bestLine = result?.analysis?.lines[0];
  const bestMove = result?.analysis?.bestmove;
  const parsedBest = bestMove ? parseUciMove(bestMove) : null;
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
                ? formatScore(bestLine.score)
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
        ) : !settings.enabled ? (
          <Text size="sm" c="dimmed">
            {t("Board.Analysis.InactiveEngine")}
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            {result?.loading ? t("Board.Analysis.Thinking") : t("Board.Analysis.NoAnalysisYet")}
          </Text>
        )}
        {parsedBest && !threatMode && (
          <Button size="xs" variant="light" w="fit-content" onClick={() => onPlay(parsedBest)}>
            {t("Board.Analysis.PlayMove", { move: formatMoveFromFen(realFen, parsedBest) })}
          </Button>
        )}
      </Stack>
    </Paper>
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

  return (
    <Group grow align="flex-end" wrap="nowrap">
      <InputWrapper label={t("Board.Analysis.GoMode", "Go mode")}>
        <Select
          allowDeselect={false}
          data={[
            { value: "Time", label: t("GoMode.Time") },
            { value: "Depth", label: t("GoMode.Depth") },
          ]}
          value={normalizedGo.t}
          onChange={(value) => {
            if (value === "Time") setGoMode({ t: "Time", c: 8000 });
            else setGoMode({ t: "Depth", c: 10 });
          }}
        />
      </InputWrapper>

      <InputWrapper label={normalizedGo.t === "Time" ? t("GoMode.Time") : t("GoMode.Depth")}>
        {normalizedGo.t === "Time" ? (
          <TimeInput
            value={normalizedGo.c}
            setValue={(value) => setGoMode(normalizeXiangqiGoMode(value))}
          />
        ) : (
          <NumberInput
            min={1}
            max={30}
            value={normalizedGo.c}
            onChange={(value) =>
              setGoMode({ t: "Depth", c: typeof value === "number" ? value : 1 })
            }
          />
        )}
      </InputWrapper>
    </Group>
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

type XiangqiGoMode = { t: "Depth"; c: number } | { t: "Time"; c: number };

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
    enabled: override?.enabled ?? true,
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

function normalizeXiangqiGoMode(goMode: GoMode | null | undefined): XiangqiGoMode {
  if (goMode?.t === "Time") {
    return { t: "Time", c: Math.max(50, Math.trunc(goMode.c || 8000)) };
  }

  if (goMode?.t === "Depth") {
    return { t: "Depth", c: Math.max(1, Math.min(Math.trunc(goMode.c || 10), 30)) };
  }

  return DEFAULT_XIANGQI_GO;
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
    request: {
      requestId,
      engine: {
        id: engine.id,
        name: engine.name,
        path: engine.path,
        protocol: engine.protocol ?? "uci",
        threads: getNumericSetting(engineSettings, "Threads", 1),
        hash: getNumericSetting(engineSettings, "Hash", 64),
        moveTimeMs: goMode.t === "Time" ? goMode.c : null,
      },
      fen,
      moves: [],
      depth: goMode.t === "Depth" ? goMode.c : DEFAULT_XIANGQI_DEPTH,
      multipv: getNumericSetting(engineSettings, "MultiPV", 1),
    },
  });
}

async function stopXiangqiAnalysis(requestId?: string): Promise<void> {
  await invoke("stop_analysis", { requestId: requestId ?? null });
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
