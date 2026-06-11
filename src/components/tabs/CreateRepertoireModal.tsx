import { Button, Modal, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { useLoaderData, useNavigate } from "@tanstack/react-router";
import { useAtom, useSetAtom, useStore } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { activeTabAtom, addRecentFileAtom, tabFamily, tabsAtom } from "@/state/atoms";
import { createFile } from "@/utils/files";
import { createTab } from "@/utils/tabs";
import { exportGame } from "@/xiangqi/notation";
import { persistXiangqiState, readPersistedXiangqiState } from "@/xiangqi/persistence";
import { createRootNode } from "@/xiangqi/xiangqi";

export default function CreateRepertoireModal({
  opened,
  setOpened,
}: {
  opened: boolean;
  setOpened: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [color, setColor] = useState<"red" | "black">("red");
  const [error, setError] = useState("");
  const { documentDir } = useLoaderData({ from: "/" });

  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const store = useStore();
  const navigate = useNavigate();

  async function handleCreate() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("Common.RequireName"));
      return;
    }

    const pgn = exportGame({
      id: "repertoire",
      title: trimmedName,
      event: trimmedName,
      red: "",
      black: "",
      result: "*",
      root: createRootNode(),
      updatedAt: Date.now(),
    });

    const result = await createFile({
      filename: trimmedName,
      filetype: "repertoire",
      pgn,
      dir: documentDir,
    });

    if (result.isErr) {
      setError(result.error.message);
      return;
    }

    const fileInfo = result.value;
    const id = await createTab({
      tab: {
        name: trimmedName,
        type: "analysis",
      },
      setTabs,
      setActiveTab,
      pgn,
      gameOrigin: {
        kind: "file",
        file: fileInfo,
        gameNumber: 0,
      },
    });

    const state = readPersistedXiangqiState(id);
    if (state) {
      persistXiangqiState(id, {
        ...state,
        headers: {
          ...state.headers,
          orientation: color,
        },
      });
    }

    store.set(tabFamily(id), "practice");
    store.set(addRecentFileAtom, {
      name: trimmedName,
      path: fileInfo.path,
      type: "repertoire",
    });
    navigate({ to: "/" });

    setName("");
    setColor("red");
    setError("");
    setOpened(false);
  }

  return (
    <Modal
      opened={opened}
      onClose={() => setOpened(false)}
      title={t("Home.Card.NewRepertoire.Title")}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleCreate();
        }}
      >
        <Stack>
          <TextInput
            label={t("Common.Name")}
            placeholder={t("Home.Card.NewRepertoire.NamePlaceholder")}
            value={name}
            onChange={(e) => {
              setName(e.currentTarget.value);
              if (error) setError("");
            }}
            error={error}
            data-autofocus
          />

          <div>
            <Text size="sm" fw={500} mb={4}>
              {t("Home.Card.NewRepertoire.Color")}
            </Text>
            <SegmentedControl
              fullWidth
              value={color}
              onChange={(v) => setColor(v as "red" | "black")}
              data={[
                { label: "Red", value: "red" },
                { label: "Black", value: "black" },
              ]}
            />
          </div>

          <Button type="submit">{t("Common.Create")}</Button>
        </Stack>
      </form>
    </Modal>
  );
}
