import {
    applyMove,
    isInCheck,
    legalMoves,
    parseFen,
    positionKey,
    type GameNode,
    type XiangqiColor,
    type XiangqiMove,
    type XiangqiPosition,
    type Square,
} from "./xiangqi";
import type { XiangqiResult, XiangqiResultReason } from "./persistence";

export type XiangqiRepetitionRule =
    | "AsianRule"
    | "ChineseRule"
    | "SkyRule"
    | "ComputerRule"
    | "YitianRule"
    | "AllowChase"
    | "NoJudgement";

type Violation = "idle" | "chase" | "check";

type RulePolicy = {
    repetitionOccurrences: number;
    chaseLevel: number;
    chineseProtectedMinorChase: boolean;
    naturalDraw: boolean;
};

type RuleOutcome =
    | { type: "draw"; reason: XiangqiResultReason }
    | { type: "loss"; loser: XiangqiColor; reason: XiangqiResultReason }
    | null;

type PieceIdentity = string;

type PieceTracker = Map<Square, PieceIdentity>;

export const DEFAULT_XIANGQI_REPETITION_RULE: XiangqiRepetitionRule = "AsianRule";
export const XIANGQI_REPETITION_RULE_STORAGE_KEY = "xiangqi-repetition-rule";

export function currentXiangqiRepetitionRule(): XiangqiRepetitionRule {
    if (typeof localStorage === "undefined") return DEFAULT_XIANGQI_REPETITION_RULE;
    const value = localStorage.getItem(XIANGQI_REPETITION_RULE_STORAGE_KEY);
    if (!value) return DEFAULT_XIANGQI_REPETITION_RULE;
    try {
        return parseXiangqiRepetitionRule(JSON.parse(value));
    } catch {
        return parseXiangqiRepetitionRule(value);
    }
}

export function parseXiangqiRepetitionRule(value: unknown): XiangqiRepetitionRule {
    return isXiangqiRepetitionRule(value) ? value : DEFAULT_XIANGQI_REPETITION_RULE;
}

export function adjudicateXiangqiRepetition(
    root: GameNode,
    path: number[],
    rule: XiangqiRepetitionRule = currentXiangqiRepetitionRule(),
): { result: XiangqiResult; reason: XiangqiResultReason } | null {
    const outcome = judgeXiangqiRepetition(root, path, rule);
    if (!outcome) return null;
    if (outcome.type === "draw") {
        return { result: "1/2-1/2", reason: outcome.reason };
    }
    return {
        result: outcome.loser === "red" ? "0-1" : "1-0",
        reason: outcome.reason,
    };
}

export function judgeXiangqiRepetition(
    root: GameNode,
    path: number[],
    rule: XiangqiRepetitionRule = currentXiangqiRepetitionRule(),
): RuleOutcome {
    if (rule === "NoJudgement") return null;
    const policy = xiangqiRulePolicy(rule);

    const line = nodesAtPath(root, path);
    const current = line.at(-1);
    if (!current) return null;

    const currentKey = positionKey(current.fen);
    const occurrences = line
        .map((node, index) => ({ index, key: positionKey(node.fen) }))
        .filter((entry) => entry.key === currentKey);
    if (occurrences.length < policy.repetitionOccurrences) return null;

    const previous = occurrences[occurrences.length - 2]?.index;
    if (previous === undefined) return null;

    const cycle = classifyRepetitionCycle(line, previous, policy);
    return applyRepetitionRule(rule, cycle, policy);
}

export function xiangqiNaturalDrawApplies(
    rule: XiangqiRepetitionRule = currentXiangqiRepetitionRule(),
): boolean {
    return xiangqiRulePolicy(rule).naturalDraw;
}

