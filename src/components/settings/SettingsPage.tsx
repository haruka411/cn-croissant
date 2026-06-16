import {
  ActionIcon,
  Card,
  Group,
  ScrollArea,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import {
  IconBook,
  IconBrush,
  IconChess,
  IconFolder,
  IconKeyboard,
  IconMouse,
  IconReload,
  IconSearch,
  IconVolume,
} from "@tabler/icons-react";
import { useLoaderData } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { useAtom } from "jotai";
import { RESET } from "jotai/utils";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  autoSaveAtom,
  enableBoardScrollAtom,
  eraseDrawablesOnClickAtom,
  flipBoardAfterMoveAtom,
  materialDisplayAtom,
  moveHighlightAtom,
  moveInputAtom,
  moveMethodAtom,
  moveNotationTypeAtom,
  nativeBarAtom,
  practiceAutoDifficultyAtom,
  previewBoardOnHoverAtom,
  showArrowsAtom,
  showConsecutiveArrowsAtom,
  showCoordinatesAtom,
  showDestsAtom,
  showVariationArrowsAtom,
  snapArrowsAtom,
  spellCheckAtom,
  storedDatabasesDirAtom,
  storedDocumentDirAtom,
  storedEnginesDirAtom,
} from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import FileInput from "../common/FileInput";
import AppFontSelect from "./AppFontSelect";
import BoardSelect from "./BoardSelect";
import ColorControl from "./ColorControl";
import FontSizeSlider from "./FontSizeSlider";
import KeybindInput from "./KeybindInput";
import PiecesSelect from "./PiecesSelect";
import RepertoireMinGamesSetting from "./RepertoireMinGamesSetting";
import classes from "./SettingsPage.module.css";
import SettingsSwitch from "./SettingsSwitch";
import SoundSelect from "./SoundSelect";
import ThemeButton from "./ThemeButton";
import VolumeSlider from "./VolumeSlider";

type SettingCategory =
  | "board"
  | "inputs"
  | "appearance"
  | "sound"
  | "keybinds"
  | "directories"
  | "repertoire";

interface SettingItem {
  id: string;
  category: SettingCategory;
  title: string;
  description: string;
  keywords?: string[];
  render: () => React.ReactNode;
}

const categoryOrder: SettingCategory[] = [
  "board",
  "inputs",
  "appearance",
  "sound",
  "keybinds",
  "directories",
  "repertoire",
];

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xl" className={classes.item}>
      <div>
        <Text>{title}</Text>
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      </div>
      {children}
    </Group>
  );
}

