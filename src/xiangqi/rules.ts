import {
    isInCheck,
    parseFen,
    positionKey,
    type GameNode,
    type XiangqiColor,
} from "./xiangqi";
import type { XiangqiResult, XiangqiResultReason } from "./persistence";

type RuleOutcome =
    | { type: "draw"; reason: XiangqiResultReason }
    | { type: "loss"; loser: XiangqiColor; reason: XiangqiResultReason }
    | null;

export function adjudicateXiangqiRepetition(
    root: GameNode,
    path: number[],
): { result: XiangqiResult; reason: XiangqiResultReason } | null {
    const outcome = judgeXiangqiRepetition(root, path);
    if (!outcome) return null;
    if (outcome.type === "draw") return { result: "1/2-1/2", reason: outcome.reason };
    return {
        result: outcome.loser === "red" ? "0-1" : "1-0",
        reason: outcome.reason,
    };
}

export function judgeXiangqiRepetition(root: GameNode, path: number[]): RuleOutcome {
    const line = nodesAtPath(root, path);
    const current = line.at(-1);
    if (!current) return null;

    const currentKey = positionKey(current.fen);
    const occurrences = line
        .map((node, index) => ({ index, key: positionKey(node.fen) }))
        .filter((entry) => entry.key === currentKey);
    if (occurrences.length < 3) return null;

    const previous = occurrences[occurrences.length - 2]?.index;
    if (previous === undefined) return null;

    const checks = classifyChecks(line, previous);
    const redChecks = checks.red.moves > 0 && checks.red.checks === checks.red.moves;
    const blackChecks = checks.black.moves > 0 && checks.black.checks === checks.black.moves;
    if (redChecks !== blackChecks) {
        return {
            type: "loss",
            loser: redChecks ? "red" : "black",
            reason: "perpetualCheck",
        };
    }

    return { type: "draw", reason: "repetition" };
}

export function xiangqiNaturalDrawReached(root: GameNode, path: number[]): boolean {
    const current = nodesAtPath(root, path).at(-1);
    return current ? parseFen(current.fen).halfmove >= 120 : false;
}

function nodesAtPath(root: GameNode, path: number[]): GameNode[] {
    const nodes = [root];
    let node = root;
    for (const index of path) {
        const child = node.children[index];
        if (!child) break;
        node = child;
        nodes.push(child);
    }
    return nodes;
}

function classifyChecks(
    line: GameNode[],
    startIndex: number,
): Record<XiangqiColor, { moves: number; checks: number }> {
    const stats: Record<XiangqiColor, { moves: number; checks: number }> = {
        red: { moves: 0, checks: 0 },
        black: { moves: 0, checks: 0 },
    };

    for (let index = startIndex + 1; index < line.length; index += 1) {
        const before = parseFen(line[index - 1].fen);
        const after = parseFen(line[index].fen);
        const mover = before.turn;
        stats[mover].moves += 1;
        if (isInCheck(after, after.turn)) stats[mover].checks += 1;
    }

    return stats;
}
