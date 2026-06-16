import clsx from "clsx";
import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  coords,
  legalDests,
  PIECE_LABELS,
  square,
  type Square,
  type XiangqiDrawBrush,
  type XiangqiDrawShape,
  type XiangqiPiece,
  type XiangqiMove,
  type XiangqiPosition,
} from "./xiangqi";
import classes from "./XiangqiBoard.module.css";
import {
  XIANGQI_PIECE_INNER_SCALE_MAX,
  XIANGQI_PIECE_INNER_SCALE_MIN,
  XIANGQI_PIECE_TEXT_SCALE_MAX,
  XIANGQI_PIECE_TEXT_SCALE_MIN,
  xiangqiPieceStyleHasInnerRing,
} from "./pieceStyleOptions";

type Orientation = "red" | "black";
export type BoardTheme =
  | "classic"
  | "jade"
  | "dark"
  | "parchment"
  | "walnut"
  | "porcelain"
  | "slate"
  | "crystal";
export type PieceStyle =
  | "classic"
  | "seal"
  | "plain"
  | "paper"
  | "jade"
  | "flat"
  | "porcelain"
  | "lacquer"
  | "stone"
  | "bamboo"
  | "crystal";
export type CoordinateMode = "no" | "edge" | "all";
export type MoveMethod = "drag" | "select" | "both";

const GRID_PAD_X = 8;
const GRID_PAD_Y = 7;
const GRID_WIDTH = 84;
const GRID_HEIGHT = 86;
const SVG_WIDTH = 800;
const SVG_HEIGHT = 900;
const DRAW_BRUSH_SEQUENCE: XiangqiDrawBrush[] = ["green", "red", "blue", "yellow"];
const DRAW_BRUSHES: Record<
  XiangqiDrawBrush,
  { color: string; opacity: number; lineWidth: number }
> = {
  green: { color: "#15781b", opacity: 0.74, lineWidth: 10 },
  red: { color: "#882020", opacity: 0.74, lineWidth: 10 },
  blue: { color: "#003088", opacity: 0.74, lineWidth: 10 },
  yellow: { color: "#e68f00", opacity: 0.78, lineWidth: 10 },
  paleGreen: { color: "#15781b", opacity: 0.32, lineWidth: 12 },
  paleRed: { color: "#882020", opacity: 0.32, lineWidth: 12 },
  paleBlue: { color: "#003088", opacity: 0.32, lineWidth: 12 },
  variation: { color: "#9b59b6", opacity: 0.68, lineWidth: 7.5 },
};

type GridPoint = readonly [file: number, rank: number];
type GridSegment = readonly [from: GridPoint, to: GridPoint];
type DrawingState = {
  orig: Square;
  dest?: Square;
  brush: XiangqiDrawBrush;
  pointerId: number;
};

const horizontalSegments: GridSegment[] = Array.from({ length: 10 }, (_, rank) => [
  [0, rank],
  [8, rank],
]);

const verticalSegments: GridSegment[] = Array.from({ length: 9 }, (_, file) =>
  file === 0 || file === 8
    ? [
        [
          [file, 0],
          [file, 9],
        ] as GridSegment,
      ]
    : [
        [
          [file, 0],
          [file, 4],
        ] as GridSegment,
        [
          [file, 5],
          [file, 9],
        ] as GridSegment,
      ],
).flat();

const palaceSegments: GridSegment[] = [
  [
    [3, 0],
    [5, 2],
  ],
  [
    [5, 0],
    [3, 2],
  ],
  [
    [3, 7],
    [5, 9],
  ],
  [
    [5, 7],
    [3, 9],
  ],
];

const starPoints = [
  [1, 2],
  [7, 2],
  [0, 3],
  [2, 3],
  [4, 3],
  [6, 3],
  [8, 3],
  [0, 6],
  [2, 6],
  [4, 6],
  [6, 6],
  [8, 6],
  [1, 7],
  [7, 7],
] as const;

