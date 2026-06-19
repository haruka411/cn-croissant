import {
  Alert,
  Badge,
  Button,
  Center,
  Divider,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconBook, IconDatabase, IconInfoCircle, IconSearch } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { createTab } from "@/utils/tabs";
import {
  loadXiangqiDatabaseIndex,
  type XiangqiCblLibraryInfo,
  type XiangqiDatabaseIndex,
  type XiangqiDatabaseGame,
  type XiangqiDatabaseSummary,
} from "@/utils/xiangqiDatabase";
import { formatBytes, formatNumber } from "@/utils/format";

function XiangqiDatabasePanel() {
  const navigate = useNavigate();
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const [index, setIndex] = useState<XiangqiDatabaseIndex | null>(null);
  const [summary, setSummary] = useState<XiangqiDatabaseSummary | null>(null);
  const [games, setGames] = useState<XiangqiDatabaseGame[]>([]);
  const [cblLibraries, setCblLibraries] = useState<XiangqiCblLibraryInfo[]>([]);
  const [selected, setSelected] = useState<XiangqiDatabaseGame | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void refreshIndex(false, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshIndex(force: boolean, isCancelled: () => boolean = () => false) {
    try {
      setLoading(true);
      const nextIndex = await loadXiangqiDatabaseIndex({ force });
      if (isCancelled()) return;
      setIndex(nextIndex);
      setSummary(nextIndex.summary);
      setGames(nextIndex.games);
      setCblLibraries(nextIndex.cblLibraries);
      setSelected(nextIndex.games[0] ?? null);
    } catch (err) {
      if (!isCancelled()) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }

  const filteredGames = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return games;
    return games.filter((game) =>
      [game.name, game.event, game.red, game.black, game.result, game.date, game.path, game.sourceKind]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [games, search]);

  const obkFiles = summary?.files.filter((file) => file.kind === "obk") ?? [];
  const cblFiles =
    summary?.files.filter((file) => file.kind === "cbl" || file.kind === "cbr") ?? [];

  async function openGame(game: XiangqiDatabaseGame) {
    await createTab({
      tab: { name: game.event || game.name, type: "analysis" },
      setTabs,
      setActiveTab,
      pgn: game.notation,
      gameOrigin: {
        kind: "file",
        gameNumber: 0,
        file: {
          type: "file",
          name: game.name,
          path: game.path,
          numGames: 1,
          metadata: {
            tags: [],
            type: "game",
          },
          lastModified: Date.now(),
        },
      },
    });
    await navigate({ to: "/" });
  }

  if (loading) {
    return (
      <Center h="100%">
        <Stack align="center" gap="xs">
          <Loader />
          <Text c="dimmed">正在扫描本地象棋资料...</Text>
        </Stack>
      </Center>
    );
  }

  if (error) {
    return (
      <Stack p="md">
        <Alert color="red" icon={<IconInfoCircle size="1rem" />}>
          {error}
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack h="100%" p="md" gap="md">
      <Group justify="space-between" align="center">
        <div>
          <Title order={2}>象棋棋谱库</Title>
          <Text size="sm" c="dimmed">
            {summary?.root}
          </Text>
        </div>
        <Group>
          <TextInput
            w={320}
            leftSection={<IconSearch size="1rem" />}
            placeholder="搜索棋局、棋手、日期、来源"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
          <Button variant="default" onClick={() => void refreshIndex(true)}>
            重建索引
          </Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <StatCard label="已索引棋局" value={formatNumber(index?.games.length ?? 0)} />
        <StatCard
          label="棋谱/文本/XQF 文件"
          value={formatNumber(
            (summary?.pgnFiles ?? 0) + (summary?.xqfFiles ?? 0) + (summary?.textFiles ?? 0),
          )}
        />
        <StatCard label="CBL/CBR 文件" value={formatNumber((summary?.cblFiles ?? 0) + (summary?.cbrFiles ?? 0))} />
        <StatCard label="资料总大小" value={formatBytes(summary?.totalBytes ?? 0)} />
      </SimpleGrid>

      <Alert color="blue" icon={<IconInfoCircle size="1rem" />}>
        当前版本会建立持久化索引，支持 PGN-like、WXF、中文记谱、txt、XQF 和 XML 风格 CBL/CBR 棋局；二进制 CBL/CBR 已进入库级索引。
      </Alert>

      <Group grow flex={1} align="stretch" style={{ overflow: "hidden" }}>
        <Paper withBorder h="100%" style={{ overflow: "hidden" }}>
          <Stack h="100%" gap={0}>
            <Group p="sm" justify="space-between">
              <Group gap="xs">
                <ThemeIcon variant="light">
                  <IconDatabase size="1rem" />
                </ThemeIcon>
                <Text fw={700}>可读取棋局</Text>
              </Group>
              <Badge variant="light">{filteredGames.length}</Badge>
            </Group>
            <Divider />
            <ScrollArea flex={1}>
              <Table striped highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>棋局</Table.Th>
                    <Table.Th>红方</Table.Th>
                    <Table.Th>黑方</Table.Th>
                    <Table.Th>结果</Table.Th>
                    <Table.Th>手数</Table.Th>
                    <Table.Th>来源</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredGames.map((game) => (
                    <Table.Tr
                      key={game.id}
                      onClick={() => setSelected(game)}
                      style={{ cursor: "pointer" }}
                      bg={selected?.id === game.id ? "var(--mantine-color-default-hover)" : ""}
                    >
                      <Table.Td>
                        <Text size="sm" fw={500} lineClamp={1}>
                          {game.event || game.name}
                        </Text>
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {game.date || game.name}
                        </Text>
                      </Table.Td>
                      <Table.Td>{game.red}</Table.Td>
                      <Table.Td>{game.black}</Table.Td>
                      <Table.Td>{game.result}</Table.Td>
                      <Table.Td>{game.moveCount}</Table.Td>
                      <Table.Td>{game.sourceKind.toUpperCase()}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {filteredGames.length === 0 && (
                <Center h={180}>
                  <Text c="dimmed">未找到可读取的索引棋局</Text>
                </Center>
              )}
            </ScrollArea>
          </Stack>
        </Paper>

        <Paper withBorder h="100%" p="sm" style={{ overflow: "hidden" }}>
          <ScrollArea h="100%" offsetScrollbars>
            <Stack>
              {selected ? (
                <>
                  <Group justify="space-between" align="start">
                    <div>
                      <Text fw={800}>{selected.event || selected.name}</Text>
                      <Text size="sm" c="dimmed">
                        {selected.red} vs {selected.black}
                      </Text>
                    </div>
                    <Button size="xs" variant="light" onClick={() => openGame(selected)}>
                      打开棋局
                    </Button>
                  </Group>
                  <Text size="sm">结果：{selected.result}</Text>
                  <Text size="sm">日期：{selected.date || "-"}</Text>
                  <Text size="sm">预览：{selected.preview || "-"}</Text>
                  <Divider />
                </>
              ) : (
                <Text c="dimmed">选择一盘棋查看详情</Text>
              )}

              <Group gap="xs">
                <ThemeIcon variant="light" color="green">
                  <IconBook size="1rem" />
                </ThemeIcon>
                <Text fw={700}>开局库文件</Text>
              </Group>
              {obkFiles.map((file) => (
                <Paper key={file.path} withBorder p="xs">
                  <Text size="sm" fw={600}>
                    {file.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    SQLite OBK · {formatBytes(file.size)}
                  </Text>
                </Paper>
              ))}
              {obkFiles.length === 0 && <Text c="dimmed">未发现 OBK 文件</Text>}

              <Divider />
              <Text fw={700}>CBL 棋谱库</Text>
              <Text size="sm" c="dimmed">
                已发现 {formatNumber(cblFiles.length)} 个 CBL/CBR 文件，已轻量解析前 {formatNumber(cblLibraries.length)} 个库的信息。
              </Text>
              {cblLibraries.length > 0
                ? cblLibraries.map((library) => (
                    <Paper key={library.path} withBorder p="xs">
                      <Text size="sm" fw={600} lineClamp={1}>
                        {library.title}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {library.author || library.name} · 约 {formatNumber(library.estimatedRecords)} 条记录 · 已索引{" "}
                        {formatNumber(library.indexedGames)} 局 · 解压后 {formatBytes(library.decompressedBytes)}
                      </Text>
                      {library.description && (
                        <Text size="xs" c="dimmed" lineClamp={3} mt={4}>
                          {library.description}
                        </Text>
                      )}
                    </Paper>
                  ))
                : cblFiles.slice(0, 8).map((file) => (
                    <Text key={file.path} size="xs" c="dimmed" lineClamp={1}>
                      {file.name} · {formatBytes(file.size)}
                    </Text>
                  ))}
            </Stack>
          </ScrollArea>
        </Paper>
      </Group>
    </Stack>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Text size="xl" fw={800}>
        {value}
      </Text>
    </Paper>
  );
}

export default XiangqiDatabasePanel;
