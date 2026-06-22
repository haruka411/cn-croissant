import {
  ActionIcon,
  Box,
  Button,
  Group,
  NumberInput,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconFolderOpen, IconRefresh, IconRestore } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import {
  boardImageAtom,
  customBoardCalibrationAtom,
  customBoardDirectoryAtom,
  customBoardImageAtom,
  type XiangqiBoardTheme,
} from "@/state/atoms";
import {
  DEFAULT_CUSTOM_BOARD_CALIBRATION,
  customBoardDisplayName,
  customBoardImageUrl,
  loadCustomBoardImages,
  type CustomBoardCalibration,
  type CustomBoardImage,
} from "@/xiangqi/customBoardTheme";

const boardThemes: { label: string; value: XiangqiBoardTheme; colors: [string, string, string] }[] =
  [
    { label: "经典木纹", value: "classic", colors: ["#d8a762", "#b77b3e", "#351b0c"] },
    { label: "青玉", value: "jade", colors: ["#b9d4ba", "#7da781", "#183c30"] },
    { label: "夜色", value: "dark", colors: ["#303843", "#1e252e", "#d3c3a4"] },
    { label: "宣纸", value: "parchment", colors: ["#ead29a", "#c39152", "#57310f"] },
    { label: "胡桃木", value: "walnut", colors: ["#8e5a30", "#4e2e1a", "#f1d8a4"] },
    { label: "青花瓷", value: "porcelain", colors: ["#d8e6ef", "#7fa8bf", "#1f4f75"] },
    { label: "石砚", value: "slate", colors: ["#7f8581", "#4f5654", "#181f1e"] },
    { label: "水晶", value: "crystal", colors: ["#fbfeff", "#c9f0fb", "#2c8db5"] },
    { label: "标准 PNG", value: "custom-png", colors: ["#f8fafc", "#d1d5db", "#374151"] },
  ];

function ThemePreview({
  colors,
  imageUrl,
}: {
  colors: [string, string, string];
  imageUrl?: string;
}) {
  return (
    <Box
      style={{
        width: 64,
        height: 32,
        flexShrink: 0,
        border: `2px solid ${colors[2]}`,
        background: imageUrl
          ? `center / cover no-repeat url("${imageUrl}")`
          : `linear-gradient(90deg, ${colors[0]}, ${colors[1]})`,
        position: "relative",
      }}
    >
      {!imageUrl && (
        <Box
          style={{
            position: "absolute",
            left: "14%",
            right: "14%",
            top: "25%",
            bottom: "25%",
            borderTop: `1px solid ${colors[2]}`,
            borderBottom: `1px solid ${colors[2]}`,
          }}
        />
      )}
    </Box>
  );
}