function isXiangqiRepetitionRule(value: unknown): value is XiangqiRepetitionRule {
    return (
        value === "AsianRule" ||
        value === "ChineseRule" ||
        value === "SkyRule" ||
        value === "ComputerRule" ||
        value === "YitianRule" ||
        value === "AllowChase" ||
        value === "NoJudgement"
    );
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

function classifyRepetitionCycle(
    line: GameNode[],
    startIndex: number,
    policy: RulePolicy,
): Record<XiangqiColor, Violation> {
    const stats: Record<
        XiangqiColor,
        { moves: number; checks: number; chaseSets: Set<PieceIdentity>[] }
    > = {
        red: { moves: 0, checks: 0, chaseSets: [] },
        black: { moves: 0, checks: 0, chaseSets: [] },
    };
    let tracker = createPieceTracker(parseFen(line[startIndex].fen));

    for (let index = startIndex + 1; index < line.length; index += 1) {
        const before = parseFen(line[index - 1].fen);
        const after = parseFen(line[index].fen);
        const moveText = line[index].move;
        const move = moveText ? parseMoveText(moveText) : null;
        const mover = before.turn;
        stats[mover].moves += 1;

        if (move) {
            tracker = updatePieceTracker(tracker, move);
        }
        if (isInCheck(after, after.turn)) {
            stats[mover].checks += 1;
        }
        stats[mover].chaseSets.push(chasedPieces(after, mover, tracker, policy));
    }

    const hasAnyCheck = stats.red.checks > 0 || stats.black.checks > 0;
    return {
        red: classifySide(stats.red, hasAnyCheck),
        black: classifySide(stats.black, hasAnyCheck),
    };
}

function classifySide(
    side: { moves: number; checks: number; chaseSets: Set<PieceIdentity>[] },
    hasAnyCheck: boolean,
): Violation {
    if (side.moves > 0 && side.checks === side.moves) return "check";
    if (hasAnyCheck) return "idle";
    const common = intersectAll(side.chaseSets);
    return common.size > 0 ? "chase" : "idle";
}

function applyRepetitionRule(
    rule: XiangqiRepetitionRule,
    cycle: Record<XiangqiColor, Violation>,
    policy: RulePolicy,
): RuleOutcome {
    if (cycle.red === "idle" && cycle.black === "idle") {
        return { type: "draw", reason: "repetition" };
    }

    switch (rule) {
        case "AsianRule":
        case "ChineseRule":
        case "SkyRule":
        case "ComputerRule":
        case "YitianRule":
        case "AllowChase":
            return adjudicateByLevel(cycle, { chase: policy.chaseLevel, check: 2 });
        case "NoJudgement":
            return null;
    }
}

function xiangqiRulePolicy(rule: XiangqiRepetitionRule): RulePolicy {
    switch (rule) {
        case "ComputerRule":
            return {
                repetitionOccurrences: 3,
                chaseLevel: 1,
                chineseProtectedMinorChase: false,
                naturalDraw: true,
            };
        case "ChineseRule":
            return {
                repetitionOccurrences: 2,
                chaseLevel: 1,
                chineseProtectedMinorChase: true,
                naturalDraw: true,
            };
        case "YitianRule":
            return {
                repetitionOccurrences: 2,
                chaseLevel: 1,
                chineseProtectedMinorChase: false,
                naturalDraw: false,
            };
        case "AllowChase":
            return {
                repetitionOccurrences: 2,
                chaseLevel: 0,
                chineseProtectedMinorChase: false,
                naturalDraw: true,
            };
        case "NoJudgement":
            return {
                repetitionOccurrences: Number.POSITIVE_INFINITY,
                chaseLevel: 0,
                chineseProtectedMinorChase: false,
                naturalDraw: true,
            };
        case "AsianRule":
        case "SkyRule":
            return {
                repetitionOccurrences: 2,
                chaseLevel: 1,
                chineseProtectedMinorChase: false,
                naturalDraw: true,
            };
    }
}

function adjudicateByLevel(
    cycle: Record<XiangqiColor, Violation>,
    levels: { chase: number; check: number },
): RuleOutcome {
    const red = violationLevel(cycle.red, levels);
    const black = violationLevel(cycle.black, levels);
    if (red === black) {
        return { type: "draw", reason: "repetition" };
    }
    const loser = red > black ? "red" : "black";
    return {
        type: "loss",
        loser,
        reason: red > black ? reasonFor(cycle.red) : reasonFor(cycle.black),
    };
}

function violationLevel(violation: Violation, levels: { chase: number; check: number }): number {
    if (violation === "check") return levels.check;
    if (violation === "chase") return levels.chase;
    return 0;
}

function reasonFor(violation: Violation): XiangqiResultReason {
    if (violation === "check") return "perpetualCheck";
    if (violation === "chase") return "perpetualChase";
    return "repetition";
}

function createPieceTracker(position: XiangqiPosition): PieceTracker {
    const tracker: PieceTracker = new Map();
    const counts = new Map<string, number>();
    for (const [square, piece] of position.board) {
        const key = `${piece.color}:${piece.role}`;
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        tracker.set(square, `${key}:${next}`);
    }
    return tracker;
}

function updatePieceTracker(tracker: PieceTracker, move: XiangqiMove): PieceTracker {
    const next = new Map(tracker);
    const id = next.get(move.from);
    next.delete(move.from);
    next.delete(move.to);
    if (id) next.set(move.to, id);
    return next;
}

function chasedPieces(
    position: XiangqiPosition,
    color: XiangqiColor,
    tracker: PieceTracker,
    policy: RulePolicy,
): Set<PieceIdentity> {
    const result = new Set<PieceIdentity>();
    const probe: XiangqiPosition = { ...position, turn: color };
    for (const move of legalMoves(probe)) {
        const attacker = position.board.get(move.from);
        const target = position.board.get(move.to);
        if (!attacker || !target || target.color === color) continue;
        if (!canBeChaseAttacker(attacker.role)) continue;
        if (!canBeChaseTarget(target, move.to)) continue;
        if (
            !isProtectedAfterCapture(probe, move) ||
            isForceChase(attacker.role, target.role, policy)
        ) {
            const id = tracker.get(move.to);
            if (id) result.add(id);
        }
    }
    return result;
}

function canBeChaseAttacker(role: string): boolean {
    return role !== "king" && role !== "pawn";
}

function canBeChaseTarget(piece: { color: XiangqiColor; role: string }, square: Square): boolean {
    if (piece.role === "king") return false;
    if (piece.role !== "pawn") return true;
    const rank = Number.parseInt(square.slice(1), 10);
    return piece.color === "red" ? rank >= 5 : rank <= 4;
}

function isForceChase(attackerRole: string, targetRole: string, policy: RulePolicy): boolean {
    if ((attackerRole === "horse" || attackerRole === "cannon") && targetRole === "rook") {
        return true;
    }
    return (
        policy.chineseProtectedMinorChase &&
        (attackerRole === "advisor" || attackerRole === "elephant") &&
        (targetRole === "rook" || targetRole === "horse" || targetRole === "cannon")
    );
}

function isProtectedAfterCapture(position: XiangqiPosition, move: XiangqiMove): boolean {
    let after: XiangqiPosition;
    try {
        after = applyMove(position, move).position;
    } catch {
        return true;
    }
    return legalMoves(after).some((reply) => reply.to === move.to);
}

function intersectAll(sets: Set<PieceIdentity>[]): Set<PieceIdentity> {
    if (sets.length === 0) return new Set();
    let result = new Set(sets[0]);
    for (const set of sets.slice(1)) {
        result = new Set([...result].filter((value) => set.has(value)));
    }
    return result;
}

function parseMoveText(text: string): XiangqiMove | null {
    const clean = text.trim().toLowerCase();
    if (!/^[a-i][0-9][a-i][0-9]$/.test(clean)) return null;
    return {
        from: clean.slice(0, 2) as Square,
        to: clean.slice(2, 4) as Square,
    };
}
