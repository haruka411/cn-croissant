import { ActionIcon, Stack, Tooltip } from "@mantine/core";
import {
  IconCamera,
  IconDeviceFloppy,
  IconEdit,
  IconEditOff,
  IconEraser,
  IconSwitchVertical,
  IconTarget,
  IconZoomCheck,
} from "@tabler/icons-react";
import { useLoaderData } from "@tanstack/react-router";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import domtoimage from "dom-to-image";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import {
  autoSaveAtom,
  clearXiangqiDrawingsAtom,
  currentGameStartFromCurrentAtom,
  currentGameStateAtom,
  currentTabAtom,
  eraseDrawablesOnClickAtom,
} from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import { useXiangqiStore } from "@/xiangqi/store";

interface XiangqiBoardControlsProps {
  editingMode: boolean;
  toggleEditingMode: () => void;
  dirty: boolean;
  saveFile?: () => void;
  disableVariations?: boolean;
  allowEditing?: boolean;
}

function XiangqiBoardControls({
  editingMode,
  toggleEditingMode,
  dirty,
  saveFile,
  disableVariations,
  allowEditing,
}: XiangqiBoardControlsProps) {
  const { t } = useTranslation();
  const { documentDir } = useLoaderData({ from: "/" });
  const headers = useXiangqiStore((s) => s.headers);
  const setHeaders = useXiangqiStore((s) => s.setHeaders);
  const clearShapes = useXiangqiStore((s) => s.clearShapes);
  const keyMap = useAtomValue(keyMapAtom);
  const [currentTab, setCurrentTab] = useAtom(currentTabAtom);
  const setGameState = useSetAtom(currentGameStateAtom);
  const setGameStartFromCurrent = useSetAtom(currentGameStartFromCurrentAtom);
  const clearXiangqiDrawings = useSetAtom(clearXiangqiDrawingsAtom);
  const autoSave = useAtomValue(autoSaveAtom);
  const eraseDrawablesOnClick = useAtomValue(eraseDrawablesOnClickAtom);

  const toggleOrientation = () =>
    setHeaders({
      ...headers,
      orientation: headers.orientation === "black" ? "red" : "black",
    });

  function changeTabType() {
    setCurrentTab((tab) => {
      if (tab.type === "analysis") {
        setGameStartFromCurrent(true);
        setGameState("settingUp");
      } else {
        setGameState("settingUp");
      }
      return { ...tab, type: tab.type === "analysis" ? "play" : "analysis" };
    });
  }

  const takeSnapshot = async () => {
    const snapshotTarget = document.querySelector(".cg-wrap") as HTMLElement | null;
    if (!snapshotTarget) return;

    domtoimage.toBlob(snapshotTarget).then(async (blob) => {
      if (blob == null) return;

      const filePath = await save({
        title: "Save board snapshot",
        defaultPath: documentDir,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });
      if (filePath == null) return;
      await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
    });
  };

  return (
    <Stack gap={4} align="center">
      <Tooltip position="right" label={t("Board.Action.TakeSnapshot")}>
        <ActionIcon onClick={() => takeSnapshot()}>
          <IconCamera size="1.2rem" />
        </ActionIcon>
      </Tooltip>
      <Tooltip
        position="right"
        label={t(
          currentTab?.type === "analysis"
            ? "Board.Action.PlayFromHere"
            : "Board.Action.AnalyzeGame",
        )}
      >
        <ActionIcon onClick={changeTabType}>
          {currentTab?.type === "analysis" ? (
            <IconTarget size="1.2rem" />
          ) : (
            <IconZoomCheck size="1.2rem" />
          )}
        </ActionIcon>
      </Tooltip>
      {!eraseDrawablesOnClick && (
        <Tooltip position="right" label={t("Board.Action.ClearDrawings")}>
          <ActionIcon
            onClick={() => {
              clearShapes();
              clearXiangqiDrawings();
            }}
          >
            <IconEraser size="1.2rem" />
          </ActionIcon>
        </Tooltip>
      )}
      {(!disableVariations || allowEditing) && (
        <Tooltip position="right" label={t("Board.Action.EditPosition")}>
          <ActionIcon onClick={() => toggleEditingMode()}>
            {editingMode ? <IconEditOff size="1.2rem" /> : <IconEdit size="1.2rem" />}
          </ActionIcon>
        </Tooltip>
      )}
      {saveFile && (
        <Tooltip position="right" label={t("Board.Action.SavePGN", { key: keyMap.SAVE_FILE.keys })}>
          <ActionIcon
            onClick={() => saveFile()}
            variant={dirty && !autoSave ? "default" : "transparent"}
          >
            <IconDeviceFloppy size="1.2rem" />
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip
        position="right"
        label={t("Board.Action.FlipBoard", { key: keyMap.SWAP_ORIENTATION.keys })}
      >
        <ActionIcon onClick={() => toggleOrientation()}>
          <IconSwitchVertical size="1.2rem" />
        </ActionIcon>
      </Tooltip>
    </Stack>
  );
}

export default memo(XiangqiBoardControls);
