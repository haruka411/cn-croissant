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
  customPngPieceDirectoryAtom,
  customPngPieceScaleAtom,
  customPngPieceThemeConfirmedAtom,
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
  CUSTOM_PNG_PIECE_FILES,
  type CustomPieceUrls,
  type CustomPieceFormat,
  loadCustomXiangqiPieceTheme,
  openCustomXiangqiPieceFolder,
  useCustomXiangqiPieces,
} from "@/xiangqi/customPieceTheme";
import boardClasses from "@/xiangqi/XiangqiBoard.module.css";

const CUSTOM_PIECE_SCALE_MIN = 70;
const CUSTOM_SVG_PIECE_SCALE_MAX = 200;
const CUSTOM_PNG_PIECE_SCALE_MAX = 200;

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
  { value: "custom-png" },
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
  const isCustomPiece = value === "custom-svg" || value === "custom-png";
  const showInnerRing = innerRingVisible && xiangqiPieceStyleHasInnerRing(value);
  const customPieceScaleMax =
    value === "custom-svg" ? CUSTOM_SVG_PIECE_SCALE_MAX : CUSTOM_PNG_PIECE_SCALE_MAX;
  const clampedCustomPieceScale = Math.max(
    CUSTOM_PIECE_SCALE_MIN,
    Math.min(customPieceScale, customPieceScaleMax),
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
        {isCustomPiece && customPieceUrls?.["red-king"] ? (
          <Box
            component="img"
            src={customPieceUrls["red-king"]}
            className={boardClasses.customPieceImage}
            alt=""
          />
        ) : !isCustomPiece ? (
          <Box component="span" className={boardClasses.pieceText}>
            帅
          </Box>
        ) : null}
      </Box>
      <Box className={clsx(boardClasses.piece, boardClasses.pieceBlack)} style={previewPieceStyle}>
        {isCustomPiece && customPieceUrls?.["black-king"] ? (
          <Box
            component="img"
            src={customPieceUrls["black-king"]}
            className={boardClasses.customPieceImage}
            alt=""
          />
        ) : !isCustomPiece ? (
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
  const [customPngPieceDirectory, setCustomPngPieceDirectory] = useAtom(
    customPngPieceDirectoryAtom,
  );
  const [customPngPieceScale, setCustomPngPieceScale] = useAtom(customPngPieceScaleAtom);
  const [customPngPieceThemeConfirmed, setCustomPngPieceThemeConfirmed] = useAtom(
    customPngPieceThemeConfirmedAtom,
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
  const isCustomPng = selected.value === "custom-png";
  const isCustomPiece = isCustomSvg || isCustomPng;
  const customFormat: CustomPieceFormat = isCustomPng ? "png" : "svg";
  const activeCustomPieceDirectory = isCustomPng ? customPngPieceDirectory : customPieceDirectory;
  const activeCustomPieceScale = isCustomPng ? customPngPieceScale : customPieceScale;
  const activeCustomPieceScaleMax = isCustomSvg
    ? CUSTOM_SVG_PIECE_SCALE_MAX
    : CUSTOM_PNG_PIECE_SCALE_MAX;
  const activeCustomPieceConfirmed = isCustomPng
    ? customPngPieceThemeConfirmed
    : customPieceThemeConfirmed;
  const customTranslationPrefix = isCustomPng
    ? "Settings.Pieces.CustomPng"
    : "Settings.Pieces.CustomSvg";
  const activeCustomPieceFiles = isCustomPng ? CUSTOM_PNG_PIECE_FILES : CUSTOM_PIECE_FILES;
  const customPieceTheme = useCustomXiangqiPieces(
    isCustomPiece,
    activeCustomPieceDirectory || undefined,
    customPieceReloadToken,
    customFormat,
  );
  const customPiecePathLabel =
    activeCustomPieceDirectory || customPieceTheme.dir || t(`${customTranslationPrefix}.DefaultPath`);
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
    Math.min(activeCustomPieceScale, activeCustomPieceScaleMax),
  );

  function setActiveCustomPieceConfirmed(value: boolean) {
    if (isCustomPng) {
      setCustomPngPieceThemeConfirmed(value);
    } else {
      setCustomPieceThemeConfirmed(value);
    }
  }

  function setActiveCustomPieceDirectory(value: string) {
    if (isCustomPng) {
      setCustomPngPieceDirectory(value);
    } else {
      setCustomPieceDirectory(value);
    }
  }

  function setActiveCustomPieceScale(value: number) {
    if (isCustomPng) {
      setCustomPngPieceScale(value);
    } else {
      setCustomPieceScale(value);
    }
  }

  async function checkCustomPieces(dir = activeCustomPieceDirectory) {
    setCheckingCustomPieces(true);
    try {
      const theme = await loadCustomXiangqiPieceTheme(dir || undefined, {
        forceReload: true,
        format: customFormat,
      });
      setCustomPieceReloadToken((token) => token + 1);
      if (theme.missing.length > 0) {
        setActiveCustomPieceConfirmed(false);
        notifications.show({
          color: "red",
          title: t(`${customTranslationPrefix}.Incomplete`),
          message: t(`${customTranslationPrefix}.Incomplete.Desc`, {
            dirs: theme.checkedDirs.join("; "),
            files: theme.missing.join(", "),
          }),
        });
        return false;
      }

      setActiveCustomPieceConfirmed(true);
      notifications.show({
        color: "green",
        title: t(`${customTranslationPrefix}.Enabled`),
        message: theme.dir,
      });
      return true;
    } catch {
      setActiveCustomPieceConfirmed(false);
      notifications.show({
        color: "red",
        title: t(`${customTranslationPrefix}.ReadFailed`),
        message: t(`${customTranslationPrefix}.ReadFailed.Desc`),
      });
      return false;
    } finally {
      setCheckingCustomPieces(false);
    }
  }

  async function chooseCustomPieceDirectory() {
    const selectedDir = await open({ multiple: false, directory: true });
    if (!selectedDir || typeof selectedDir !== "string") return;

    setActiveCustomPieceDirectory(selectedDir);
    setPieceSet(selected.value);
    await checkCustomPieces(selectedDir);
  }

  async function openCustomPieceDirectory() {
    try {
      const dir = await openCustomXiangqiPieceFolder(
        activeCustomPieceDirectory || undefined,
        customFormat,
      );
      if (!activeCustomPieceDirectory) setActiveCustomPieceDirectory(dir);
    } catch {
      notifications.show({
        color: "red",
        title: t(`${customTranslationPrefix}.OpenFailed`),
        message: t(`${customTranslationPrefix}.OpenFailed.Desc`),
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
            if (value !== "custom-svg" && value !== "custom-png") {
              setCustomPieceThemeConfirmed(false);
              setCustomPngPieceThemeConfirmed(false);
              setPieceSet(value as XiangqiPieceStyle);
              return;
            }

            setPieceSet(value as XiangqiPieceStyle);
            await checkCustomPieces();
          }}
        />
      </Group>
      {!isCustomPiece && (
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
      {!isCustomPiece && supportsInnerRing && (
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
      {isCustomPiece && (
        <Stack gap={4}>
          <Group wrap="nowrap" gap="xs">
            <Button
              size="xs"
              variant="light"
              leftSection={<IconFolderOpen size="1rem" />}
              onClick={() => void chooseCustomPieceDirectory()}
              disabled={checkingCustomPieces}
            >
              {t(`${customTranslationPrefix}.ChooseFolder`)}
            </Button>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconSettings size="1rem" />}
              onClick={() => void openCustomPieceDirectory()}
            >
              {t("Common.Open")}
            </Button>
            <Tooltip label={t(`${customTranslationPrefix}.Recheck`)}>
              <ActionIcon
                variant="default"
                aria-label={t(`${customTranslationPrefix}.Recheck`)}
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
                ? t(`${customTranslationPrefix}.Checking`)
                : t(`${customTranslationPrefix}.MissingFiles`, {
                    files: customPieceTheme.missing.join(", "),
                  })}
            </Text>
          ) : (
            <Text size="xs" c={activeCustomPieceConfirmed ? "green" : "dimmed"}>
              {activeCustomPieceConfirmed
                ? t(`${customTranslationPrefix}.Enabled`)
                : t(`${customTranslationPrefix}.Ready`)}
            </Text>
          )}
          <Stack gap={4}>
            <Text size="sm" fw={700}>
              {t(`${customTranslationPrefix}.Size`, { scale: clampedCustomPieceScale })}
            </Text>
            <Slider
              min={CUSTOM_PIECE_SCALE_MIN}
              max={activeCustomPieceScaleMax}
              step={1}
              value={clampedCustomPieceScale}
              onChange={setActiveCustomPieceScale}
              label={(value) => `${value}%`}
            />
          </Stack>
          <Text size="xs" c="dimmed">
            {t(`${customTranslationPrefix}.FilesDesc`, {
              files: Object.values(activeCustomPieceFiles).join(", "),
            })}
          </Text>
        </Stack>
      )}
    </Stack>
  );
}