export default function BoardSelect() {
  const [board, setBoard] = useAtom(boardImageAtom);
  const [customBoardDirectory, setCustomBoardDirectory] = useAtom(customBoardDirectoryAtom);
  const [customBoardImage, setCustomBoardImage] = useAtom(customBoardImageAtom);
  const [customBoardCalibration, setCustomBoardCalibration] = useAtom(customBoardCalibrationAtom);
  const [customBoards, setCustomBoards] = useState<CustomBoardImage[]>([]);
  const [loadingCustomBoards, setLoadingCustomBoards] = useState(false);
  const selected = boardThemes.find((item) => item.value === board) ?? boardThemes[0];
  const selectedCustomBoard = customBoards.find((item) => item.path === customBoardImage);
  const selectedCustomBoardUrl = customBoardImage
    ? (selectedCustomBoard?.url ?? customBoardImageUrl(customBoardImage))
    : undefined;
  const customBoardOptions = useMemo(() => {
    const options = customBoards.map((item) => ({ label: item.name, value: item.path }));
    if (customBoardImage && !options.some((item) => item.value === customBoardImage)) {
      options.unshift({
        label: customBoardDisplayName(customBoardImage),
        value: customBoardImage,
      });
    }
    return options;
  }, [customBoards, customBoardImage]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!customBoardDirectory) {
        setCustomBoards([]);
        return;
      }

      setLoadingCustomBoards(true);
      try {
        const images = await loadCustomBoardImages(customBoardDirectory);
        if (!cancelled) setCustomBoards(images);
      } catch {
        if (!cancelled) setCustomBoards([]);
      } finally {
        if (!cancelled) setLoadingCustomBoards(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customBoardDirectory]);

  async function loadCustomBoardDirectory(dir: string, activate: boolean) {
    setLoadingCustomBoards(true);
    try {
      const images = await loadCustomBoardImages(dir);
      setCustomBoards(images);
      if (images.length === 0) {
        notifications.show({
          color: "yellow",
          title: "未找到标准 PNG 棋盘",
          message: "该文件夹中没有 PNG 文件。",
        });
        return;
      }

      const hasSelectedImage = images.some((image) => image.path === customBoardImage);
      if (activate || !customBoardImage || !hasSelectedImage) {
        setCustomBoardImage(images[0].path);
      }
      if (activate) setBoard("custom-png");
    } catch {
      notifications.show({
        color: "red",
        title: "无法读取标准 PNG 棋盘",
        message: "请确认选择的文件夹可读取。",
      });
    } finally {
      setLoadingCustomBoards(false);
    }
  }

  async function chooseCustomBoardDirectory() {
    const selectedDir = await open({ multiple: false, directory: true });
    if (!selectedDir || typeof selectedDir !== "string") return;

    setCustomBoardDirectory(selectedDir);
    await loadCustomBoardDirectory(selectedDir, true);
  }

  function updateCustomBoardCalibration(next: Partial<CustomBoardCalibration>) {
    setCustomBoardCalibration((current) => ({ ...current, ...next }));
  }

  return (
    <Stack gap="xs" w="19.5rem">
      <Select
        allowDeselect={false}
        w="13rem"
        data={boardThemes.map((item) => ({
          value: item.value,
          label: item.label,
        }))}
        value={selected.value}
        onChange={(value) => {
          if (!value) return;
          if (value === "custom-png") {
            if (customBoardImage) {
              setBoard("custom-png");
            } else {
              void chooseCustomBoardDirectory();
            }
            return;
          }
          setBoard(value as XiangqiBoardTheme);
        }}
        renderOption={({ option }) => {
          const item = boardThemes.find((theme) => theme.value === option.value)!;
          const imageUrl = item.value === "custom-png" ? selectedCustomBoardUrl : undefined;
          return (
            <Group wrap="nowrap">
              <ThemePreview colors={item.colors} imageUrl={imageUrl} />
              <Text fz="sm" fw={500}>
                {item.label}
              </Text>
            </Group>
          );
        }}
      />
      {board === "custom-png" && (
        <Stack gap={4}>
          <Group wrap="nowrap" gap="xs">
            <Select
              allowDeselect={false}
              flex={1}
              data={customBoardOptions}
              value={customBoardImage || null}
              placeholder={loadingCustomBoards ? "正在扫描 PNG" : "选择 PNG"}
              disabled={loadingCustomBoards || customBoardOptions.length === 0}
              onChange={(value) => {
                if (!value) return;
                setCustomBoardImage(value);
                setBoard("custom-png");
              }}
            />
            <Button
              size="xs"
              variant="light"
              leftSection={<IconFolderOpen size="1rem" />}
              onClick={() => void chooseCustomBoardDirectory()}
              disabled={loadingCustomBoards}
            >
              文件夹
            </Button>
            <Tooltip label="刷新">
              <ActionIcon
                variant="default"
                aria-label="刷新标准 PNG 棋盘"
                disabled={!customBoardDirectory || loadingCustomBoards}
                onClick={() => void loadCustomBoardDirectory(customBoardDirectory, false)}
              >
                <IconRefresh size="1rem" />
              </ActionIcon>
            </Tooltip>
          </Group>
          {customBoardDirectory && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {customBoardDirectory}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            PNG 棋盘按图像中心对齐，预设尺寸 767x842，棋子间距 68；其它尺寸按高度等比例缩放。
          </Text>
          <Group justify="space-between" align="center" wrap="nowrap">
            <Text size="xs" fw={600}>
              棋盘校准
            </Text>
            <Tooltip label="恢复默认">
              <ActionIcon
                variant="subtle"
                aria-label="恢复默认棋盘校准"
                onClick={() => setCustomBoardCalibration(DEFAULT_CUSTOM_BOARD_CALIBRATION)}
              >
                <IconRestore size="1rem" />
              </ActionIcon>
            </Tooltip>
          </Group>
          <SegmentedControl
            size="xs"
            value={customBoardCalibration.mode}
            onChange={(value) =>
              updateCustomBoardCalibration({
                mode: value as CustomBoardCalibration["mode"],
              })
            }
            data={[
              { label: "标准", value: "standard" },
              { label: "比例", value: "scale" },
              { label: "手动", value: "manual" },
            ]}
          />
          {customBoardCalibration.mode === "scale" && (
            <NumberInput
              size="xs"
              label="比例"
              suffix="%"
              min={10}
              max={500}
              step={1}
              value={customBoardCalibration.scale}
              onChange={(value) =>
                updateCustomBoardCalibration({
                  scale: numberValue(value, DEFAULT_CUSTOM_BOARD_CALIBRATION.scale),
                })
              }
            />
          )}
          {customBoardCalibration.mode === "manual" && (
            <SimpleGrid cols={3} spacing="xs">
              <NumberInput
                size="xs"
                label="originX"
                min={-10000}
                max={10000}
                step={0.5}
                decimalScale={2}
                value={customBoardCalibration.originX}
                onChange={(value) =>
                  updateCustomBoardCalibration({
                    originX: numberValue(value, DEFAULT_CUSTOM_BOARD_CALIBRATION.originX),
                  })
                }
              />
              <NumberInput
                size="xs"
                label="originY"
                min={-10000}
                max={10000}
                step={0.5}
                decimalScale={2}
                value={customBoardCalibration.originY}
                onChange={(value) =>
                  updateCustomBoardCalibration({
                    originY: numberValue(value, DEFAULT_CUSTOM_BOARD_CALIBRATION.originY),
                  })
                }
              />
              <NumberInput
                size="xs"
                label="cellSize"
                min={1}
                max={10000}
                step={0.5}
                decimalScale={2}
                value={customBoardCalibration.cellSize}
                onChange={(value) =>
                  updateCustomBoardCalibration({
                    cellSize: numberValue(value, DEFAULT_CUSTOM_BOARD_CALIBRATION.cellSize),
                  })
                }
              />
            </SimpleGrid>
          )}
        </Stack>
      )}
    </Stack>
  );
}

function numberValue(value: string | number, fallback: number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
