import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconCloud, IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { currentTabSelectedAtom, showArrowsAtom, xiangqiCloudArrowsAtom } from "@/state/atoms";
import { formatXiangqiMove } from "@/xiangqi/notation";
import { parseFen, parseUciMove } from "@/xiangqi/xiangqi";
import { useXiangqiStore } from "@/xiangqi/store";
import {
  queryXiangqiPuzzleMoves,
  type ChessdbMoveInfo,
} from "@/utils/chessdb/xiangqi";

function XiangqiCloudExplorerPanel() {
  const fen = useXiangqiStore((s) => s.currentNode().fen);
  const makeMove = useXiangqiStore((s) => s.makeMove);
  const currentTabSelected = useAtomValue(currentTabSelectedAtom);
  const showArrows = useAtomValue(showArrowsAtom);
  const setCloudArrows = useSetAtom(xiangqiCloudArrowsAtom);
  const [moves, setMoves] = useState<ChessdbMoveInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const nextMoves = await queryXiangqiPuzzleMoves(fen);
        if (!cancelled) setMoves(nextMoves);
      } catch (err) {
        if (!cancelled) {
          setMoves([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fen]);

  const displayMoves = useMemo(() => {
    let position;
    try {
      position = parseFen(fen);
    } catch {
      return [];
    }

    return moves
      .map((item) => {
        const move = parseUciMove(item.move);
        if (!move) return null;
        return {
          ...item,
          move,
          notation: formatXiangqiMove(position, move, "chinese"),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [fen, moves]);

  useEffect(() => {
    if (!showArrows || currentTabSelected !== "database" || displayMoves.length === 0) {
      setCloudArrows([]);
      return;
    }

    setCloudArrows([
      {
        orig: displayMoves[0].move.from,
        dest: displayMoves[0].move.to,
        brush: "silver",
        modifiers: {
          lineWidth: 11,
          opacity: 0.98,
          outlineWidth: 11,
          outlineColor: "#1f2937",
          outlineOpacity: 0.68,
          glow: true,
        },
      },
    ]);
    return () => setCloudArrows([]);
  }, [currentTabSelected, displayMoves, setCloudArrows, showArrows]);

  if (loading) {
    return (
      <Center h="100%">
        <Stack align="center" gap="xs">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            正在查询云库...
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
          <Group gap="xs">
            <IconCloud size="1.1rem" />
            <div>
              <Text fw={800}>云库</Text>
              <Text size="xs" c="dimmed">
                根据当前局面给出候选着
              </Text>
            </div>
          </Group>
          <Badge variant="light">{displayMoves.length} 着</Badge>
        </Group>
      </Paper>

      <ScrollArea flex={1} offsetScrollbars>
        {displayMoves.length > 0 ? (
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>走法</Table.Th>
                <Table.Th>评分</Table.Th>
                <Table.Th>胜率</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {displayMoves.map((item) => (
                <Table.Tr key={item.move.from + item.move.to}>
                  <Table.Td>
                    <Text fw={700}>{item.notation}</Text>
                    <Text size="xs" c="dimmed">
                      {item.move.from}
                      {item.move.to}
                      {item.rank !== null ? ` · rank ${item.rank}` : ""}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{formatCloudScore(item.score)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{formatCloudWinrate(item.winrate)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Button size="xs" variant="subtle" onClick={() => makeMove(item.move)}>
                      走这步
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Center h={220}>
            <Stack align="center" gap="xs">
              <Text fw={600} c="dimmed">
                当前局面暂无云库候选
              </Text>
              <Text size="xs" c="dimmed" ta="center">
                云库不可用或没有收录时，不影响本地引擎分析。
              </Text>
            </Stack>
          </Center>
        )}
      </ScrollArea>
    </Stack>
  );
}

function formatCloudScore(score: number | null) {
  if (score === null) return "-";
  return (score / 100).toFixed(2);
}

function formatCloudWinrate(winrate: number | null) {
  if (winrate === null) return "-";
  return `${winrate.toFixed(1)}%`;
}

export default XiangqiCloudExplorerPanel;
