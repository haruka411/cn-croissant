import {
  ActionIcon,
  Box,
  Divider,
  Group,
  Menu,
  Overlay,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  Tooltip,
  rgba,
  useMantineTheme,
} from "@mantine/core";
import { useColorScheme } from "@mantine/hooks";
import {
  IconArrowRight,
  IconArrowsSplit,
  IconArticle,
  IconArticleOff,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconLayoutList,
  IconList,
  IconMinus,
  IconPlus,
  IconX,
  IconChevronUp,
  IconChevronsUp,
} from "@tabler/icons-react";
import equal from "fast-deep-equal";
import { useAtom, useAtomValue } from "jotai";
import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import Comment from "@/components/common/Comment";
import {
  currentInvisibleAtom,
  currentShowCommentsAtom,
  currentShowVariationsAtom,
  tableViewAtom,
} from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import { formatXiangqiMove } from "@/xiangqi/notation";
import { resultReasonTranslationKey } from "@/xiangqi/persistence";
import { getNodeAtPath, parseFen, parseUciMove, type GameNode } from "@/xiangqi/xiangqi";
import { useXiangqiStore } from "@/xiangqi/store";
import notationStyles from "../common/GameNotation.module.css";
import moveStyles from "../common/MoveCell.module.css";

function XiangqiGameNotation({
  topBar,
  controls,
}: {
  topBar?: boolean;
  controls?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const currentFen = useXiangqiStore((s) => s.currentNode().fen);
  const copyNotation = useXiangqiStore((s) => s.copyNotation);
  const headers = useXiangqiStore((s) => s.headers);
  const rootComment = useXiangqiStore((s) => s.root.comment);
  const resultReason = headers.resultReason
    ? t(resultReasonTranslationKey(headers.resultReason))
    : null;

  const viewport = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!viewport.current) return;
    if (!targetRef.current) {
      viewport.current.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    const viewportEl = viewport.current;
    const targetEl = targetRef.current;
    const viewportRect = viewportEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const offsetInViewport = targetRect.top - viewportRect.top + viewportEl.scrollTop;
    viewportEl.scrollTo({ top: offsetInViewport - 65, behavior: "auto" });
  }, [currentFen]);

  const [invisibleValue, setInvisible] = useAtom(currentInvisibleAtom);
  const invisible = topBar && invisibleValue;
  const showComments = useAtomValue(currentShowCommentsAtom);
  const [tableView] = useAtom(tableViewAtom);
  const colorScheme = useColorScheme();

  const keyMap = useAtomValue(keyMapAtom);
  useHotkeys(keyMap.TOGGLE_BLUR.keys, () => setInvisible((v) => !v));
  useHotkeys(keyMap.COPY_PGN.keys, () => copyNotation());

  return (
    <Paper withBorder flex={1} style={{ position: "relative", overflow: "hidden" }}>
      <Group h="100%" wrap="nowrap" align="stretch" gap={0}>
        {controls && (
          <>
            <ScrollArea type="never" py="md" mx="xs" style={{ flexShrink: 0 }}>
              {controls}
            </ScrollArea>
            <Divider orientation="vertical" />
          </>
        )}
        <Stack h="100%" gap={0} style={{ flex: 1, minWidth: 0 }}>
          {topBar && <NotationHeader />}
          <ScrollArea flex={1} offsetScrollbars scrollbars="y" viewportRef={viewport}>
            <Stack gap="xs">
              <Box>
                {invisible && (
                  <Overlay
                    backgroundOpacity={0.6}
                    color={colorScheme === "dark" ? "#1a1b1e" : undefined}
                    blur={8}
                    zIndex={2}
                  />
                )}
                {showComments && rootComment && (
                  <Box p="sm" fz="sm">
                    <Comment comment={rootComment} />
                  </Box>
                )}
                {tableView ? (
                  <TableNotation targetRef={targetRef} />
                ) : (
                  <Box pt="md" px="sm">
                    <RenderVariationTree targetRef={targetRef} nodePath={[]} first />
                  </Box>
                )}
              </Box>
              <Box pb="md">
                {headers.result !== "*" && (
                  <Text ta="center">
                    {headers.result}
                    <br />
                    <Text span fs="italic">
                      {headers.result === "1/2-1/2"
                        ? t("Board.Result.Draw")
                        : headers.result === "1-0"
                          ? t("Board.Result.RedWins")
                          : t("Board.Result.BlackWins")}
                    </Text>
                    {resultReason && (
                      <>
                        <br />
                        <Text span c="dimmed" size="sm">
                          {t("Board.Game.ResultReason", { reason: resultReason })}
                        </Text>
                      </>
                    )}
                  </Text>
                )}
              </Box>
            </Stack>
          </ScrollArea>
        </Stack>
      </Group>
    </Paper>
  );
}

