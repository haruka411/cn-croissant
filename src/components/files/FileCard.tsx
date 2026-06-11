import {
  ActionIcon,
  Badge,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { IconEdit, IconZoomCheck } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { openFile } from "@/utils/files";
import { capitalize } from "@/utils/format";
import type { FileMetadata } from "./file";

function FileCard({
  selected,
  toggleEditModal,
}: {
  selected: FileMetadata;
  toggleEditModal: () => void;
}) {
  const { t } = useTranslation();
  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const navigate = useNavigate();
  const [contents, setContents] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setContents("");

    void readTextFile(selected.path)
      .then((text) => {
        if (!cancelled) setContents(text);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [selected.path]);

  async function openGame() {
    await openFile(selected, setTabs, setActiveTab, {
      gameNumber: 0,
      pgn: contents,
    });
    navigate({ to: "/" });
  }

  return (
    <Stack h="100%">
      <Stack align="center">
        <Text ta="center" fz="xl" fw="bold">
          {selected.name}
        </Text>
        <Badge>{t(`Files.FileType.${capitalize(selected.metadata.type)}`)}</Badge>
      </Stack>
      <Divider />

      <Group align="center" justify="space-between" px="xs">
        <Group>
          <Tooltip label={t("Common.Open")}>
            <ActionIcon size="sm" onClick={openGame}>
              <IconZoomCheck />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("Files.EditMetadata")}>
            <ActionIcon size="sm" onClick={() => toggleEditModal()}>
              <IconEdit />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Text size="sm" c="dimmed">
          {selected.path}
        </Text>
      </Group>

      <Divider />
      <ScrollArea flex={1} px="xs" pb="xs">
        {error ? (
          <Text c="red" size="sm">
            {error}
          </Text>
        ) : (
          <Textarea
            value={contents}
            readOnly
            autosize
            minRows={18}
            styles={{ input: { fontFamily: "monospace", userSelect: "text" } }}
          />
        )}
      </ScrollArea>
    </Stack>
  );
}

export default FileCard;
