import { describe, expect, it } from "vitest";
import {
  formatXiangqiScore,
  parseXiangqiEvaluation,
  scoreToEvalFill,
  scoreToXiangqiCentipawns,
  scoreToXiangqiWinChance,
} from "./evaluation";

describe("xiangqi evaluation", () => {
  it("formats engine scores", () => {
    expect(formatXiangqiScore("cp 50")).toBe("+0.50");
    expect(formatXiangqiScore("cp -125")).toBe("-1.25");
    expect(formatXiangqiScore("mate 3")).toBe("#3");
  });

  it("normalizes scores for arrows and eval bars", () => {
    expect(scoreToXiangqiCentipawns("cp 1200")).toBe(1000);
    expect(scoreToXiangqiCentipawns("mate -2")).toBe(-1000);
    expect(scoreToXiangqiWinChance("cp 0")).toBe(50);
    expect(scoreToEvalFill(10000)).toBe(97);
  });

  it("converts engine-side scores to red-side evaluations", () => {
    expect(parseXiangqiEvaluation("cp 50", "red")).toEqual({
      redCentipawns: 50,
      label: "+0.50",
    });
    expect(parseXiangqiEvaluation("cp 50", "black")).toEqual({
      redCentipawns: -50,
      label: "-0.50",
    });
    expect(parseXiangqiEvaluation("mate -2", "red")).toEqual({
      redCentipawns: -10000,
      label: "-M2",
    });
  });
});