function NotationHeader() {
  const { t } = useTranslation();
  const [invisible, setInvisible] = useAtom(currentInvisibleAtom);
  const [showComments, setShowComments] = useAtom(currentShowCommentsAtom);
  const [showVariations, setShowVariations] = useAtom(currentShowVariationsAtom);
  const [tableView, setTableView] = useAtom(tableViewAtom);

  return (
    <Stack gap="xs" pt="xs">
      <Group justify="space-between" px="sm">
        <Text size="sm" fw={600}>
          Xiangqi
        </Text>
        <Group gap="sm">
          <Tooltip label={invisible ? t("Notation.ShowMoves") : t("Notation.HideMoves")}>
            <ActionIcon onClick={() => setInvisible((v) => !v)}>
              {invisible ? <IconEyeOff size="1rem" /> : <IconEye size="1rem" />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={tableView ? t("Notation.NormalView") : t("Notation.TableView")}>
            <ActionIcon onClick={() => setTableView((v) => !v)}>
              {tableView ? <IconList size="1rem" /> : <IconLayoutList size="1rem" />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={showComments ? t("Notation.HideComments") : t("Notation.ShowComments")}>
            <ActionIcon onClick={() => setShowComments((v) => !v)}>
              {showComments ? <IconArticle size="1rem" /> : <IconArticleOff size="1rem" />}
            </ActionIcon>
          </Tooltip>
          <Tooltip
            label={showVariations ? t("Notation.HideVariations") : t("Notation.ShowVariations")}
          >
            <ActionIcon onClick={() => setShowVariations((v) => !v)}>
              {showVariations ? <IconArrowsSplit size="1rem" /> : <IconArrowRight size="1rem" />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Divider />
    </Stack>
  );
}

const RenderVariationTree = memo(function RenderVariationTree({
  nodePath,
  first,
  targetRef,
}: {
  nodePath: number[];
  first?: boolean;
  targetRef: React.RefObject<HTMLSpanElement | null>;
}) {
  const showVariations = useAtomValue(currentShowVariationsAtom);
  const showComments = useAtomValue(currentShowCommentsAtom);
  const node = useXiangqiStore((s) => s.getNode(nodePath));
  const variations = node?.children ?? [];

  const variationNodes = showVariations
    ? variations.slice(1).map((variation, idx) => {
        const variationPath = [...nodePath, idx + 1];
        return (
          <React.Fragment key={variation.id}>
            <XiangqiMoveCell
              targetRef={targetRef}
              comment={variation.comment}
              move={variation.move}
              fen={variation.fen}
              movePath={variationPath}
              showComments={showComments}
              first
            />
            <RenderVariationTree targetRef={targetRef} nodePath={variationPath} />
          </React.Fragment>
        );
      })
    : [];

  const mainLinePath = [...nodePath, 0];
  return (
    <>
      {variations.length > 0 && (
        <XiangqiMoveCell
          targetRef={targetRef}
          comment={variations[0].comment}
          move={variations[0].move}
          fen={variations[0].fen}
          movePath={mainLinePath}
          showComments={showComments}
          first={first}
        />
      )}

      <VariationCell moveNodes={variationNodes} />

      {variations.length > 0 && (
        <RenderVariationTree targetRef={targetRef} nodePath={mainLinePath} />
      )}
    </>
  );
});

type RowItem = {
  type: "row";
  moveNumber: number;
  red: GameNode | null;
  redPath: number[];
  black: GameNode | null;
  blackPath: number[];
};
type VariationItem = {
  type: "variations";
  variations: GameNode[];
  parentPath: number[];
};
type CommentItem = {
  type: "comment";
  comment: string;
};
type Segment = RowItem | VariationItem | CommentItem;

const TableNotation = memo(function TableNotation({
  targetRef,
}: {
  targetRef: React.RefObject<HTMLSpanElement | null>;
}) {
  const showVariations = useAtomValue(currentShowVariationsAtom);
  const showComments = useAtomValue(currentShowCommentsAtom);
  const root = useXiangqiStore((s) => s.root);
  const startPly = useMemo(() => startingPly(root.fen), [root.fen]);

  const segments: Segment[] = [];
  let current = root;
  let path: number[] = [];

  while (current.children.length > 0) {
    const child = current.children[0];
    const childPath = [...path, 0];
    const childPly = startPly + childPath.length;
    const isRed = childPly % 2 === 1;
    const moveNumber = Math.ceil(childPly / 2);
    const sideVariations = current.children.slice(1);

    if (isRed) {
      let blackNode: GameNode | null = null;
      let blackPath: number[] = [];
      let blackVariations: GameNode[] = [];
      if (child.children[0]) {
        const candidatePath = [...childPath, 0];
        const candidatePly = startPly + candidatePath.length;
        if (candidatePly % 2 === 0) {
          blackNode = child.children[0];
          blackPath = candidatePath;
          blackVariations = child.children.slice(1);
        }
      }

      segments.push({
        type: "row",
        moveNumber,
        red: child,
        redPath: childPath,
        black: blackNode,
        blackPath,
      });
      if (showComments && child.comment) segments.push({ type: "comment", comment: child.comment });
      if (showVariations && sideVariations.length > 0) {
        segments.push({ type: "variations", variations: sideVariations, parentPath: path });
      }
      if (blackNode) {
        if (showComments && blackNode.comment) {
          segments.push({ type: "comment", comment: blackNode.comment });
        }
        if (showVariations && blackVariations.length > 0) {
          segments.push({ type: "variations", variations: blackVariations, parentPath: childPath });
        }
        current = blackNode;
        path = blackPath;
      } else {
        current = child;
        path = childPath;
      }
    } else {
      segments.push({
        type: "row",
        moveNumber,
        red: null,
        redPath: [],
        black: child,
        blackPath: childPath,
      });
      if (showComments && child.comment) segments.push({ type: "comment", comment: child.comment });
      if (showVariations && sideVariations.length > 0) {
        segments.push({ type: "variations", variations: sideVariations, parentPath: path });
      }
      current = child;
      path = childPath;
    }
  }

  return (
    <Table layout="fixed">
      <Table.Tbody>
        {segments.map((seg, idx) => {
          if (seg.type === "comment") {
            return (
              <tr key={`comment-${idx}`}>
                <td colSpan={3}>
                  <Box pl="sm" pt="xs">
                    <Comment comment={seg.comment} />
                  </Box>
                </td>
              </tr>
            );
          }
          if (seg.type === "variations") {
            return (
              <tr key={`var-${idx}`}>
                <td colSpan={3}>
                  <Box pl="sm" pt="xs">
                    {seg.variations.map((variation, vIdx) => {
                      const variationPath = [...seg.parentPath, vIdx + 1];
                      return (
                        <Box key={variation.id} className={notationStyles.variationBorder} mb={4}>
                          <XiangqiMoveCell
                            targetRef={targetRef}
                            comment={variation.comment}
                            move={variation.move}
                            fen={variation.fen}
                            movePath={variationPath}
                            showComments={showComments}
                            first
                          />
                          <RenderVariationTree targetRef={targetRef} nodePath={variationPath} />
                        </Box>
                      );
                    })}
                  </Box>
                </td>
              </tr>
            );
          }
          return (
            <RowSegment
              key={`row-${idx}`}
              targetRef={targetRef}
              moveNumber={seg.moveNumber}
              redPath={seg.redPath}
              blackPath={seg.blackPath}
            />
          );
        })}
      </Table.Tbody>
    </Table>
  );
});

function RowSegment({
  moveNumber,
  redPath,
  blackPath,
  targetRef,
}: {
  moveNumber: number;
  redPath: number[];
  blackPath: number[];
  targetRef: React.RefObject<HTMLSpanElement | null>;
}) {
  const showComments = useAtomValue(currentShowCommentsAtom);
  const red = useXiangqiStore((s) => (redPath.length > 0 ? s.getNode(redPath) : null));
  const black = useXiangqiStore((s) => (blackPath.length > 0 ? s.getNode(blackPath) : null));

  return (
    <Table.Tr>
      <Table.Td className={notationStyles.moveTableMoveNumber}>{moveNumber}</Table.Td>
      <Table.Td className={notationStyles.moveTableCell}>
        {red && (
          <XiangqiMoveCell
            targetRef={targetRef}
            comment={red.comment}
            move={red.move}
            fen={red.fen}
            movePath={redPath}
            showComments={showComments}
            tableLayout
          />
        )}
      </Table.Td>
      <Table.Td className={notationStyles.moveTableCell}>
        {black && (
          <XiangqiMoveCell
            targetRef={targetRef}
            comment={black.comment}
            move={black.move}
            fen={black.fen}
            movePath={blackPath}
            showComments={showComments}
            tableLayout
          />
        )}
      </Table.Td>
    </Table.Tr>
  );
}

function XiangqiMoveCell({
  movePath,
  move,
  comment,
  showComments,
  first,
  targetRef,
  tableLayout,
}: {
  comment: string;
  showComments: boolean;
  move?: string | null;
  fen?: string;
  first?: boolean;
  movePath: number[];
  targetRef: React.RefObject<HTMLSpanElement | null>;
  tableLayout?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const root = useXiangqiStore((s) => s.root);
  const currentPath = useXiangqiStore((s) => s.path);
  const goToMove = useXiangqiStore((s) => s.goToMove);
  const deleteMove = useXiangqiStore((s) => s.deleteMove);
  const promoteVariation = useXiangqiStore((s) => s.promoteVariation);
  const promoteToMainline = useXiangqiStore((s) => s.promoteToMainline);
  const copyVariationNotation = useXiangqiStore((s) => s.copyVariationNotation);
  const [open, setOpen] = useState(false);
  const displayMove = useMemo(() => {
    if (!move) return null;
    try {
      const parsed = parseUciMove(move);
      if (!parsed) return move;
      const parent = getNodeAtPath(root, movePath.slice(0, -1));
      return formatXiangqiMove(parseFen(parent.fen), parsed, "chinese");
    } catch {
      return move;
    }
  }, [move, movePath, root]);

  const isCurrentVariation = equal(currentPath, movePath);
  const ply = startingPly(root.fen) + movePath.length;
  const moveNumber = Math.ceil(ply / 2);
  const isRed = ply % 2 === 1;
  const hasNumber = !tableLayout && ply > 0 && (first || isRed);
  const baseLight = theme.colors.gray[8];
  const baseDark = theme.colors.gray[1];
  const bg = isCurrentVariation ? rgba(theme.colors.red[6], 0.18) : "transparent";

  return (
    <>
      <Box
        ref={isCurrentVariation ? targetRef : undefined}
        component="span"
        style={{
          display: tableLayout ? "block" : "inline-block",
          marginLeft: hasNumber ? 6 : 0,
          fontSize: "80%",
          width: tableLayout ? "100%" : undefined,
        }}
      >
        {hasNumber && `${moveNumber.toString()}${isRed ? "." : "..."}`}
        {displayMove && (
          <Menu opened={open} onChange={setOpen} width={200}>
            <Menu.Target>
              <Box
                component="button"
                className={`${moveStyles.cell} ${tableLayout ? moveStyles.cellFullWidth : ""}`}
                style={{
                  "--light-color": baseLight,
                  "--light-hover-color": rgba(baseLight, isCurrentVariation ? 0.25 : 0.1),
                  "--dark-color": baseDark,
                  "--dark-hover-color": rgba(baseDark, isCurrentVariation ? 0.25 : 0.1),
                  "--dark-bg": bg,
                  "--light-bg": bg,
                }}
                onClick={() => goToMove(movePath)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setOpen((value) => !value);
                }}
              >
                <Box component="span" className={moveStyles.moveText}>
                  {displayMove}
                </Box>
              </Box>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconChevronsUp size="0.875rem" />}
                onClick={() => promoteToMainline(movePath)}
              >
                {t("Menu.PromoteToMainLine")}
              </Menu.Item>
              <Menu.Item
                leftSection={<IconChevronUp size="0.875rem" />}
                onClick={() => promoteVariation(movePath)}
              >
                {t("Menu.PromoteVariation")}
              </Menu.Item>
              <Menu.Item
                leftSection={<IconCopy size="0.875rem" />}
                onClick={() => copyVariationNotation(movePath)}
              >
                {t("Menu.CopyVariationPGN")}
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<IconX size="0.875rem" />}
                onClick={() => deleteMove(movePath)}
              >
                {t("Menu.DeleteMove")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Box>
      {showComments && !tableLayout && comment && <Comment comment={comment} />}
    </>
  );
}

function VariationCell({ moveNodes }: { moveNodes: React.ReactNode[] }) {
  const [expanded, setExpanded] = useState(true);
  if (moveNodes.length === 0) return null;
  return (
    <Box className={notationStyles.variationBorder}>
      <ActionIcon size="xs" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <IconMinus size="0.5rem" /> : <IconPlus size="0.5rem" />}
      </ActionIcon>
      {expanded &&
        moveNodes.map((node, i) => (
          <Box key={i} className={notationStyles.lineBeforeVariation}>
            {node}
          </Box>
        ))}
    </Box>
  );
}

function startingPly(fen: string): number {
  return parseFen(fen).turn === "black" ? 1 : 0;
}

export default memo(XiangqiGameNotation);