export function XiangqiBoard({
  position,
  selected,
  lastMove,
  orientation,
  boardTheme = "classic",
  pieceStyle = "classic",
  pieceTextScale = 100,
  pieceInnerScale = 80,
  pieceInnerRingVisible = true,
  shapes = [],
  autoShapes = [],
  showDests = true,
  showLastMove = true,
  showCoordinates = "no",
  moveMethod = "both",
  snapDrawings = true,
  drawingsEnabled = true,
  onShapesChange,
  onSelect,
  onMove,
  editingPiece,
  onPutPiece,
}: {
  position: XiangqiPosition;
  selected: Square | null;
  lastMove: XiangqiMove | null;
  orientation: Orientation;
  boardTheme?: BoardTheme;
  pieceStyle?: PieceStyle;
  pieceTextScale?: number;
  pieceInnerScale?: number;
  pieceInnerRingVisible?: boolean;
  shapes?: XiangqiDrawShape[];
  autoShapes?: XiangqiDrawShape[];
  showDests?: boolean;
  showLastMove?: boolean;
  showCoordinates?: CoordinateMode;
  moveMethod?: MoveMethod;
  snapDrawings?: boolean;
  drawingsEnabled?: boolean;
  onShapesChange?: (shapes: XiangqiDrawShape[]) => void;
  onSelect: (square: Square | null) => void;
  onMove: (move: XiangqiMove) => void;
  editingPiece?: XiangqiPiece | null;
  onPutPiece?: (target: Square, piece: XiangqiPiece | null) => void;
}) {
  const [drawing, setDrawing] = useState<DrawingState | null>(null);
  const [dragging, setDragging] = useState<Square | null>(null);
  const suppressClick = useRef(false);
  const dests = legalDests(position);
  const selectedDests = selected ? (dests.get(selected) ?? []) : [];
  const visibleShapes = drawing
    ? [
        ...autoShapes,
        ...shapes,
        {
          orig: drawing.orig,
          dest: drawing.dest,
          brush: drawing.brush,
        },
      ]
    : [...autoShapes, ...shapes];
  const clampedPieceInnerScale = clamp(
    pieceInnerScale,
    XIANGQI_PIECE_INNER_SCALE_MIN,
    XIANGQI_PIECE_INNER_SCALE_MAX,
  );
  const showPieceInnerRing = pieceInnerRingVisible && xiangqiPieceStyleHasInnerRing(pieceStyle);
  const handlePoint = (target: Square) => {
    if (onPutPiece && editingPiece !== undefined) {
      onPutPiece(target, editingPiece);
      onSelect(null);
      return;
    }
    if (moveMethod === "drag" && !onPutPiece) {
      const piece = position.board.get(target);
      onSelect(piece?.color === position.turn ? target : null);
      return;
    }
    if (selected && selectedDests.includes(target)) {
      onMove({ from: selected, to: target });
      return;
    }
    const piece = position.board.get(target);
    if (piece?.color === position.turn) {
      onSelect(target);
      return;
    }
    onSelect(null);
  };

  const startPieceDrag = (sq: Square, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (onPutPiece || moveMethod === "select" || event.button !== 0) return;
    const piece = position.board.get(sq);
    if (piece?.color !== position.turn) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(sq);
    onSelect(sq);
  };

  const finishPieceDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    const board = event.currentTarget.parentElement;
    const target = board ? squareFromPointer(event, board, orientation, true) : null;
    const legalTargets = dests.get(dragging) ?? [];

    if (target && legalTargets.includes(target)) {
      suppressClick.current = true;
      onMove({ from: dragging, to: target });
    }
    setDragging(null);
  };

  const startDrawing = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingsEnabled || !onShapesChange || (event.button !== 2 && !event.shiftKey)) return;

    const orig = squareFromPointer(event, event.currentTarget, orientation, snapDrawings);
    if (!orig) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawing({
      orig,
      brush: eventBrush(event),
      pointerId: event.pointerId,
    });
  };

  const updateDrawing = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing || drawing.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    const dest = squareFromPointer(event, event.currentTarget, orientation, snapDrawings);
    setDrawing((current) =>
      current && current.pointerId === event.pointerId
        ? { ...current, dest: dest && dest !== current.orig ? dest : undefined }
        : current,
    );
  };

  const finishDrawing = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing || drawing.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    const dest = squareFromPointer(event, event.currentTarget, orientation, snapDrawings);
    const shape: XiangqiDrawShape = {
      orig: drawing.orig,
      dest: dest && dest !== drawing.orig ? dest : undefined,
      brush: drawing.brush,
    };
    onShapesChange?.(toggleShape(shapes, shape));
    setDrawing(null);
  };

  const cancelDrawing = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    setDrawing(null);
  };

  return (
    <div className={classes.boardWrap}>
      <div
        className={classes.board}
        data-theme={boardTheme}
        data-piece-style={pieceStyle}
        data-piece-inner-ring={showPieceInnerRing ? "show" : "hide"}
        style={
          {
            "--piece-text-scale": `${
              clamp(pieceTextScale, XIANGQI_PIECE_TEXT_SCALE_MIN, XIANGQI_PIECE_TEXT_SCALE_MAX) /
              100
            }`,
            "--piece-inner-size": `${clampedPieceInnerScale}%`,
            "--piece-inner-inset": `${(100 - clampedPieceInnerScale) / 2}%`,
          } as CSSProperties
        }
        onMouseDown={(event) => event.preventDefault()}
        onPointerDownCapture={startDrawing}
        onPointerMoveCapture={updateDrawing}
        onPointerUpCapture={finishDrawing}
        onPointerCancelCapture={cancelDrawing}
        onContextMenu={(event) => {
          if (drawingsEnabled) event.preventDefault();
        }}
      >
        <svg
          className={classes.gridSvg}
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <g className={classes.gridLines}>
            {[...horizontalSegments, ...verticalSegments, ...palaceSegments].map(
              ([from, to], index) => {
                const start = svgPoint(from[0], from[1], orientation);
                const end = svgPoint(to[0], to[1], orientation);
                return (
                  <line
                    key={`grid-${index}`}
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              },
            )}
          </g>
          <g className={classes.starMarks}>
            {starPoints.map(([file, rank]) => (
              <StarMark key={`${file}-${rank}`} file={file} rank={rank} orientation={orientation} />
            ))}
          </g>
        </svg>

        {visibleShapes.length > 0 && (
          <DrawShapes shapes={visibleShapes} orientation={orientation} />
        )}

        <div className={classes.river} style={riverStyle()}>
          <span>{"\u695a\u6cb3"}</span>
          <span>{"\u6c49\u754c"}</span>
        </div>

        {showLastMove && lastMove && (
          <>
            <Marker square={lastMove.from} orientation={orientation} kind="from" />
            <Marker square={lastMove.to} orientation={orientation} kind="to" />
          </>
        )}

        {showDests &&
          selectedDests.map((dest) => (
            <button
              key={dest}
              type="button"
              aria-label={`Move to ${dest}`}
              className={clsx(classes.dest, position.board.has(dest) && classes.captureDest)}
              style={pointStyle(dest, orientation)}
              onClick={() => handlePoint(dest)}
            />
          ))}

        {onPutPiece &&
          Array.from({ length: 90 }, (_, index) => {
            const sq = square(index % 9, Math.floor(index / 9));
            return (
              <button
                key={`edit-${sq}`}
                type="button"
                className={classes.editPoint}
                style={pointStyle(sq, orientation)}
                aria-label={`Edit ${sq}`}
                onClick={() => handlePoint(sq)}
              />
            );
          })}

        {Array.from(position.board.entries()).map(([sq, piece]) => (
          <button
            key={sq}
            type="button"
            className={clsx(
              classes.piece,
              piece.color === "red" ? classes.pieceRed : classes.pieceBlack,
              (selected === sq || dragging === sq) && classes.selected,
            )}
            style={pointStyle(sq, orientation)}
            onPointerDown={(event) => startPieceDrag(sq, event)}
            onPointerUp={finishPieceDrag}
            onPointerCancel={() => setDragging(null)}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              handlePoint(sq);
            }}
            onContextMenu={(event) => {
              if (onPutPiece) {
                event.preventDefault();
                onPutPiece(sq, null);
              }
            }}
            aria-label={`${piece.color} ${piece.role} on ${sq}`}
          >
            <span className={classes.pieceText}>{PIECE_LABELS[piece.color][piece.role]}</span>
          </button>
        ))}

        {showCoordinates !== "no" && (
          <Coordinates mode={showCoordinates} orientation={orientation} />
        )}
      </div>
    </div>
  );
}