export default function Page() {
  const { t, i18n } = useTranslation();
  const isChinese = i18n.language.startsWith("zh");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [keyMap, setKeyMap] = useAtom(keyMapAtom);
  const [isNative, setIsNative] = useAtom(nativeBarAtom);
  const {
    dirs: { documentDir, databasesDir: defaultDatabasesDir, enginesDir: defaultEnginesDir },
    version,
  } = useLoaderData({ from: "/settings" });
  let [filesDirectory, setFilesDirectory] = useAtom(storedDocumentDirAtom);
  filesDirectory = filesDirectory || documentDir;
  let [databasesDirectory, setDatabasesDirectory] = useAtom(storedDatabasesDirAtom);
  databasesDirectory = databasesDirectory || defaultDatabasesDir;
  let [enginesDirectory, setEnginesDirectory] = useAtom(storedEnginesDirAtom);
  enginesDirectory = enginesDirectory || defaultEnginesDir;

  const [moveMethod, setMoveMethod] = useAtom(moveMethodAtom);
  const [moveNotationType, setMoveNotationType] = useAtom(moveNotationTypeAtom);
  const [showCoordinates, setShowCoordinates] = useAtom(showCoordinatesAtom);
  const [materialDisplay, setMaterialDisplay] = useAtom(materialDisplayAtom);
  const [practiceAutoDifficulty, setPracticeAutoDifficulty] = useAtom(practiceAutoDifficultyAtom);

  const settings: SettingItem[] = useMemo(
    () => [
      {
        id: "piece-dest",
        category: "board",
        title: t("Settings.PieceDest"),
        description: t("Settings.PieceDest.Desc"),
        keywords: ["destination", "moves", "highlight"],
        render: () => <SettingsSwitch atom={showDestsAtom} />,
      },
      {
        id: "move-highlight",
        category: "board",
        title: t("Settings.MoveHighlight"),
        description: t("Settings.MoveHighlight.Desc"),
        keywords: ["highlight", "last move"],
        render: () => <SettingsSwitch atom={moveHighlightAtom} />,
      },
      {
        id: "arrows",
        category: "board",
        title: t("Settings.Arrows"),
        description: t("Settings.Arrows.Desc"),
        keywords: ["arrows", "analysis"],
        render: () => <SettingsSwitch atom={showArrowsAtom} />,
      },
      {
        id: "variation-arrows",
        category: "board",
        title: t("Settings.VariationArrows"),
        description: t("Settings.VariationArrows.Desc"),
        keywords: ["arrows", "variations", "alternative"],
        render: () => <SettingsSwitch atom={showVariationArrowsAtom} />,
      },
      {
        id: "move-notation",
        category: "board",
        title: t("Settings.MoveNotation"),
        description: t("Settings.MoveNotation.Desc"),
        keywords: ["notation", "pieces"],
        render: () => (
          <Select
            data={[
              { label: t("Settings.MoveNotation.Letters"), value: "letters" },
              { label: t("Settings.MoveNotation.Symbols"), value: "symbols" },
            ]}
            allowDeselect={false}
            value={moveNotationType}
            onChange={(val) => setMoveNotationType(val as "letters" | "symbols")}
          />
        ),
      },
      {
        id: "move-method",
        category: "board",
        title: t("Settings.MoveMethod"),
        description: t("Settings.MoveMethod.Desc"),
        keywords: ["drag", "click", "move", "pieces"],
        render: () => (
          <Select
            data={[
              { label: t("Settings.MoveMethod.Drag"), value: "drag" },
              { label: t("Settings.MoveMethod.Click"), value: "select" },
              { label: t("Settings.MoveMethod.Both"), value: "both" },
            ]}
            allowDeselect={false}
            value={moveMethod}
            onChange={(val) => setMoveMethod(val as "drag" | "select" | "both")}
          />
        ),
      },
      {
        id: "snap-arrows",
        category: "board",
        title: t("Settings.SnapArrows"),
        description: t("Settings.SnapArrows.Desc"),
        keywords: ["arrows", "snap"],
        render: () => <SettingsSwitch atom={snapArrowsAtom} />,
      },
      {
        id: "consecutive-arrows",
        category: "board",
        title: t("Settings.ConsecutiveArrows"),
        description: t("Settings.ConsecutiveArrows.Desc"),
        keywords: ["arrows", "consecutive"],
        render: () => <SettingsSwitch atom={showConsecutiveArrowsAtom} />,
      },
      {
        id: "erase-drawables",
        category: "board",
        title: t("Settings.EraseDrawablesOnClick"),
        description: t("Settings.EraseDrawablesOnClick.Desc"),
        keywords: ["erase", "drawables", "click", "arrows"],
        render: () => <SettingsSwitch atom={eraseDrawablesOnClickAtom} />,
      },
      {
        id: "coordinates",
        category: "board",
        title: t("Settings.Coordinates"),
        description: t("Settings.Coordinates.Desc"),
        keywords: ["coordinates", "files", "ranks"],
        render: () => (
          <Select
            data={[
              { label: t("Settings.Coordinates.None"), value: "no" },
              { label: t("Settings.Coordinates.Edge"), value: "edge" },
              { label: t("Settings.Coordinates.All"), value: "all" },
            ]}
            allowDeselect={false}
            value={showCoordinates}
            onChange={(val) => setShowCoordinates(val as "no" | "edge" | "all")}
          />
        ),
      },
      {
        id: "auto-save",
        category: "board",
        title: t("Settings.AutoSave"),
        description: t("Settings.AutoSave.Desc"),
        keywords: ["save", "auto"],
        render: () => <SettingsSwitch atom={autoSaveAtom} />,
      },
      {
        id: "preview-board",
        category: "board",
        title: t("Settings.PreviewBoard"),
        description: t("Settings.PreviewBoard.Desc"),
        keywords: ["preview", "hover"],
        render: () => <SettingsSwitch atom={previewBoardOnHoverAtom} />,
      },
      {
        id: "flip-board-after-move",
        category: "board",
        title: t("Settings.FlipBoardAfterMove"),
        description: t("Settings.FlipBoardAfterMove.Desc"),
        keywords: ["flip", "board", "move"],
        render: () => <SettingsSwitch atom={flipBoardAfterMoveAtom} />,
      },
      {
        id: "scroll-moves",
        category: "board",
        title: t("Settings.ScrollThroughMoves"),
        description: t("Settings.ScrollThroughMoves.Desc"),
        keywords: ["scroll", "moves", "wheel"],
        render: () => <SettingsSwitch atom={enableBoardScrollAtom} />,
      },
      {
        id: "material-display",
        category: "board",
        title: t("Settings.MaterialDisplay"),
        description: t("Settings.MaterialDisplay.Desc"),
        keywords: ["material", "captured", "pieces", "difference"],
        render: () => (
          <Select
            data={[
              { label: t("Settings.MaterialDisplay.Diff"), value: "diff" },
              { label: t("Settings.MaterialDisplay.All"), value: "all" },
            ]}
            allowDeselect={false}
            value={materialDisplay}
            onChange={(val) => setMaterialDisplay(val as "diff" | "all")}
          />
        ),
      },
      {
        id: "text-input",
        category: "inputs",
        title: t("Settings.Inputs.TextInput"),
        description: t("Settings.Inputs.TextInput.Desc"),
        keywords: ["text", "input", "type"],
        render: () => <SettingsSwitch atom={moveInputAtom} />,
      },
      {
        id: "spell-check",
        category: "inputs",
        title: t("Settings.Inputs.SpellCheck"),
        description: t("Settings.Inputs.SpellCheck.Desc"),
        keywords: ["spell", "check", "grammar"],
        render: () => <SettingsSwitch atom={spellCheckAtom} />,
      },
      {
        id: "theme",
        category: "appearance",
        title: t("Settings.Appearance.Theme"),
        description: t("Settings.Appearance.Theme.Desc"),
        keywords: ["theme", "dark", "light", "color"],
        render: () => <ThemeButton />,
      },
      {
        id: "language",
        category: "appearance",
        title: `${t("Settings.Appearance.Language")}（Language）`,
        description: t("Settings.Appearance.Language.Desc"),
        keywords: ["language", "locale", "translation"],
        render: () => (
          <Select
            allowDeselect={false}
            data={[
              { value: "zh_CN", label: "简体中文" },
              { value: "zh_TW", label: "繁體中文" },
              { value: "en_US", label: "English" },
            ]}
            value={i18n.language.replace("-", "_")}
            onChange={(val) => i18n.changeLanguage(val?.replace("_", "-") || "en-US")}
          />
        ),
      },
      ...(import.meta.env.VITE_PLATFORM === "win32" || import.meta.env.VITE_PLATFORM === "linux"
        ? [
            {
              id: "title-bar",
              category: "appearance" as SettingCategory,
              title: t("Settings.Appearance.TitleBar"),
              description: t("Settings.Appearance.TitleBar.Desc"),
              keywords: ["title", "bar", "native", "custom"],
              render: () => (
                <Select
                  allowDeselect={false}
                  data={[
                    { value: "Native", label: t("Settings.Appearance.TitleBar.Native") },
                    { value: "Custom", label: t("Settings.Appearance.TitleBar.Custom") },
                  ]}
                  value={isNative ? "Native" : "Custom"}
                  onChange={(val) => setIsNative(val === "Native")}
                />
              ),
            },
          ]
        : []),
      {
        id: "font-size",
        category: "appearance",
        title: t("Settings.Appearance.FontSize"),
        description: t("Settings.Appearance.FontSize.Desc"),
        keywords: ["font", "size", "text"],
        render: () => <FontSizeSlider />,
      },
      {
        id: "app-font",
        category: "appearance",
        title: t("Settings.Appearance.AppFont"),
        description: t("Settings.Appearance.AppFont.Desc"),
        keywords: ["font", "family", "font family", "ui"],
        render: () => <AppFontSelect />,
      },
      {
        id: "piece-set",
        category: "appearance",
        title: isChinese ? "棋子样式" : "Xiangqi Pieces",
        description: isChinese ? "选择中国象棋棋子的显示样式" : "Choose the Xiangqi piece style",
        keywords: ["piece", "xiangqi", "style"],
        render: () => <PiecesSelect />,
      },
      {
        id: "board-image",
        category: "appearance",
        title: isChinese ? "棋盘主题" : "Xiangqi Board",
        description: isChinese ? "选择中国象棋棋盘主题" : "Choose the Xiangqi board theme",
        keywords: ["board", "xiangqi", "theme"],
        render: () => <BoardSelect />,
      },
      {
        id: "accent-color",
        category: "appearance",
        title: t("Settings.Appearance.AccentColor"),
        description: t("Settings.Appearance.AccentColor.Desc"),
        keywords: ["accent", "color", "primary"],
        render: () => (
          <div style={{ width: 200 }}>
            <ColorControl />
          </div>
        ),
      },
      {
        id: "volume",
        category: "sound",
        title: t("Settings.Sound.Volume"),
        description: t("Settings.Sound.Volume.Desc"),
        keywords: ["volume", "audio", "loud"],
        render: () => <VolumeSlider />,
      },
      {
        id: "sound-collection",
        category: "sound",
        title: t("Settings.Sound.Collection"),
        description: t("Settings.Sound.Collection.Desc"),
        keywords: ["sound", "collection", "audio", "effects"],
        render: () => <SoundSelect />,
      },
      {
        id: "files-directory",
        category: "directories",
        title: t("Settings.Directories.Files"),
        description: t("Settings.Directories.Files.Desc"),
        keywords: ["files", "directory", "folder", "path"],
        render: () => (
          <FileInput
            onClick={async () => {
              const selected = await open({ multiple: false, directory: true });
              if (!selected || typeof selected !== "string") return;
              setFilesDirectory(selected);
            }}
            filename={filesDirectory || null}
          />
        ),
      },
      {
        id: "databases-directory",
        category: "directories",
        title: t("Settings.Directories.Databases"),
        description: t("Settings.Directories.Databases.Desc"),
        keywords: ["databases", "directory", "folder", "path"],
        render: () => (
          <FileInput
            onClick={async () => {
              const selected = await open({ multiple: false, directory: true });
              if (!selected || typeof selected !== "string") return;
              setDatabasesDirectory(selected);
            }}
            filename={databasesDirectory || null}
          />
        ),
      },
      {
        id: "engines-directory",
        category: "directories",
        title: t("Settings.Directories.Engines"),
        description: t("Settings.Directories.Engines.Desc"),
        keywords: ["engines", "directory", "folder", "path"],
        render: () => (
          <FileInput
            onClick={async () => {
              const selected = await open({ multiple: false, directory: true });
              if (!selected || typeof selected !== "string") return;
              setEnginesDirectory(selected);
            }}
            filename={enginesDirectory || null}
          />
        ),
      },
      {
        id: "repertoire-depth",
        category: "repertoire",
        title: t("Settings.Repertoire.Depth"),
        description: t("Settings.Repertoire.Depth.Desc"),
        keywords: ["repertoire", "depth", "games", "min"],
        render: () => <RepertoireMinGamesSetting />,
      },
      {
        id: "repertoire-auto-difficulty",
        category: "repertoire",
        title: t("Settings.Repertoire.AutoDifficulty"),
        description: t("Settings.Repertoire.AutoDifficulty.Desc"),
        keywords: ["repertoire", "auto", "difficulty", "select"],
        render: () => (
          <Select
            allowDeselect={false}
            data={[
              { label: t("Settings.Repertoire.AutoDifficulty.None"), value: "none" },
              { label: t("Board.Practice.Again"), value: "1" },
              { label: t("Board.Practice.Hard"), value: "2" },
              { label: t("Board.Practice.Good"), value: "3" },
              { label: t("Board.Practice.Easy"), value: "4" },
            ]}
            value={practiceAutoDifficulty}
            onChange={(val) => setPracticeAutoDifficulty(val as "none" | "1" | "2" | "3" | "4")}
          />
        ),
      },
    ],
    [
      t,
      i18n,
      isChinese,
      moveNotationType,
      moveMethod,
      isNative,
      showCoordinates,
      materialDisplay,
      filesDirectory,
      databasesDirectory,
      enginesDirectory,
      setMoveNotationType,
      setMoveMethod,
      setIsNative,
      setFilesDirectory,
      setDatabasesDirectory,
      setEnginesDirectory,
      setShowCoordinates,
      setMaterialDisplay,
      practiceAutoDifficulty,
      setPracticeAutoDifficulty,
    ],
  );

  useHotkeys([["mod+f", () => searchInputRef.current?.focus()]]);

  const categoryInfo: Record<
    SettingCategory,
    { title: string; description: string; icon: React.ReactNode }
  > = useMemo(
    () => ({
      board: {
        title: t("Settings.Board"),
        description: t("Settings.Board.Desc"),
        icon: <IconChess size="1rem" />,
      },
      inputs: {
        title: t("Settings.Inputs"),
        description: t("Settings.Inputs.Desc"),
        icon: <IconMouse size="1rem" />,
      },
      appearance: {
        title: t("Settings.Appearance"),
        description: t("Settings.Appearance.Desc"),
        icon: <IconBrush size="1rem" />,
      },
      sound: {
        title: t("Settings.Sound"),
        description: t("Settings.Sound.Desc"),
        icon: <IconVolume size="1rem" />,
      },
      keybinds: {
        title: t("Settings.Keybinds"),
        description: t("Settings.Keybinds.Desc"),
        icon: <IconKeyboard size="1rem" />,
      },
      directories: {
        title: t("Settings.Directories"),
        description: t("Settings.Directories.Desc"),
        icon: <IconFolder size="1rem" />,
      },
      repertoire: {
        title: t("Settings.Repertoire"),
        description: t("Settings.Repertoire.Desc"),
        icon: <IconBook size="1rem" />,
      },
    }),
    [t],
  );

  const filteredSettings = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const query = searchQuery.toLowerCase();
    return settings.filter(
      (setting) =>
        setting.title.toLowerCase().includes(query) ||
        setting.description.toLowerCase().includes(query) ||
        categoryInfo[setting.category].title.toLowerCase().includes(query) ||
        setting.id.toLowerCase().includes(query) ||
        setting.keywords?.some((kw) => kw.toLowerCase().includes(query)),
    );
  }, [searchQuery, settings, categoryInfo]);

  const renderSearchResults = () => {
    if (!filteredSettings) return null;

    if (filteredSettings.length === 0) {
      return (
        <Card withBorder p="lg" className={classes.card} w="100%">
          <Text c="dimmed" ta="center">
            No settings found for "{searchQuery}"
          </Text>
        </Card>
      );
    }

    const groupedSettings = filteredSettings.reduce(
      (acc, setting) => {
        if (!acc[setting.category]) acc[setting.category] = [];
        acc[setting.category].push(setting);
        return acc;
      },
      {} as Record<SettingCategory, SettingItem[]>,
    );

    return (
      <Card withBorder p="lg" className={classes.card} w="100%">
        {categoryOrder
          .filter((category) => groupedSettings[category]?.length)
          .map((category) => (
            <div key={category}>
              <Group gap="xs" mt="md" mb="xs">
                {categoryInfo[category].icon}
                <Text fw={600} size="sm" c="dimmed">
                  {categoryInfo[category].title}
                </Text>
              </Group>
              {groupedSettings[category].map((setting) => (
                <SettingRow
                  key={setting.id}
                  title={setting.title}
                  description={setting.description}
                >
                  {setting.render()}
                </SettingRow>
              ))}
            </div>
          ))}
      </Card>
    );
  };

  const renderCategorySettings = (category: SettingCategory) =>
    settings
      .filter((setting) => setting.category === category)
      .map((setting) => (
        <SettingRow key={setting.id} title={setting.title} description={setting.description}>
          {setting.render()}
        </SettingRow>
      ));

  return (
    <Stack h="100%" gap={0}>
      <Group px="md" pt="md" pb="sm">
        <TextInput
          ref={searchInputRef}
          placeholder={t("Common.Search")}
          leftSection={<IconSearch size="1rem" />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "f" && (e.metaKey || e.ctrlKey)) e.preventDefault();
            if (e.key === "Escape") {
              setSearchQuery("");
              searchInputRef.current?.blur();
            }
          }}
          style={{ flex: 1, maxWidth: 400 }}
        />
      </Group>
      {filteredSettings ? (
        <ScrollArea flex={1} px="md">
          {renderSearchResults()}
          <Text size="sm" c="dimmed" ta="right" py="md">
            Cn Croissant v{version}
          </Text>
        </ScrollArea>
      ) : (
        <Tabs
          defaultValue="board"
          orientation="vertical"
          flex={1}
          style={{ overflow: "hidden" }}
          styles={{ tabLabel: { textAlign: "left" } }}
        >
          <Tabs.List h="100%">
            {categoryOrder.map((category) => (
              <Tabs.Tab key={category} value={category} leftSection={categoryInfo[category].icon}>
                {categoryInfo[category].title}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <Stack flex={1} px="md">
            <ScrollArea>
              <Card withBorder p="lg" className={classes.card} w="100%">
                {categoryOrder.map((category) => (
                  <Tabs.Panel key={category} value={category}>
                    {category === "keybinds" ? (
                      <>
                        <Group>
                          <Text size="lg" fw={500} className={classes.title}>
                            {categoryInfo[category].title}
                          </Text>
                          <Tooltip label={t("Common.Reset")}>
                            <ActionIcon onClick={() => setKeyMap(RESET)}>
                              <IconReload size="1rem" />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                        <Text size="sm" c="dimmed" mt={3} mb="lg">
                          {categoryInfo[category].description}
                        </Text>
                        <Table>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>{t("Common.Description")}</Table.Th>
                              <Table.Th>{t("Settings.Key")}</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {Object.entries(keyMap).map(([action, keybind]) => (
                              <Table.Tr key={keybind.name}>
                                <Table.Td>{keybind.name}</Table.Td>
                                <Table.Td>
                                  <KeybindInput action={action} keybind={keybind} />
                                </Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      </>
                    ) : (
                      <>
                        <Text size="lg" fw={500} className={classes.title}>
                          {categoryInfo[category].title}
                        </Text>
                        <Text size="sm" c="dimmed" mt={3} mb="lg">
                          {categoryInfo[category].description}
                        </Text>
                        {renderCategorySettings(category)}
                      </>
                    )}
                  </Tabs.Panel>
                ))}
              </Card>
            </ScrollArea>
            <Text size="sm" c="dimmed" ta="right">
              Cn Croissant v{version}
            </Text>
          </Stack>
        </Tabs>
      )}
    </Stack>
  );
}
