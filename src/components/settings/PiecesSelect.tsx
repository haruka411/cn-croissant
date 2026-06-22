import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Group,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconFolderOpen, IconRefresh, IconSettings } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { useAtom } from "jotai";
import { useState, type CSSProperties } from "react";
import {
  customPieceDirectoryAtom,
  customPieceScaleAtom,
  customPieceThemeConfirmedAtom,
  pieceSetAtom,
  type XiangqiPieceStyle,
  xiangqiPieceInnerScaleAtom,
  xiangqiPieceTextScaleAtom,
  xiangqiPieceInnerRingVisibleAtom,
} from "@/state/atoms";
import {
  XIANGQI_PIECE_INNER_SCALE_MAX,
  XIANGQI_PIECE_INNER_SCALE_MIN,
  XIANGQI_PIECE_TEXT_SCALE_MAX,
  XIANGQI_PIECE_TEXT_SCALE_MIN,
  xiangqiPieceStyleHasInnerRing,
} from "@/xiangqi/pieceStyleOptions";
import {
  CUSTOM_PIECE_FILES,
  type CustomPieceUrls,
  loadCustomXiangqiPieceTheme,
  openCustomXiangqiPieceFolder,
  useCustomXiangqiPieces,
} from "@/xiangqi/customPieceTheme";
import boardClasses from "@/xiangqi/XiangqiBoard.module.css";

const CUSTOM_PIECE_SCALE_MIN = 80;
const CUSTOM_PIECE_SCALE_MAX = 120;

const pieceStyles: { label: string; value: XiangqiPieceStyle }[] = [
  { label: "经典", value: "classic" },
  { label: "篆印", value: "seal" },
  { label: "素面", value: "plain" },
  { label: "纸纹", value: "paper" },
  { label: "玉石", value: "jade" },
  { label: "扁平", value: "flat" },
  { label: "青花瓷", value: "porcelain" },
  { label: "漆器", value: "lacquer" },
  { label: "石纹", value: "stone" },
  { label: "竹纹", value: "bamboo" },
  { label: "水晶", value: "crystal" },
  { label: "自定义 SVG", value: "custom-svg" },
];

function PiecePreview({
  value,
  textScale,
  innerScale,
  innerRingVisible,
  customPieceUrls,
  customPieceScale,
}: {
  value: XiangqiPieceStyle;
  textScale: number;
  innerScale: number;
  innerRingVisible: boolean;
  customPieceUrls?: CustomPieceUrls;
  customPieceScale: number;
}) {
  const clampedTextScale = Math.max(
    XIANGQI_PIECE_TEXT_SCALE_MIN,
    Math.min(textScale, XIANGQI_PIECE_TEXT_SCALE_MAX),
  );
  const clampedInnerScale = Math.max(
    XIANGQI_PIECE_INNER_SCALE_MIN,
    Math.min(innerScale, XIANGQI_PIECE_INNER_SCALE_MAX),
  );
  const isCustomSvg = value === "custom-svg";
  const showInnerRing = innerRingVisible && xiangqiPieceStyleHasInnerRing(value);
  const clampedCustomPieceScale = Math.max(
    CUSTOM_PIECE_SCALE_MIN,
    Math.min(customPieceScale, CUSTOM_PIECE_SCALE_MAX),
  );
  const scopeStyle = {
    "--piece-text-scale": clampedTextScale / 100,
    "--piece-inner-size": `${clampedInnerScale}%`,
    "--piece-inner-inset": `${(100 - clampedInnerScale) / 2}%`,
    "--custom-piece-size": `${clampedCustomPieceScale}%`,
  } as CSSProperties;
  const previewPieceStyle = {
    width: "3.3rem",
    position: "relative",
    transform: "none",
    left: "auto",
    top: "auto",
    cursor: "default",
    fontSize: `${(clampedTextScale / 100) * 1.05}rem`,
  } as CSSProperties;

  return (
    <Flex
      className={boardClasses.pieceSurface}
      data-piece-style={value}
      data-piece-inner-ring={showInnerRing ? "show" : "hide"}
      style={scopeStyle}
      gap={10}
    >
      <Box className={clsx(boardClasses.piece, boardClasses.pieceRed)} style={previewPieceStyle}>
        {isCustomSvg && customPieceUrls?.["red-king"] ? (
          <Box
            component="img"
            src={customPieceUrls["red-king"]}
            className={boardClasses.customPieceImage}
            alt=""
          />
        ) : !isCustomSvg ? (
          <Box component="span" className={boardClasses.pieceText}>
            帅
          </Box>
        ) : null}
      </Box>
      <Box className={clsx(boardClasses.piece, boardClasses.pieceBlack)} style={previewPieceStyle}>
        {isCustomSvg && customPieceUrls?.["black-king"] ? (
          <Box
            component="img"
            src={customPieceUrls["black-king"]}
            className={boardClasses.customPieceImage}
            alt=""
          />
        ) : !isCustomSvg ? (
          <Box component="span" className={boardClasses.pieceText}>
            将
          </Box>
        ) : null}
      </Box>
    </Flex>
  );
}

