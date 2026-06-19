import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Progress,
  ScrollArea,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { parseUciMove } from "@/xiangqi/xiangqi";
import { useXiangqiStore } from "@/xiangqi/store";
import {
  getXiangqiIndexedPositionStats,
  loadXiangqiDatabaseIndex,
  type XiangqiDatabaseIndex,
  type XiangqiPositionMoveStats,
} from "@/utils/xiangqiDatabase";

function XiangqiDatabaseExplorerPanel() {
  const fen = useXiangqiStore((s) => s.currentNode().fen);
  const makeMove = useXiangqiStore((s) => s.makeMove);
  const [index, setIndex] = useState<XiangqiDatabaseIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        const nextIndex = await loadXiangqiDatabaseIndex();
        if (!cancelled) setIndex(nextIndex);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const displayStats = useMemo(
    () => (index ? getXiangqiIndexedPositionStats(index, fen) : []),
    [fen, index],
  );
  const sourceText = index
    ? `来自 ${index.games.length} 局索引棋谱、${index.summary.obkFiles} 个开局库文件`
    : "正在读取持久化棋谱索引";
  const total = displayStats.reduce((sum, item) => sum + item.games, 0);

  if (loading) {
    return (
      <Center h="100%">
        <Stack align="center" gap="xs">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            正在读取本地数据库...
          </Text>
        </Stack>
      </Center>
    );
  }

  if (error) {
    return (
      <Stack p="sm">
        <Alert color="red" icon={<IconInfoCircle size="1rem" />}>
          {error}
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack h="100%" p="sm" gap="sm">
      <Paper withBorder p="sm">
        <Group justify="space-between">
          <div>
            <Text fw={800}>本地数据库</Text>
            <Text size="xs" c="dimmed">
              {sourceText}
            </Text>
          </div>
          <Badge variant="light">{displayStats.length} 着</Badge>
        </Group>
      </Paper>

      <ScrollArea flex={1} offsetScrollbars>
        {displayStats.length > 0 ? (
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>走法</Table.Th>
                <Table.Th>出现</Table.Th>
                <Table.Th>结果</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {displayStats.map((item) => (
                <MoveRow
                  key={item.move}
                  item={item}
                  total={total}
                  onPlay={() => {
                    const move = parseUciMove(item.move);
                    if (move) makeMove(move);
                  }}
                />
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Center h={220}>
            <Stack align="center" gap="xs">
              <Text fw={600} c="dimmed">
                当前局面暂无本地记录
              </Text>
              <Text size="xs" c="dimmed" ta="center">
                本页读取持久化索引，不再实时全量扫描棋谱目录。
              </Text>
            </Stack>
          </Center>
        )}
      </ScrollArea>
    </Stack>
  );
}

function MoveRow({
  item,
  total,
  onPlay,
}: {
  item: XiangqiPositionMoveStats;
  total: number;
  onPlay: () => void;
}) {
  const pct = total > 0 ? (item.games / total) * 100 : 0;
  const decisive = item.redWins + item.draws + item.blackWins;
  return (
    <Table.Tr>
      <Table.Td>
        <Text fw={700}>{item.notation}</Text>
        <Text size="xs" c="dimmed">
          {item.move}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm">{item.games}</Text>
        <Progress value={pct} size="xs" />
      </Table.Td>
      <Table.Td>
        {decisive > 0 ? (
          <Text size="xs">
            红 {item.redWins} / 和 {item.draws} / 黑 {item.blackWins}
          </Text>
        ) : (
          <Text size="xs" c="dimmed">
            书库评分
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        <Button size="xs" variant="subtle" onClick={onPlay}>
          走这步
        </Button>
      </Table.Td>
    </Table.Tr>
  );
}

export default XiangqiDatabaseExplorerPanel;
