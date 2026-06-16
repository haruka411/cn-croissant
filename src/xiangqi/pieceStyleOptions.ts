import type { PieceStyle } from "./XiangqiBoard";

export const XIANGQI_PIECE_TEXT_SCALE_MIN = 70;
export const XIANGQI_PIECE_TEXT_SCALE_MAX = 160;
export const XIANGQI_PIECE_INNER_SCALE_MIN = 45;
export const XIANGQI_PIECE_INNER_SCALE_MAX = 96;

const XIANGQI_PIECE_STYLES_WITH_INNER_RING: readonly PieceStyle[] = [
    "classic",
    "seal",
    "paper",
    "jade",
    "flat",
    "porcelain",
    "lacquer",
    "stone",
    "bamboo",
    "crystal",
] satisfies PieceStyle[];

export function xiangqiPieceStyleHasInnerRing(style: PieceStyle): boolean {
    return XIANGQI_PIECE_STYLES_WITH_INNER_RING.includes(style);
}
