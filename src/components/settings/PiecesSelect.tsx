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
import { useTranslation } from "react-i18next";
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

const pieceStyles: { value: XiangqiPieceStyle }[] = [
  { value: "classic" },
  { value: "seal" },
  { value: "plain" },
  { value: "paper" },
  { value: "jade" },
  { value: "flat" },
  { value: "porcelain" },
  { value: "lacquer" },
  { value: "stone" },
  { value: "bamboo" },
  { value: "crystal" },
  { value: "custom-svg" },
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
  const { t } = useTranslation();
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
  const [customPieceReloadToken, setCustomPieceReloadToken] = useState(0);
  const selected = pieceStyles.find((item) => item.value === pieceSet) ?? pieceStyles[0];
  const pieceStyleOptions = pieceStyles.map((item) => ({
    ...item,
    label: t(`Settings.Pieces.Style.${item.value}`),
  }));
  const supportsInnerRing = xiangqiPieceStyleHasInnerRing(selected.value);
  const isCustomSvg = selected.value === "custom-svg";
  const customPieceTheme = useCustomXiangqiPieces(
    isCustomSvg,
    customPieceDirectory || undefined,
    customPieceReloadToken,
  );
  const customPiecePathLabel =
    customPieceDirectory || customPieceTheme.dir || t("Settings.Pieces.CustomSvg.DefaultPath");
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
      const theme = await loadCustomXiangqiPieceTheme(dir || undefined, { forceReload: true });
      setCustomPieceReloadToken((token) => token + 1);
      if (theme.missing.length > 0) {
        setCustomPieceThemeConfirmed(false);
        notifications.show({
          color: "red",
          title: t("Settings.Pieces.CustomSvg.Incomplete"),
          message: t("Settings.Pieces.CustomSvg.Incomplete.Desc", {
            dirs: theme.checkedDirs.join("; "),
            files: theme.missing.join(", "),
          }),
        });
        return false;
      }

      setCustomPieceThemeConfirmed(true);
      notifications.show({
        color: "green",
        title: t("Settings.Pieces.CustomSvg.Enabled"),
        message: theme.dir,
      });
      return true;
    } catch {
      setCustomPieceThemeConfirmed(false);
      notifications.show({
        color: "red",
        title: t("Settings.Pieces.CustomSvg.ReadFailed"),
        message: t("Settings.Pieces.CustomSvg.ReadFailed.Desc"),
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
        title: t("Settings.Pieces.CustomSvg.OpenFailed"),
        message: t("Settings.Pieces.CustomSvg.OpenFailed.Desc"),
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
          data={pieceStyleOptions}
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
            {t("Settings.Pieces.TextSize")}
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
            label={t("Settings.Pieces.InnerRing")}
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
                {t("Settings.Pieces.InnerRingSize")}
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
              {t("Settings.Pieces.CustomSvg.ChooseFolder")}
            </Button>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconSettings size="1rem" />}
              onClick={() => void openCustomPieceDirectory()}
            >
              {t("Common.Open")}
            </Button>
            <Tooltip label={t("Settings.Pieces.CustomSvg.Recheck")}>
              <ActionIcon
                variant="default"
                aria-label={t("Settings.Pieces.CustomSvg.Recheck")}
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
                ? t("Settings.Pieces.CustomSvg.Checking")
                : t("Settings.Pieces.CustomSvg.MissingFiles", {
                    files: customPieceTheme.missing.join(", "),
                  })}
            </Text>
          ) : (
            <Text size="xs" c={customPieceThemeConfirmed ? "green" : "dimmed"}>
              {customPieceThemeConfirmed
                ? t("Settings.Pieces.CustomSvg.Enabled")
                : t("Settings.Pieces.CustomSvg.Ready")}
            </Text>
          )}
          <Stack gap={4}>
            <Text size="sm" fw={700}>
              {t("Settings.Pieces.CustomSvg.Size", { scale: clampedCustomPieceScale })}
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
            {t("Settings.Pieces.CustomSvg.FilesDesc", {
              files: Object.values(CUSTOM_PIECE_FILES).join(", "),
            })}
          </Text>
        </Stack>
      )}
    </Stack>
  );
}