function displayFile(file: number, orientation: Orientation): number {
  return orientation === "red" ? file : 8 - file;
}

function displayRank(rank: number, orientation: Orientation): number {
  return orientation === "red" ? 9 - rank : rank;
}

function pointLeft(file: number, orientation: Orientation): number {
  return GRID_PAD_X + (displayFile(file, orientation) / 8) * GRID_WIDTH;
}

function pointTop(rank: number, orientation: Orientation): number {
  return GRID_PAD_Y + (displayRank(rank, orientation) / 9) * GRID_HEIGHT;
}

function svgPoint(file: number, rank: number, orientation: Orientation): { x: number; y: number } {
  return {
    x: displayFile(file, orientation) * 100,
    y: displayRank(rank, orientation) * 100,
  };
}

function pointStyle(sq: Square, orientation: Orientation) {
  const { file, rank } = coords(sq);
  return {
    left: `${pointLeft(file, orientation)}%`,
    top: `${pointTop(rank, orientation)}%`,
  };
}

function squareFromPointer(
  event: ReactPointerEvent,
  element: HTMLElement,
  orientation: Orientation,
  snapDrawings: boolean,
): Square | null {
  const rect = element.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  const displayFileFloat = ((x - GRID_PAD_X) / GRID_WIDTH) * 8;
  const displayRankFloat = ((y - GRID_PAD_Y) / GRID_HEIGHT) * 9;
  const margin = snapDrawings ? 0.55 : 0.35;

  if (
    displayFileFloat < -margin ||
    displayFileFloat > 8 + margin ||
    displayRankFloat < -margin ||
    displayRankFloat > 9 + margin
  ) {
    return null;
  }

  const shownFile = clamp(Math.round(displayFileFloat), 0, 8);
  const shownRank = clamp(Math.round(displayRankFloat), 0, 9);
  const file = orientation === "red" ? shownFile : 8 - shownFile;
  const rank = orientation === "red" ? 9 - shownRank : shownRank;
  return square(file, rank);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function eventBrush(event: ReactPointerEvent): XiangqiDrawBrush {
  const isRightButton = event.button === 2;
  const modA = (event.shiftKey || event.ctrlKey) && isRightButton;
  const modB = event.altKey || event.metaKey || event.getModifierState?.("AltGraph");
  return DRAW_BRUSH_SEQUENCE[(modA ? 1 : 0) + (modB ? 2 : 0)];
}

function toggleShape(shapes: XiangqiDrawShape[], shape: XiangqiDrawShape): XiangqiDrawShape[] {
  const existing = shapes.find((candidate) => sameEndpoints(candidate, shape));
  if (existing) {
    return shapes.filter((candidate) => !sameEndpoints(candidate, shape));
  }
  return [...shapes, shape];
}

function sameEndpoints(a: XiangqiDrawShape, b: XiangqiDrawShape): boolean {
  return a.orig === b.orig && (a.dest ?? null) === (b.dest ?? null);
}

function DrawShapes({
  shapes,
  orientation,
}: {
  shapes: XiangqiDrawShape[];
  orientation: Orientation;
}) {
  return (
    <svg
      className={classes.drawSvg}
      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {shapes.map((shape, index) =>
        shape.dest ? (
          <DrawArrow
            key={`${shapeKey(shape)}-${index}`}
            shape={{ ...shape, dest: shape.dest }}
            orientation={orientation}
          />
        ) : (
          <DrawCircle key={`${shapeKey(shape)}-${index}`} shape={shape} orientation={orientation} />
        ),
      )}
    </svg>
  );
}

function DrawArrow({
  shape,
  orientation,
}: {
  shape: XiangqiDrawShape & { dest: Square };
  orientation: Orientation;
}) {
  const { file: fromFile, rank: fromRank } = coords(shape.orig);
  const { file: toFile, rank: toRank } = coords(shape.dest);
  const from = svgPoint(fromFile, fromRank, orientation);
  const to = svgPoint(toFile, toRank, orientation);
  const brush = brushForShape(shape);
  const strokeWidth = brush.lineWidth * 1.6;
  const geometry = arrowGeometry(from, to, strokeWidth);

  if (!geometry) {
    return <DrawCircle shape={shape} orientation={orientation} />;
  }

  return (
    <g>
      <line
        x1={geometry.start.x}
        y1={geometry.start.y}
        x2={geometry.lineEnd.x}
        y2={geometry.lineEnd.y}
        stroke={brush.color}
        strokeWidth={strokeWidth}
        strokeOpacity={brush.opacity * 0.92}
        strokeLinecap="round"
      />
      <polygon points={geometry.headPoints} fill={brush.color} fillOpacity={brush.opacity} />
    </g>
  );
}

function DrawCircle({ shape, orientation }: { shape: XiangqiDrawShape; orientation: Orientation }) {
  const { file, rank } = coords(shape.orig);
  const center = svgPoint(file, rank, orientation);
  const brush = brushForShape(shape);
  const strokeWidth = brush.lineWidth * 1.45;

  return (
    <circle
      cx={center.x}
      cy={center.y}
      r={32}
      fill="none"
      stroke={brush.color}
      strokeWidth={strokeWidth}
      opacity={brush.opacity}
    />
  );
}

function brushForShape(shape: XiangqiDrawShape) {
  const base = DRAW_BRUSHES[shape.brush ?? "green"];
  return {
    ...base,
    lineWidth: shape.modifiers?.lineWidth ?? base.lineWidth,
  };
}

function arrowGeometry(
  from: { x: number; y: number },
  to: { x: number; y: number },
  strokeWidth: number,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;

  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const endpointClearance = Math.min(8, length * 0.06);
  const startClearance = Math.min(10, length * 0.08);
  const headLength = Math.min(strokeWidth * 2.2, length * 0.28);
  const headWidth = strokeWidth * 2.55;
  const start = {
    x: from.x + ux * startClearance,
    y: from.y + uy * startClearance,
  };
  const tip = {
    x: to.x - ux * endpointClearance,
    y: to.y - uy * endpointClearance,
  };
  const base = {
    x: tip.x - ux * headLength,
    y: tip.y - uy * headLength,
  };
  const lineEnd = {
    x: tip.x - ux * headLength * 0.6,
    y: tip.y - uy * headLength * 0.6,
  };
  const left = {
    x: base.x + px * (headWidth / 2),
    y: base.y + py * (headWidth / 2),
  };
  const right = {
    x: base.x - px * (headWidth / 2),
    y: base.y - py * (headWidth / 2),
  };

  return {
    start,
    lineEnd,
    headPoints: `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`,
  };
}

function shapeKey(shape: XiangqiDrawShape): string {
  return `${shape.orig}-${shape.dest ?? "circle"}-${shape.brush ?? "green"}`;
}

function riverStyle() {
  return {
    left: `${GRID_PAD_X}%`,
    top: `${GRID_PAD_Y + (GRID_HEIGHT * 4) / 9}%`,
    width: `${GRID_WIDTH}%`,
    height: `${GRID_HEIGHT / 9}%`,
  };
}

function Coordinates({
  mode,
  orientation,
}: {
  mode: Exclude<CoordinateMode, "no">;
  orientation: Orientation;
}) {
  const showBothEdges = mode === "all";

  return (
    <>
      {Array.from({ length: 9 }, (_, file) => (
        <span
          key={`coord-file-bottom-${file}`}
          className={classes.coordinate}
          style={{
            left: `${pointLeft(file, orientation)}%`,
            bottom: "0.35rem",
            transform: "translateX(-50%)",
          }}
        >
          {String.fromCharCode("a".charCodeAt(0) + file)}
        </span>
      ))}
      {showBothEdges &&
        Array.from({ length: 9 }, (_, file) => (
          <span
            key={`coord-file-top-${file}`}
            className={classes.coordinate}
            style={{
              left: `${pointLeft(file, orientation)}%`,
              top: "0.35rem",
              transform: "translateX(-50%)",
            }}
          >
            {String.fromCharCode("a".charCodeAt(0) + file)}
          </span>
        ))}
      {Array.from({ length: 10 }, (_, rank) => (
        <span
          key={`coord-rank-left-${rank}`}
          className={classes.coordinate}
          style={{
            left: "0.35rem",
            top: `${pointTop(rank, orientation)}%`,
            transform: "translateY(-50%)",
          }}
        >
          {rank}
        </span>
      ))}
      {showBothEdges &&
        Array.from({ length: 10 }, (_, rank) => (
          <span
            key={`coord-rank-right-${rank}`}
            className={classes.coordinate}
            style={{
              right: "0.35rem",
              top: `${pointTop(rank, orientation)}%`,
              transform: "translateY(-50%)",
            }}
          >
            {rank}
          </span>
        ))}
    </>
  );
}

function Marker({
  square: sq,
  orientation,
  kind,
}: {
  square: Square;
  orientation: Orientation;
  kind: "from" | "to";
}) {
  return (
    <span
      className={clsx(classes.lastMove, kind === "from" && classes.lastMoveFrom)}
      style={pointStyle(sq, orientation)}
    />
  );
}

function StarMark({
  file,
  rank,
  orientation,
}: {
  file: number;
  rank: number;
  orientation: Orientation;
}) {
  const { x, y } = svgPoint(file, rank, orientation);
  const shownFile = displayFile(file, orientation);
  const gap = 10;
  const length = 24;
  const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];

  if (shownFile > 0) {
    segments.push(
      { x1: x - gap - length, y1: y - gap, x2: x - gap, y2: y - gap },
      { x1: x - gap, y1: y - gap - length, x2: x - gap, y2: y - gap },
      { x1: x - gap - length, y1: y + gap, x2: x - gap, y2: y + gap },
      { x1: x - gap, y1: y + gap, x2: x - gap, y2: y + gap + length },
    );
  }

  if (shownFile < 8) {
    segments.push(
      { x1: x + gap, y1: y - gap, x2: x + gap + length, y2: y - gap },
      { x1: x + gap, y1: y - gap - length, x2: x + gap, y2: y - gap },
      { x1: x + gap, y1: y + gap, x2: x + gap + length, y2: y + gap },
      { x1: x + gap, y1: y + gap, x2: x + gap, y2: y + gap + length },
    );
  }

  return (
    <g>
      {segments.map((segment, index) => (
        <line
          key={index}
          x1={segment.x1}
          y1={segment.y1}
          x2={segment.x2}
          y2={segment.y2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}
