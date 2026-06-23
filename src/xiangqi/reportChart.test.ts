import { describe, expect, it } from "vitest";
import {
  buildXiangqiEvalChartData,
  buildXiangqiEvalChartRenderData,
  findNearestXiangqiEvalChartPoint,
  formatXiangqiEvalChartTick,
  getXiangqiEvalChartDomain,
  getXiangqiEvalChartTicks,
  getXiangqiEvalChartXDomain,
  type XiangqiReportNode,
} from "./reportChart";
import { INITIAL_XIANGQI_FEN, type GameNode } from "./xiangqi";

const BLACK_TO_MOVE_FEN =
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 1 1";

function node(id: string, fen: string, text = id): GameNode {
  return {
    id,
    fen,
    move: null,
    text,
    comment: "",
    children: [],
  };
}

function reportNode(id: string, fen: string, text = id, x = 0): XiangqiReportNode {
  return {
    node: node(id, fen, text),
    path: Array.from({ length: x + 1 }, () => 0),
  };
}

describe("xiangqi report chart", () => {
  it("keeps ordinary scores on a dynamic symmetric domain", () => {
    const reportNodes = [
      reportNode("first", INITIAL_XIANGQI_FEN, "马８进７", 0),
      reportNode("second", BLACK_TO_MOVE_FEN, "炮２平５", 1),
    ];
    const data = buildXiangqiEvalChartData(reportNodes, {
      [INITIAL_XIANGQI_FEN]: "cp 4100",
      [BLACK_TO_MOVE_FEN]: "cp 3800",
    });

    expect(data.map((point) => point.value)).toEqual([41, -38]);
    expect(data[0].positiveValue).toBe(41);
    expect(data[0].negativeValue).toBeNull();
    expect(data[1].positiveValue).toBeNull();
    expect(data[1].negativeValue).toBe(-38);
    expect(getXiangqiEvalChartDomain(data)).toEqual([-45, 45]);
  });

  it("uses the default domain when all known scores are small or absent", () => {
    const data = buildXiangqiEvalChartData([reportNode("first", INITIAL_XIANGQI_FEN)], {
      [INITIAL_XIANGQI_FEN]: "cp 123",
    });

    expect(getXiangqiEvalChartDomain(data)).toEqual([-20, 20]);
    expect(getXiangqiEvalChartDomain([{ ...data[0], value: null }])).toEqual([-20, 20]);
  });

  it("expands to the mate domain only when a mate score is present", () => {
    const dataWithoutScore = buildXiangqiEvalChartData([
      reportNode("first", INITIAL_XIANGQI_FEN),
    ], {});
    const dataWithMateScore = buildXiangqiEvalChartData([
      reportNode("first", INITIAL_XIANGQI_FEN),
    ], {
      [INITIAL_XIANGQI_FEN]: "mate -2",
    });

    expect(getXiangqiEvalChartDomain(dataWithoutScore)).toEqual([-20, 20]);
    expect(getXiangqiEvalChartDomain(dataWithMateScore)).toEqual([-100, 100]);
    expect(buildXiangqiEvalChartRenderData(dataWithMateScore, [-100, 100])[0].value).toBe(-100);
  });

  it("adds a synthetic zero crossing so positive and negative areas meet at zero", () => {
    const data = buildXiangqiEvalChartData(
      [
        reportNode("first", INITIAL_XIANGQI_FEN, "红优", 0),
        reportNode("second", INITIAL_XIANGQI_FEN, "黑优", 1),
      ],
      {
        [INITIAL_XIANGQI_FEN]: "cp -200",
      },
    ).map((point, index) => ({
      ...point,
      x: index,
      value: index === 0 ? 2 : -2,
      positiveValue: index === 0 ? 2 : null,
      negativeValue: index === 0 ? null : -2,
    }));
    const renderData = buildXiangqiEvalChartRenderData(data, [-20, 20]);

    expect(renderData).toHaveLength(3);
    expect(renderData[1]).toMatchObject({
      x: 0.5,
      value: 0,
      positiveValue: 0,
      negativeValue: 0,
      synthetic: true,
    });
  });

  it("keeps ticks sparse and labels only the bounds plus zero", () => {
    const ticks = getXiangqiEvalChartTicks([-100, 100]);

    expect(ticks).toEqual([-100, -75, -50, -25, 0, 25, 50, 75, 100]);
    expect(formatXiangqiEvalChartTick(-100, [-100, 100])).toBe("-100");
    expect(formatXiangqiEvalChartTick(-75, [-100, 100])).toBe("");
    expect(formatXiangqiEvalChartTick(0, [-100, 100])).toBe("0");
    expect(formatXiangqiEvalChartTick(100, [-100, 100])).toBe("100");
  });

  it("finds chart bounds and nearest real point", () => {
    const data = buildXiangqiEvalChartData(
      [
        reportNode("first", INITIAL_XIANGQI_FEN, "one", 0),
        reportNode("second", INITIAL_XIANGQI_FEN, "two", 1),
      ],
      {
        [INITIAL_XIANGQI_FEN]: "cp 0",
      },
    );

    expect(getXiangqiEvalChartXDomain(data)).toEqual([0, 1]);
    expect(findNearestXiangqiEvalChartPoint(data, 0.8)?.move).toBe("two");
  });
});
