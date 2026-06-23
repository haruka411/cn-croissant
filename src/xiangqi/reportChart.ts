import { parseXiangqiEvaluation, parseXiangqiScore } from "./evaluation";
import {
  isCheckmate,
  parseFen,
  traverseMainline,
  type GameNode,
  type XiangqiPosition,
} from "./xiangqi";

export type XiangqiEvalChartPoint = {
  x: number;
  name: string;
  mateSign: -1 | 1 | null;
  move: string;
  negativeValue: number | null;
  positiveValue: number | null;
  scoreText: string;
  value: number | null;
  path: number[] | null;
  synthetic?: boolean;
};

export type XiangqiReportNode = {
  node: GameNode;
  path: number[];
};

export const XIANGQI_EVAL_CHART_DEFAULT_BOUND = 20;
export const XIANGQI_EVAL_CHART_MATE_BOUND = 100;

export function buildXiangqiReportNodes(root: GameNode): XiangqiReportNode[] {
  const nodes = traverseMainline(root).slice(1);
  return nodes.map((node, index) => ({
    node,
    path: Array.from({ length: index + 1 }, () => 0),
  }));
}

export function buildXiangqiEvalChartData(
  reportNodes: XiangqiReportNode[],
  scores: Record<string, string>,
): XiangqiEvalChartPoint[] {
  return reportNodes.map(({ node, path }, index) => {
    const position = parseFen(node.fen);
    const turn = position.turn;
    const score = scores[node.fen];
    const terminalMateSign = score ? getXiangqiTerminalReportMateSign(position) : null;
    const parsedScore = parseXiangqiScore(score);
    const evaluation = score ? parseXiangqiEvaluation(score, turn) : null;
    const engineMateSign =
      parsedScore?.kind === "mate" && evaluation
        ? getXiangqiChartSign(evaluation.redCentipawns)
        : null;
    const mateSign = terminalMateSign ?? engineMateSign;
    const redCentipawns =
      mateSign === null && evaluation?.redCentipawns !== undefined ? evaluation.redCentipawns : null;
    const value = redCentipawns !== null ? redCentipawns / 100 : null;

    return {
      x: index,
      mateSign,
      name: `${index + 1}. ${node.text}`,
      move: node.text,
      negativeValue: getXiangqiEvalNegativeValue(value),
      positiveValue: getXiangqiEvalPositiveValue(value),
      scoreText:
        terminalMateSign !== null
          ? `${terminalMateSign > 0 ? "+" : "-"}M0`
          : evaluation?.label ?? "-",
      value,
      path,
    };
  });
}

export function buildXiangqiEvalChartRenderData(
  data: XiangqiEvalChartPoint[],
  chartDomain: [number, number],
): XiangqiEvalChartPoint[] {
  const chartData: XiangqiEvalChartPoint[] = [];
  let previous: XiangqiEvalChartPoint | null = null;

  for (const rawPoint of data) {
    const point = resolveXiangqiEvalChartPoint(rawPoint, chartDomain);
    const zeroCrossing = previous ? getXiangqiEvalZeroCrossing(previous, point) : null;
    if (zeroCrossing) {
      chartData.push(zeroCrossing);
    }
    chartData.push(point);
    previous = point;
  }

  return chartData;
}

export function getXiangqiEvalChartXDomain(data: XiangqiEvalChartPoint[]): [number, number] {
  if (data.length <= 1) return [0, 1];
  return [0, data[data.length - 1].x];
}

export function findNearestXiangqiEvalChartPoint(
  data: XiangqiEvalChartPoint[],
  x: number,
): XiangqiEvalChartPoint | null {
  if (!Number.isFinite(x)) return null;

  return data.reduce<XiangqiEvalChartPoint | null>((nearest, point) => {
    if (!point.path) return nearest;
    if (!nearest) return point;
    return Math.abs(point.x - x) < Math.abs(nearest.x - x) ? point : nearest;
  }, null);
}

export function getXiangqiEvalChartDomain(data: XiangqiEvalChartPoint[]): [number, number] {
  if (data.some((point) => point.mateSign !== null)) {
    return [-XIANGQI_EVAL_CHART_MATE_BOUND, XIANGQI_EVAL_CHART_MATE_BOUND];
  }

  const values = data
    .map((point) => point.value)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const maxAbs = values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const bound = Math.max(XIANGQI_EVAL_CHART_DEFAULT_BOUND, roundXiangqiChartBound(maxAbs));
  return [-bound, bound];
}

export function getXiangqiEvalChartTicks([min, max]: [number, number]): number[] {
  const bound = Math.max(Math.abs(min), Math.abs(max));
  const step = getXiangqiEvalChartTickStep(bound);
  const ticks = new Set<number>([min, 0, max]);
  const firstTick = Math.ceil(min / step) * step;

  for (let value = firstTick; value <= max; value += step) {
    ticks.add(value);
  }

  return [...ticks].sort((a, b) => a - b);
}

export function formatXiangqiEvalChartTick(
  value: string | number,
  [min, max]: [number, number],
): string {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "";
  return sameXiangqiChartValue(number, min) ||
    sameXiangqiChartValue(number, 0) ||
    sameXiangqiChartValue(number, max)
    ? String(number)
    : "";
}

function resolveXiangqiEvalChartPoint(
  point: XiangqiEvalChartPoint,
  [min, max]: [number, number],
): XiangqiEvalChartPoint {
  if (point.mateSign === null) return point;

  const value = point.mateSign > 0 ? max : min;
  return {
    ...point,
    negativeValue: getXiangqiEvalNegativeValue(value),
    positiveValue: getXiangqiEvalPositiveValue(value),
    value,
  };
}

function getXiangqiTerminalReportMateSign(position: XiangqiPosition): -1 | 1 | null {
  if (!isCheckmate(position)) return null;
  return position.turn === "red" ? -1 : 1;
}

function getXiangqiChartSign(value: number): -1 | 1 {
  return value < 0 ? -1 : 1;
}

function getXiangqiEvalZeroCrossing(
  previous: XiangqiEvalChartPoint,
  next: XiangqiEvalChartPoint,
): XiangqiEvalChartPoint | null {
  if (previous.value === null || next.value === null) return null;
  if (sameXiangqiChartValue(previous.value, 0) || sameXiangqiChartValue(next.value, 0)) return null;
  if (Math.sign(previous.value) === Math.sign(next.value)) return null;

  const distance = Math.abs(previous.value) / (Math.abs(previous.value) + Math.abs(next.value));
  const x = previous.x + (next.x - previous.x) * distance;

  return {
    x,
    mateSign: null,
    name: `${previous.name}-${next.name}-0`,
    move: "",
    negativeValue: 0,
    positiveValue: 0,
    scoreText: "0",
    value: 0,
    path: null,
    synthetic: true,
  };
}

function getXiangqiEvalPositiveValue(value: number | null): number | null {
  return value !== null && value >= 0 ? value : null;
}

function getXiangqiEvalNegativeValue(value: number | null): number | null {
  return value !== null && value <= 0 ? value : null;
}

function roundXiangqiChartBound(value: number): number {
  return Math.ceil(Math.abs(value) / 5) * 5;
}

function getXiangqiEvalChartTickStep(bound: number): number {
  return Math.max(5, Math.ceil(bound / 4 / 5) * 5);
}

function sameXiangqiChartValue(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-9;
}
