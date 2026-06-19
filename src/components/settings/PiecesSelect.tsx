import { Box, Button, Flex, Group, Select, Slider, Stack, Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import clsx from "clsx";
import { useAtom } from "jotai";
import { useState, type CSSProperties } from "react";
import {
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
  loadCustomXiangqiPieceTheme,
  openCustomXiangqiPieceFolder,
} from "@/xiangqi/customPieceTheme";
import boardClasses from "@/xiangqi/XiangqiBoard.module.css";

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
}: {
  value: XiangqiPieceStyle;
  textScale: number;
  innerScale: number;
  innerRingVisible: boolean;
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
  const scopeStyle = {
    "--piece-text-scale": clampedTextScale / 100,
    "--piece-inner-size": `${clampedInnerScale}%`,
    "--piece-inner-inset": `${(100 - clampedInnerScale) / 2}%`,
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
        {!isCustomSvg && (
          <Box component="span" className={boardClasses.pieceText}>
            帅
          </Box>
        )}
      </Box>
      <Box className={clsx(boardClasses.piece, boardClasses.pieceBlack)} style={previewPieceStyle}>
        {!isCustomSvg && (
          <Box component="span" className={boardClasses.pieceText}>
            将
          </Box>
        )}
      </Box>
    </Flex>
  );
}

export default function PiecesSelect() {
  const [pieceSet, setPieceSet] = useAtom(pieceSetAtom);
  const [textScale, setTextScale] = useAtom(xiangqiPieceTextScaleAtom);
  const [innerScale, setInnerScale] = useAtom(xiangqiPieceInnerScaleAtom);
  const [innerRingVisible, setInnerRingVisible] = useAtom(xiangqiPieceInnerRingVisibleAtom);
  const [checkingCustomPieces, setCheckingCustomPieces] = useState(false);
  const selected = pieceStyles.find((item) => item.value === pieceSet) ?? pieceStyles[0];
  const supportsInnerRing = xiangqiPieceStyleHasInnerRing(selected.value);
  const isCustomSvg = selected.value === "custom-svg";
  const isInnerRingVisible = innerRingVisible[selected.value] ?? true;
  const clampedTextScale = Math.max(
    XIANGQI_PIECE_TEXT_SCALE_MIN,
    Math.min(textScale, XIANGQI_PIECE_TEXT_SCALE_MAX),
  );
  const clampedInnerScale = Math.max(
    XIANGQI_PIECE_INNER_SCALE_MIN,
    Math.min(innerScale, XIANGQI_PIECE_INNER_SCALE_MAX),
  );

  return (
    <Stack gap="xs" w="19.5rem">
      <Group wrap="nowrap" gap="md">
        <PiecePreview
          value={selected.value}
          textScale={clampedTextScale}
          innerScale={clampedInnerScale}
          innerRingVisible={isInnerRingVisible}
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
              setPieceSet(value as XiangqiPieceStyle);
              return;
            }

            setCheckingCustomPieces(true);
            try {
              const theme = await loadCustomXiangqiPieceTheme();
              if (theme.missing.length > 0) {
                notifications.show({
                  color: "red",
                  title: "自定义 SVG 棋子不完整",
                  message: `请补齐 ${theme.dir} 中的文件：${theme.missing.join("、")}`,
                });
                return;
              }
              setPieceSet("custom-svg");
            } catch {
              notifications.show({
                color: "red",
                title: "无法读取自定义 SVG 棋子",
                message: "请确认软件目录下 custom-pieces 文件夹可读写。",
              });
            } finally {
              setCheckingCustomPieces(false);
            }
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
          <Button size="xs" variant="light" onClick={() => void openCustomXiangqiPieceFolder()}>
            打开自定义 SVG 文件夹
          </Button>
          <Text size="xs" c="dimmed">
            SVG 必须放在软件目录的 custom-pieces 文件夹中。文件名：
            {Object.values(CUSTOM_PIECE_FILES).join("、")}。自定义 SVG
            棋子已自带文字，字体大小和内圈设置不适用。
          </Text>
        </Stack>
      )}
    </Stack>
  );
}
