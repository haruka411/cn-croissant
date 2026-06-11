import { basename, resolve } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Paper, Portal, Stack, Tabs } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import {
  IconDatabase,
  IconInfoCircle,
  IconNotes,
  IconTargetArrow,
  IconZoomCheck,
} from "@tabler/icons-react";
import { useLoaderData } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  autoSaveAtom,
  clearXiangqiDrawingsAtom,
  currentTabAtom,
  currentTabSelectedAtom,
} from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import { getTabFile } from "@/utils/tabs";
import { useXiangqiStore } from "@/xiangqi/store";
import XiangqiAnalysisPanel from "../xiangqi/XiangqiAnalysisPanel";
import XiangqiBoardControls from "../xiangqi/XiangqiBoardControls";
import XiangqiGameNotation from "../xiangqi/XiangqiGameNotation";
import XiangqiInfoPanel from "../xiangqi/XiangqiInfoPanel";
import XiangqiMoveControls from "../xiangqi/XiangqiMoveControls";
import XiangqiPendingPanel from "../xiangqi/XiangqiPendingPanel";
import Board from "./Board";

function BoardAnalysis() {
  const { t } = useTranslation();
  const [currentTab, setCurrentTab] = useAtom(currentTabAtom);
  const [currentTabSelected, setCurrentTabSelected] = useAtom(currentTabSelectedAtom);
  const tabFile = getTabFile(currentTab);
  const autoSave = useAtomValue(autoSaveAtom);
  const { documentDir } = useLoaderData({ from: "/" });
  const boardRef = useRef(null);
  const dirty = useXiangqiStore((s) => s.dirty);
  const headers = useXiangqiStore((s) => s.headers);
  const exportNotation = useXiangqiStore((s) => s.exportNotation);
  const markSaved = useXiangqiStore((s) => s.save);
  const clearShapes = useXiangqiStore((s) => s.clearShapes);
  const clearXiangqiDrawings = useSetAtom(clearXiangqiDrawingsAtom);

  const saveFile = useCallback(async () => {
    const contents = `${exportNotation()}\n\n`;
    let filePath = tabFile?.path;

    if (!filePath) {
      const defaultPath = await resolve(documentDir, `${defaultFileName(headers)}.pgn`);
      const userChoice = await save({
        defaultPath,
        filters: [{ name: t("Board.Info.XiangqiNotation"), extensions: ["pgn", "xqf", "txt"] }],
      });
      if (userChoice === null) return;
      filePath = ensureKnownExtension(userChoice);
      const fileName = (await basename(filePath)).replace(/\.(pgn|xqf|txt)$/i, "");
      setCurrentTab((prev) => ({
        ...prev,
        gameOrigin: {
          kind: "file",
          gameNumber: 0,
          file: {
            type: "file",
            name: fileName,
            path: filePath!,
            numGames: 1,
            metadata: {
              tags: [],
              type: "game",
            },
            lastModified: Date.now(),
          },
        },
      }));
    }

    await writeTextFile(filePath, contents);
    markSaved();
  }, [documentDir, exportNotation, headers, markSaved, setCurrentTab, t, tabFile?.path]);

  useEffect(() => {
    if (tabFile && autoSave && dirty) {
      void saveFile();
    }
  }, [autoSave, dirty, saveFile, tabFile]);

  const keyMap = useAtomValue(keyMapAtom);
  useHotkeys([
    [keyMap.SAVE_FILE.keys, () => saveFile()],
    [
      keyMap.CLEAR_SHAPES.keys,
      () => {
        clearShapes();
        clearXiangqiDrawings();
      },
    ],
    [keyMap.ANALYSIS_TAB.keys, () => setCurrentTabSelected("analysis")],
    [keyMap.DATABASE_TAB.keys, () => setCurrentTabSelected("database")],
    [keyMap.ANNOTATE_TAB.keys, () => setCurrentTabSelected("annotate")],
    [keyMap.INFO_TAB.keys, () => setCurrentTabSelected("info")],
  ]);

  const isRepertoire = tabFile?.metadata.type === "repertoire";

  return (
    <>
      <Portal target="#left" style={{ height: "100%" }}>
        <Board editingMode={false} boardRef={boardRef} />
      </Portal>
      <Portal target="#topRight" style={{ height: "100%" }}>
        <Paper withBorder style={{ height: "100%" }} pos="relative">
          <Tabs
            w="100%"
            h="100%"
            value={currentTabSelected}
            onChange={(v) => setCurrentTabSelected(v || "info")}
            keepMounted={false}
            activateTabWithKeyboard={false}
            style={{ display: "flex", flexDirection: "column" }}
            styles={{
              tabLabel: { flex: 0 },
              tab: {
                display: "flex",
                justifyContent: "center",
                gap: "0.3rem",
              },
            }}
          >
            <Tabs.List grow>
              {isRepertoire && (
                <Tabs.Tab value="practice" leftSection={<IconTargetArrow size="1rem" />}>
                  {t("Board.Tabs.Practice")}
                </Tabs.Tab>
              )}
              <Tabs.Tab value="analysis" leftSection={<IconZoomCheck size="1rem" />}>
                {t("Board.Tabs.Analysis")}
              </Tabs.Tab>
              <Tabs.Tab value="database" leftSection={<IconDatabase size="1rem" />}>
                {t("Board.Tabs.Database")}
              </Tabs.Tab>
              <Tabs.Tab value="annotate" leftSection={<IconNotes size="1rem" />}>
                {t("Board.Tabs.Annotate")}
              </Tabs.Tab>
              <Tabs.Tab value="info" leftSection={<IconInfoCircle size="1rem" />}>
                {t("Board.Tabs.Info")}
              </Tabs.Tab>
            </Tabs.List>
            {isRepertoire && (
              <Tabs.Panel value="practice" flex={1} style={{ overflowY: "hidden" }}>
                <XiangqiPendingPanel
                  title={t("Board.Pending.PracticeTitle")}
                  description={t("Board.Pending.PracticeDescription")}
                />
              </Tabs.Panel>
            )}
            <Tabs.Panel value="info" flex={1} style={{ overflowY: "auto" }}>
              <XiangqiInfoPanel />
            </Tabs.Panel>
            <Tabs.Panel value="database" flex={1} style={{ overflowY: "hidden" }}>
              <XiangqiPendingPanel
                title={t("Board.Pending.DatabaseTitle")}
                description={t("Board.Pending.DatabaseDescription")}
              />
            </Tabs.Panel>
            <Tabs.Panel value="annotate" flex={1} style={{ overflowY: "hidden" }}>
              <XiangqiPendingPanel
                title={t("Board.Pending.AnnotationTitle")}
                description={t("Board.Pending.AnnotationDescription")}
              />
            </Tabs.Panel>
            <Tabs.Panel value="analysis" flex={1} style={{ overflowY: "hidden" }}>
              <XiangqiAnalysisPanel />
            </Tabs.Panel>
          </Tabs>
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
                saveFile={saveFile}
                disableVariations
              />
            }
          />
          <XiangqiMoveControls />
        </Stack>
      </Portal>
    </>
  );
}

function defaultFileName(headers: { event: string; red: string; black: string }) {
  const base =
    headers.event.trim() ||
    [headers.red.trim(), headers.black.trim()].filter(Boolean).join(" vs ") ||
    "xiangqi-game";
  return base
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureKnownExtension(path: string) {
  return /\.(pgn|xqf|txt)$/i.test(path) ? path : `${path}.pgn`;
}

export default BoardAnalysis;