export default function PiecesSelect() {
  const [pieceSet, setPieceSet] = useAtom(pieceSetAtom);
  const [customPieceDirectory, setCustomPieceDirectory] = useAtom(customPieceDirectoryAtom);
  const [customPieceScale, setCustomPieceScale] = useAtom(customPieceScaleAtom);
  const [customPieceThemeConfirmed, setCustomPieceThemeConfirmed] = useAtom(
    customPieceThemeConfirmedAtom,
  );
  const [textScale, setTextScale] = useAtom(xiangqiPieceTextScaleAtom);
  const [innerScale, setInnerScale] = useAtom(xiangqiPieceInnerScaleAtom);
  const [innerRingVisible, setInnerRingVisible] = useAtom(xiangqiPieceInnerRingVisibleAtom);
  const [checkingCustomPieces, setCheckingCustomPieces] = useState(false);
  const selected = pieceStyles.find((item) => item.value === pieceSet) ?? pieceStyles[0];
  const supportsInnerRing = xiangqiPieceStyleHasInnerRing(selected.value);
  const isCustomSvg = selected.value === "custom-svg";
  const customPieceTheme = useCustomXiangqiPieces(isCustomSvg, customPieceDirectory || undefined);
  const customPiecePathLabel =
    customPieceDirectory || customPieceTheme.dir || "未设置，默认搜索 custom-pieces 文件夹";
  const isInnerRingVisible = innerRingVisible[selected.value] ?? true;
  const clampedTextScale = Math.max(
    XIANGQI_PIECE_TEXT_SCALE_MIN,
    Math.min(textScale, XIANGQI_PIECE_TEXT_SCALE_MAX),
  );
  const clampedInnerScale = Math.max(
    XIANGQI_PIECE_INNER_SCALE_MIN,
    Math.min(innerScale, XIANGQI_PIECE_INNER_SCALE_MAX),
  );
  const clampedCustomPieceScale = Math.max(
    CUSTOM_PIECE_SCALE_MIN,
    Math.min(customPieceScale, CUSTOM_PIECE_SCALE_MAX),
  );

  async function checkCustomPieces(dir = customPieceDirectory) {
    setCheckingCustomPieces(true);
    try {
      const theme = await loadCustomXiangqiPieceTheme(dir || undefined);
      if (theme.missing.length > 0) {
        setCustomPieceThemeConfirmed(false);
        notifications.show({
          color: "red",
          title: "自定义 SVG 棋子不完整",
          message: `已检查：${theme.checkedDirs.join("；")}。请补齐文件：${theme.missing.join("、")}`,
        });
        return false;
      }

      setCustomPieceThemeConfirmed(true);
      notifications.show({
        color: "green",
        title: "自定义 SVG 棋子已启用",
        message: theme.dir,
      });
      return true;
    } catch {
      setCustomPieceThemeConfirmed(false);
      notifications.show({
        color: "red",
        title: "无法读取自定义 SVG 棋子",
        message: "请确认选择的文件夹可读取。",
      });
      return false;
    } finally {
      setCheckingCustomPieces(false);
    }
  }

  async function chooseCustomPieceDirectory() {
    const selectedDir = await open({ multiple: false, directory: true });
    if (!selectedDir || typeof selectedDir !== "string") return;

    setCustomPieceDirectory(selectedDir);
    setPieceSet("custom-svg");
    await checkCustomPieces(selectedDir);
  }

  async function openCustomPieceDirectory() {
    try {
      const dir = await openCustomXiangqiPieceFolder(customPieceDirectory || undefined);
      if (!customPieceDirectory) setCustomPieceDirectory(dir);
    } catch {
      notifications.show({
        color: "red",
        title: "无法打开自定义 SVG 文件夹",
        message: "请确认路径存在且可访问。",
      });
    }
  }

  return (
    <Stack gap="xs" w="19.5rem">
      <Group wrap="nowrap" gap="md">
        <PiecePreview
          value={selected.value}
          textScale={clampedTextScale}
          innerScale={clampedInnerScale}
          innerRingVisible={isInnerRingVisible}
          customPieceUrls={customPieceTheme.urls}
          customPieceScale={clampedCustomPieceScale}
        />
        <Select
          allowDeselect={false}
          w="10rem"
          data={pieceStyles}
          value={selected.value}
          disabled={checkingCustomPieces}
          onChange={async (value) => {
            if (!value) return;
            if (value !== "custom-svg") {
              setCustomPieceThemeConfirmed(false);
              setPieceSet(value as XiangqiPieceStyle);
              return;
            }

            setPieceSet("custom-svg");
            await checkCustomPieces();
          }}
        />
      </Group>
      {!isCustomSvg && (
        <Stack gap={4}>
          <Text size="sm" fw={700}>
            字体大小
          </Text>
          <Slider
            min={XIANGQI_PIECE_TEXT_SCALE_MIN}
            max={XIANGQI_PIECE_TEXT_SCALE_MAX}
            step={1}
            value={clampedTextScale}
            onChange={setTextScale}
          />
        </Stack>
      )}
      {!isCustomSvg && supportsInnerRing && (
        <>
          <Switch
            label="显示内圈"
            size="sm"
            checked={isInnerRingVisible}
            onChange={(event) =>
              setInnerRingVisible((current) => ({
                ...current,
                [selected.value]: event.currentTarget.checked,
              }))
            }
          />
          {isInnerRingVisible && (
            <Stack gap={4}>
              <Text size="sm" fw={700}>
                内圈大小
              </Text>
              <Slider
                min={XIANGQI_PIECE_INNER_SCALE_MIN}
                max={XIANGQI_PIECE_INNER_SCALE_MAX}
                step={1}
                value={clampedInnerScale}
                onChange={setInnerScale}
              />
            </Stack>
          )}
        </>
      )}
      {isCustomSvg && (
        <Stack gap={4}>
          <Group wrap="nowrap" gap="xs">
            <Button
              size="xs"
              variant="light"
              leftSection={<IconFolderOpen size="1rem" />}
              onClick={() => void chooseCustomPieceDirectory()}
              disabled={checkingCustomPieces}
            >
              选择文件夹
            </Button>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconSettings size="1rem" />}
              onClick={() => void openCustomPieceDirectory()}
            >
              打开
            </Button>
            <Tooltip label="重新检查">
              <ActionIcon
                variant="default"
                aria-label="重新检查自定义 SVG 棋子"
                loading={checkingCustomPieces || customPieceTheme.loading}
                onClick={() => void checkCustomPieces()}
              >
                <IconRefresh size="1rem" />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Tooltip label={customPiecePathLabel} disabled={!customPiecePathLabel}>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {customPiecePathLabel}
            </Text>
          </Tooltip>
          {customPieceTheme.missing.length > 0 ? (
            <Text size="xs" c={customPieceTheme.loading ? "dimmed" : "red"}>
              {customPieceTheme.loading
                ? "正在检查自定义 SVG 棋子..."
                : `缺少文件：${customPieceTheme.missing.join("、")}`}
            </Text>
          ) : (
            <Text size="xs" c={customPieceThemeConfirmed ? "green" : "dimmed"}>
              {customPieceThemeConfirmed ? "自定义 SVG 棋子已启用" : "文件完整，重新检查后启用"}
            </Text>
          )}
          <Stack gap={4}>
            <Text size="sm" fw={700}>
              SVG 大小：{clampedCustomPieceScale}%
            </Text>
            <Slider
              min={CUSTOM_PIECE_SCALE_MIN}
              max={CUSTOM_PIECE_SCALE_MAX}
              step={1}
              value={clampedCustomPieceScale}
              onChange={setCustomPieceScale}
              label={(value) => `${value}%`}
            />
          </Stack>
          <Text size="xs" c="dimmed">
            文件名：
            {Object.values(CUSTOM_PIECE_FILES).join("、")}。自定义 SVG
            棋子已自带文字，字体大小和内圈设置不适用。
          </Text>
        </Stack>
      )}
    </Stack>
  );
}
