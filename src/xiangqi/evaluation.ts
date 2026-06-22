import type { XiangqiColor } from "./xiangqi";

const XIANGQI_SCORE_CP_CEILING = 1000;
const XIANGQI_MATE_EVAL_CEILING = 10000;
const WIN_CHANCE_FACTOR = 0.00368208;

type ParsedXiangqiScore = {
  kind: "cp" | "mate";
  value: number;
};

export function parseXiangqiScore(score: string | undefined): ParsedXiangqiScore | null {
  if (!score) return null;

  const [kind, raw] = score.trim().split(/\s+/);
  const value = Number(raw);
  if ((kind !== "cp" && kind !== "mate") || !Number.isFinite(value)) return null;

  return { kind, value };
}

export function formatXiangqiScore(score: string): string {
  const parsed = parseXiangqiScore(score);
  if (!parsed) return score || "-";

  if (parsed.kind === "cp") {
    return `${parsed.value >= 0 ? "+" : ""}${(parsed.value / 100).toFixed(2)}`;
  }

  return `#${parsed.value}`;
}

export function isPositiveXiangqiScore(score: string): boolean {
  return (parseXiangqiScore(score)?.value ?? 0) >= 0;
}

export function scoreToXiangqiCentipawns(score: string | undefined): number | null {
  const parsed = parseXiangqiScore(score);
  if (!parsed) return null;

  if (parsed.kind === "mate") {
    return Math.sign(parsed.value || 1) * XIANGQI_SCORE_CP_CEILING;
  }

  return clamp(parsed.value, -XIANGQI_SCORE_CP_CEILING, XIANGQI_SCORE_CP_CEILING);
}

export function scoreToXiangqiWinChance(scoreOrCentipawns: string | number | undefined): number | null {
  const centipawns =
    typeof scoreOrCentipawns === "number"
      ? scoreOrCentipawns
      : scoreToXiangqiCentipawns(scoreOrCentipawns);
  if (centipawns === null || !Number.isFinite(centipawns)) return null;

  return 50 + 50 * (2 / (1 + Math.exp(-WIN_CHANCE_FACTOR * centipawns)) - 1);
}

export function parseXiangqiEvaluation(
  score: string,
  turn: XiangqiColor,
): { redCentipawns: number; label: string } | null {
  const parsed = parseXiangqiScore(score);
  if (!parsed) return null;

  const redValue = turn === "red" ? parsed.value : -parsed.value;
  if (parsed.kind === "cp") {
    return {
      redCentipawns: redValue,
      label: `${redValue >= 0 ? "+" : ""}${(redValue / 100).toFixed(2)}`,
    };
  }

  return {
    redCentipawns: Math.sign(redValue || 1) * XIANGQI_MATE_EVAL_CEILING,
    label: `${redValue >= 0 ? "+" : "-"}M${Math.abs(redValue)}`,
  };
}

export function scoreToEvalFill(redCentipawns: number): number {
  return clamp(scoreToXiangqiWinChance(redCentipawns) ?? 50, 3, 97);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
