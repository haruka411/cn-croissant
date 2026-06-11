import {
  Button,
  Checkbox,
  Divider,
  FileInput,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useLoaderData } from "@tanstack/react-router";
import { resolve } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useAtom, useStore } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { match } from "ts-pattern";
import { addRecentFileAtom, currentTabAtom } from "@/state/atoms";
import {
  createXiangqiStateFromFen,
  createXiangqiStateFromNotation,
  persistXiangqiState,
} from "@/xiangqi/persistence";
import { readXiangqiNotationFile } from "@/xiangqi/importFile";
import { makeFen, parseFen } from "@/xiangqi/xiangqi";
import GenericCard from "../common/GenericCard";
import type { FileMetadata, FileType } from "../files/file";
import type { Tab } from "@/utils/tabs";

type ImportType = "Notation" | "FEN";

const FILE_TYPES = [
  { label: "Files.FileType.Game", value: "game" },
  { label: "Files.FileType.Repertoire", value: "repertoire" },
  { label: "Files.FileType.Tournament", value: "tournament" },
  { label: "Files.FileType.Other", value: "other" },
] as const;

export default function ImportModal({
  openModal,
  setOpenModal,
}: {
  openModal: boolean;
  setOpenModal: React.Dispatch<React.SetStateAction<boolean>>;
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
  setActiveTab: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const { t } = useTranslation();
  const [notation, setNotation] = useState("");
  const [fen, setFen] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [importType, setImportType] = useState<ImportType>("Notation");
  const [filetype, setFiletype] = useState<FileType>("game");
  const [loading, setLoading] = useState(false);
  const [, setCurrentTab] = useAtom(currentTabAtom);
  const [save, setSave] = useState(false);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const { documentDir } = useLoaderData({ from: "/" });
  const store = useStore();

  async function handleSubmit() {
    setLoading(true);
    setError("");

    try {
      if (importType === "Notation") {
        const contents = file ? await readXiangqiNotationFile(file) : notation;
        if (!contents.trim()) {
          setError(t("Import.NotationEmpty"));
          return;
        }
        const state = createXiangqiStateFromNotation(contents);
        let fileInfo: FileMetadata | null = null;

        if (save) {
          fileInfo = await writeImportedFile(contents);
        } else if (file) {
          fileInfo = {
            type: "file",
            path: file,
            numGames: 1,
            name: filename || filenameFromPath(file),
            lastModified: Date.now(),
            metadata: {
              type: "game",
              tags: [],
            },
          };
        }

        setCurrentTab((prev) => {
          persistXiangqiState(prev.value, state);
          return {
            ...prev,
            name: state.headers.title || state.headers.event || filename || t("Board.Xiangqi.Game"),
            gameOrigin: fileInfo
              ? {
                  kind: "file",
                  file: fileInfo,
                  gameNumber: 0,
                }
              : { kind: "none" },
            type: "analysis",
          };
        });

        if (fileInfo?.path) {
          store.set(addRecentFileAtom, {
            name: fileInfo.name,
            path: fileInfo.path,
            type: fileInfo.metadata.type,
          });
        }
      } else {
        const normalizedFen = makeFen(parseFen(fen.trim()));
        const state = createXiangqiStateFromFen(normalizedFen);
        setCurrentTab((prev) => {
          persistXiangqiState(prev.value, state);
          return {
            ...prev,
            name: t("Home.Card.AnalysisBoard.Title"),
            gameOrigin: { kind: "none" },
            type: "analysis",
          };
        });
      }

      setOpenModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function writeImportedFile(contents: string): Promise<FileMetadata> {
    const safeName = (filename.trim() || "xiangqi-game").replace(/[\\/:*?"<>|]+/g, " ");
    const path = await resolve(documentDir, `${safeName}.pgn`);
    const metadata = {
      type: filetype,
      tags: [],
    };
    await writeTextFile(path, contents);
    await writeTextFile(path.replace(/\.pgn$/i, ".info"), JSON.stringify(metadata));
    return {
      type: "file",
      path,
      numGames: 1,
      name: safeName,
      lastModified: Date.now(),
      metadata,
    };
  }

  const Input = match(importType)
    .with("Notation", () => (
      <Stack>
        <div>
          <FileInput
            label={t("Common.PGNFile")}
            description={t("Import.PGN.ClickToSelect")}
            onClick={async () => {
              const selected = (await open({
                multiple: false,
                filters: [
                  {
                    name: t("Board.Info.XiangqiNotation"),
                    extensions: ["pgn", "xqf", "cbl", "wxf", "txt"],
                  },
                ],
              })) as string | null;
              if (!selected) return;
              setFile(selected);
              setFilename(filenameFromPath(selected).replace(/\.(pgn|xqf|cbl|wxf|txt)$/i, ""));
            }}
            value={new File([new Blob()], file || "")}
            onChange={(value) => {
              if (value === null) {
                setFile(null);
                setFilename("");
              }
            }}
            disabled={notation !== ""}
          />
          <Divider pt="xs" label={t("Import.Or")} labelPosition="center" />
          <Textarea
            value={notation}
            disabled={file !== null}
            onChange={(event) => setNotation(event.currentTarget.value)}
            label={t("Common.PGNGame")}
            data-autofocus
            rows={8}
          />
        </div>

        <Checkbox
          label={t("Import.SaveToCollection")}
          checked={save}
          onChange={(event) => setSave(event.currentTarget.checked)}
        />

        {save && (
          <>
            <TextInput
              label={t("Common.Name")}
              placeholder={t("Common.EnterFileName")}
              required
              value={filename}
              onChange={(event) => setFilename(event.currentTarget.value)}
            />

            <Text fz="sm" fw="bold">
              {t("Files.FileType")}
            </Text>

            <SimpleGrid cols={3}>
              {FILE_TYPES.map((value) => (
                <GenericCard
                  key={value.value}
                  id={value.value}
                  isSelected={filetype === value.value}
                  setSelected={setFiletype}
                  Header={<Text ta="center">{t(value.label)}</Text>}
                />
              ))}
            </SimpleGrid>
          </>
        )}
      </Stack>
    ))
    .with("FEN", () => (
      <TextInput
        value={fen}
        onChange={(event) => setFen(event.currentTarget.value)}
        error={error}
        label="FEN"
        data-autofocus
        onKeyDown={(event) => {
          if (event.key === "Enter") void handleSubmit();
        }}
      />
    ))
    .exhaustive();

  const disabled = match(importType)
    .with("Notation", () => !notation && !file)
    .with("FEN", () => !fen)
    .exhaustive();

  return (
    <Modal
      opened={openModal}
      onClose={() => setOpenModal(false)}
      title={t("Home.Card.ImportGame.Title")}
    >
      <Group grow mb="sm">
        <GenericCard
          id="Notation"
          isSelected={importType === "Notation"}
          setSelected={setImportType}
          Header={<Text ta="center">{t("Common.PGNFile")}</Text>}
        />
        <GenericCard
          id="FEN"
          isSelected={importType === "FEN"}
          setSelected={setImportType}
          Header={<Text ta="center">FEN</Text>}
        />
      </Group>

      {Input}

      {error && importType !== "FEN" && (
        <Text mt="sm" size="sm" c="red">
          {error}
        </Text>
      )}

      <Button
        fullWidth
        mt="md"
        radius="md"
        loading={loading}
        disabled={disabled}
        onClick={handleSubmit}
      >
        {loading ? t("Import.Importing") : t("Home.Card.ImportGame.Button")}
      </Button>
    </Modal>
  );
}

function filenameFromPath(path: string) {
  return path.split(/(\\|\/)/g).pop() || "xiangqi-game";
}
