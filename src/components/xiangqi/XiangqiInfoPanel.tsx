import {
  Alert,
  Button,
  CopyButton,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { IconCheck, IconCopy, IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NotationMoveFormat } from "@/xiangqi/notation";
import { useXiangqiStore } from "@/xiangqi/store";

function XiangqiInfoPanel() {
  const { t } = useTranslation();
  const headers = useXiangqiStore((s) => s.headers);
  const currentFen = useXiangqiStore((s) => s.currentNode().fen);
  const setFen = useXiangqiStore((s) => s.setFen);
  const setHeaders = useXiangqiStore((s) => s.setHeaders);
  const exportNotation = useXiangqiStore((s) => s.exportNotation);
  const importNotation = useXiangqiStore((s) => s.importNotation);
  const [fenInput, setFenInput] = useState(currentFen);
  const [notationInput, setNotationInput] = useState("");
  const [notationFormat, setNotationFormat] = useState<NotationMoveFormat>("coordinate");
  const [error, setError] = useState<string | null>(null);
  const notation = exportNotation(notationFormat);

  useEffect(() => {
    setFenInput(currentFen);
  }, [currentFen]);

  return (
    <Stack h="100%" p="sm" gap="sm">
      <Group grow>
        <TextInput
          label={t("Board.Xiangqi.Red")}
          value={headers.red}
          onChange={(event) => setHeaders({ ...headers, red: event.currentTarget.value })}
        />
        <TextInput
          label={t("Board.Xiangqi.Black")}
          value={headers.black}
          onChange={(event) => setHeaders({ ...headers, black: event.currentTarget.value })}
        />
      </Group>
      <TextInput
        label={t("Board.Info.Event")}
        value={headers.event}
        onChange={(event) => setHeaders({ ...headers, event: event.currentTarget.value })}
      />

      <Textarea
        label={t("Board.Info.CurrentFen")}
        autosize
        minRows={2}
        value={fenInput}
        onChange={(event) => setFenInput(event.currentTarget.value)}
      />
      <Group gap="xs">
        <Button
          variant="light"
          onClick={() => {
            try {
              setFen(fenInput);
              setError(null);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          {t("Board.Info.SetPosition")}
        </Button>
        <CopyButton value={currentFen}>
          {({ copied, copy }) => (
            <Button
              variant="default"
              leftSection={copied ? <IconCheck size="1rem" /> : <IconCopy size="1rem" />}
              onClick={copy}
            >
              {t("Board.Info.CopyFen")}
            </Button>
          )}
        </CopyButton>
      </Group>

      <Select
        label={t("Board.Info.ExportFormat")}
        value={notationFormat}
        data={[
          { value: "coordinate", label: t("Board.Info.FormatCoordinate") },
          { value: "wxf", label: "WXF" },
          { value: "chinese", label: t("Board.Info.FormatChinese") },
        ]}
        onChange={(value) =>
          setNotationFormat((value as NotationMoveFormat | null) ?? "coordinate")
        }
      />
      <Textarea
        label={t("Board.Info.ExportedNotation")}
        autosize
        minRows={6}
        value={notation}
        readOnly
      />
      <CopyButton value={notation}>
        {({ copied, copy }) => (
          <Button
            variant="default"
            leftSection={copied ? <IconCheck size="1rem" /> : <IconCopy size="1rem" />}
            onClick={copy}
          >
            {t("Board.Info.CopyNotation")}
          </Button>
        )}
      </CopyButton>

      <Textarea
        label={t("Board.Info.ImportNotation")}
        autosize
        minRows={5}
        value={notationInput}
        onChange={(event) => setNotationInput(event.currentTarget.value)}
      />
      <Button
        variant="light"
        disabled={!notationInput.trim()}
        onClick={() => {
          try {
            importNotation(notationInput);
            setError(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        {t("Common.Import")}
      </Button>

      {error && (
        <Alert color="red" icon={<IconInfoCircle size="1rem" />}>
          {error}
        </Alert>
      )}
      <Text size="xs" c="dimmed">
        {t("Board.Info.CoordinateHint")}
      </Text>
    </Stack>
  );
}

export default XiangqiInfoPanel;
