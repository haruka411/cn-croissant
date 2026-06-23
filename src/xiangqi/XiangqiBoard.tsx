import clsx from "clsx";
import {
  useEffect,
  useMemo,
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
  type XiangqiColor,
  type XiangqiDrawBrush,
  type XiangqiDrawShape,
  type XiangqiPiece,
  type XiangqiMove,
  type XiangqiPosition,
} from "./xiangqi";
import classes from "./XiangqiBoard.module.css";
import { customPieceKey, type CustomPieceUrls } from "./customPieceTheme";
import {
  CUSTOM_BOARD_REFERENCE_CELL_SIZE,
  CUSTOM_BOARD_REFERENCE_HEIGHT,
  CUSTOM_BOARD_REFERENCE_ORIGIN_X,
  CUSTOM_BOARD_REFERENCE_ORIGIN_Y,
  CUSTOM_BOARD_REFERENCE_WIDTH,
  DEFAULT_CUSTOM_BOARD_CALIBRATION,
  type CustomBoardCalibration,
} from "./customBoardTheme";
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
  | "crystal"
  | "custom-png";
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
  | "crystal"
  | "custom-svg";
export type MoveMethod = "drag" | "select" | "both";
export type CoordinateDisplay = "no" | "edge" | "all";

const BUILTIN_GRID_PAD_X = 8;
const BUILTIN_GRID_PAD_Y = 7;
const BUILTIN_GRID_WIDTH = 84;
const BUILTIN_GRID_HEIGHT = 86;
const SVG_WIDTH = 800;
const SVG_HEIGHT = 900;
const XIANGQI_FILES = Array.from({ length: 9 }, (_, index) => index);
const XIANGQI_RANKS = Array.from({ length: 10 }, (_, index) => index);
const RED_FILE_LABELS = ["九", "八", "七", "六", "五", "四", "三", "二", "一"];
const BLACK_FILE_LABELS = ["１", "２", "３", "４", "５", "６", "７", "８", "９"];

type BoardLayout = {
  padX: number;
  padY: number;
  width: number;
  height: number;
};

const BUILTIN_BOARD_LAYOUT: BoardLayout = {
  padX: BUILTIN_GRID_PAD_X,
  padY: BUILTIN_GRID_PAD_Y,
  width: BUILTIN_GRID_WIDTH,
  height: BUILTIN_GRID_HEIGHT,
};
const CUSTOM_PNG_BOARD_LAYOUT: BoardLayout = {
  padX: 50 - (4 * CUSTOM_BOARD_REFERENCE_CELL_SIZE * 100) / CUSTOM_BOARD_REFERENCE_WIDTH,
  padY: 50 - (4.5 * CUSTOM_BOARD_REFERENCE_CELL_SIZE * 100) / CUSTOM_BOARD_REFERENCE_HEIGHT,
  width: (8 * CUSTOM_BOARD_REFERENCE_CELL_SIZE * 100) / CUSTOM_BOARD_REFERENCE_WIDTH,
  height: (9 * CUSTOM_BOARD_REFERENCE_CELL_SIZE * 100) / CUSTOM_BOARD_REFERENCE_HEIGHT,
};
const DRAW_BRUSH_SEQUENCE: XiangqiDrawBrush[] = ["green", "red", "blue", "yellow"];
const customBoardImageSizeCache = new Map<string, { width: number; height: number }>();
const DRAW_BRUSHES: Record<
  XiangqiDrawBrush,
  { key: string; color: string; opacity: number; lineWidth: number }
> = {
  green: { key: "g", color: "#15781b", opacity: 1, lineWidth: 10 },
  red: { key: "r", color: "#882020", opacity: 1, lineWidth: 10 },
  blue: { key: "b", color: "#003088", opacity: 1, lineWidth: 10 },
  yellow: { key: "y", color: "#e68f00", opacity: 1, lineWidth: 10 },
  paleGreen: { key: "pg", color: "#15781b", opacity: 0.4, lineWidth: 15 },
  paleRed: { key: "pr", color: "#882020", opacity: 0.4, lineWidth: 15 },
  paleBlue: { key: "pb", color: "#003088", opacity: 0.4, lineWidth: 15 },
  silver: { key: "s", color: "#f8fafc", opacity: 0.98, lineWidth: 10 },
  variation: { key: "v", color: "#9b59b6", opacity: 0.8, lineWidth: 10 },
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
  customBoardImageUrl,
  customBoardCalibration = DEFAULT_CUSTOM_BOARD_CALIBRATION,
  customPieceUrls,
  customPieceScale = 100,
  shapes = [],
  autoShapes = [],
  showDests = true,
  showLastMove = true,
  coordinates = "no",
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
  customBoardImageUrl?: string;
  customBoardCalibration?: CustomBoardCalibration;
  customPieceUrls?: CustomPieceUrls;
  customPieceScale?: number;
  shapes?: XiangqiDrawShape[];
  autoShapes?: XiangqiDrawShape[];
  showDests?: boolean;
  showLastMove?: boolean;
  coordinates?: CoordinateDisplay;
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
  const [customBoardImageSize, setCustomBoardImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const dests = useMemo(() => legalDests(position), [position]);
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
  const boardLayout =
    boardTheme === "custom-png"
      ? customPngBoardLayout(customBoardCalibration, customBoardImageSize)
      : BUILTIN_BOARD_LAYOUT;
  const customBoardBackground = customBoardImageUrl
    ? `url("${customBoardImageUrl.replace(/"/g, '\\"')}")`
    : undefined;

  useEffect(() => {
    if (boardTheme !== "custom-png" || !customBoardImageUrl) {
      setCustomBoardImageSize(null);
      return;
    }

    const cachedSize = customBoardImageSizeCache.get(customBoardImageUrl);
    if (cachedSize) {
      setCustomBoardImageSize(cachedSize);
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
      const size = {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      customBoardImageSizeCache.set(customBoardImageUrl, size);
      setCustomBoardImageSize(size);
    };
    image.onerror = () => {
      if (!cancelled) setCustomBoardImageSize(null);
    };
    image.src = customBoardImageUrl;

    return () => {
      cancelled = true;
    };
  }, [boardTheme, customBoardImageUrl]);

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
    const target = board ? squareFromPointer(event, board, orientation, true, boardLayout) : null;
    const legalTargets = dests.get(dragging) ?? [];

    if (target && legalTargets.includes(target)) {
      suppressClick.current = true;
      onMove({ from: dragging, to: target });
    }
    setDragging(null);
  };

  const startDrawing = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingsEnabled || !onShapesChange || (event.button !== 2 && !event.shiftKey)) return;

    const orig = squareFromPointer(
      event,
      event.currentTarget,
      orientation,
      snapDrawings,
      boardLayout,
    );
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
    const dest = squareFromPointer(
      event,
      event.currentTarget,
      orientation,
      snapDrawings,
      boardLayout,
    );
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
    const dest = squareFromPointer(
      event,
      event.currentTarget,
      orientation,
      snapDrawings,
      boardLayout,
    );
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
    <div className={classes.boardWrap} data-theme={boardTheme}>
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
            "--custom-piece-size": `${clamp(customPieceScale, 80, 120)}%`,
            "--grid-pad-x": `${boardLayout.padX}%`,
            "--grid-pad-y": `${boardLayout.padY}%`,
            "--grid-width": `${boardLayout.width}%`,
            "--grid-height": `${boardLayout.height}%`,
            "--piece-size": `${boardLayout.width / 8}%`,
            backgroundImage: customBoardBackground,
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

        <div className={classes.river} style={riverStyle(boardLayout)}>
          <span>{"\u695a\u6cb3"}</span>
          <span>{"\u6c49\u754c"}</span>
        </div>

        {coordinates !== "no" && (
          <XiangqiCoordinates orientation={orientation} layout={boardLayout} mode={coordinates} />
        )}

        {showLastMove && lastMove && (
          <>
            <Marker
              square={lastMove.from}
              orientation={orientation}
              layout={boardLayout}
              kind="from"
            />
            <Marker square={lastMove.to} orientation={orientation} layout={boardLayout} kind="to" />
          </>
        )}

        {showDests &&
          selectedDests.map((dest) => (
            <button
              key={dest}
              type="button"
              aria-label={`Move to ${dest}`}
              className={clsx(classes.dest, position.board.has(dest) && classes.captureDest)}
              style={pointStyle(dest, orientation, boardLayout)}
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
                style={pointStyle(sq, orientation, boardLayout)}
                aria-label={`Edit ${sq}`}
                onClick={() => handlePoint(sq)}
              />
            );
          })}

        {Array.from(position.board.entries()).map(([sq, piece]) => {
          const customPieceSrc =
            pieceStyle === "custom-svg"
              ? customPieceUrls?.[customPieceKey(piece.color, piece.role)]
              : undefined;

          return (
            <button
              key={sq}
              type="button"
              className={clsx(
                classes.piece,
                piece.color === "red" ? classes.pieceRed : classes.pieceBlack,
                (selected === sq || dragging === sq) && classes.selected,
              )}
              style={pointStyle(sq, orientation, boardLayout)}
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
              {customPieceSrc ? (
                <img
                  src={customPieceSrc}
                  className={classes.customPieceImage}
                  draggable={false}
                  alt=""
                />
              ) : pieceStyle === "custom-svg" ? null : (
                <span className={classes.pieceText}>{PIECE_LABELS[piece.color][piece.role]}</span>
              )}
            </button>
          );
        })}
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

function pointLeft(file: number, orientation: Orientation, layout: BoardLayout): number {
  return layout.padX + (displayFile(file, orientation) / 8) * layout.width;
}

function pointTop(rank: number, orientation: Orientation, layout: BoardLayout): number {
  return layout.padY + (displayRank(rank, orientation) / 9) * layout.height;
}

function svgPoint(file: number, rank: number, orientation: Orientation): { x: number; y: number } {
  return {
    x: displayFile(file, orientation) * 100,
    y: displayRank(rank, orientation) * 100,
  };
}

function pointStyle(sq: Square, orientation: Orientation, layout: BoardLayout) {
  const { file, rank } = coords(sq);
  return {
    left: `${pointLeft(file, orientation, layout)}%`,
    top: `${pointTop(rank, orientation, layout)}%`,
  };
}

function squareFromPointer(
  event: ReactPointerEvent,
  element: HTMLElement,
  orientation: Orientation,
  snapDrawings: boolean,
  layout: BoardLayout,
): Square | null {
  const rect = element.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  const displayFileFloat = ((x - layout.padX) / layout.width) * 8;
  const displayRankFloat = ((y - layout.padY) / layout.height) * 9;
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

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function customPngBoardLayout(
  calibration: CustomBoardCalibration,
  imageSize: { width: number; height: number } | null,
): BoardLayout {
  if (!imageSize) return CUSTOM_PNG_BOARD_LAYOUT;

  const mode = calibration.mode ?? DEFAULT_CUSTOM_BOARD_CALIBRATION.mode;
  const imageWidth = imageSize.width;
  const imageHeight = imageSize.height;
  const heightScale = imageHeight / CUSTOM_BOARD_REFERENCE_HEIGHT;
  const scale =
    mode === "scale"
      ? finiteOr(calibration.scale, DEFAULT_CUSTOM_BOARD_CALIBRATION.scale) / 100
      : 1;
  const cellSize =
    mode === "manual"
      ? finiteOr(calibration.cellSize, CUSTOM_BOARD_REFERENCE_CELL_SIZE)
      : CUSTOM_BOARD_REFERENCE_CELL_SIZE * heightScale * scale;
  const originX =
    mode === "manual"
      ? finiteOr(calibration.originX, CUSTOM_BOARD_REFERENCE_ORIGIN_X)
      : imageWidth / 2 - 4 * cellSize;
  const originY =
    mode === "manual"
      ? finiteOr(calibration.originY, CUSTOM_BOARD_REFERENCE_ORIGIN_Y)
      : imageHeight / 2 - 4.5 * cellSize;
  const renderScale = CUSTOM_BOARD_REFERENCE_HEIGHT / imageHeight;
  const renderedImageWidth = imageWidth * renderScale;
  const imageLeft = (CUSTOM_BOARD_REFERENCE_WIDTH - renderedImageWidth) / 2;
  const renderedCellSize = cellSize * renderScale;

  return {
    padX: ((imageLeft + originX * renderScale) / CUSTOM_BOARD_REFERENCE_WIDTH) * 100,
    padY: ((originY * renderScale) / CUSTOM_BOARD_REFERENCE_HEIGHT) * 100,
    width: ((8 * renderedCellSize) / CUSTOM_BOARD_REFERENCE_WIDTH) * 100,
    height: ((9 * renderedCellSize) / CUSTOM_BOARD_REFERENCE_HEIGHT) * 100,
  };
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
      <defs>
        {Object.values(DRAW_BRUSHES).map((brush) => (
          <marker
            id={arrowMarkerId(brush.key)}
            key={brush.key}
            orient="auto"
            overflow="visible"
            markerWidth={4}
            markerHeight={4}
            refX={2.05}
            refY={2}
          >
            <path
              d="M0,0 V4 L3,2 Z"
              fill={brush.color}
              stroke={brush.key === "s" ? "#1f2937" : undefined}
              strokeWidth={brush.key === "s" ? 0.55 : undefined}
              strokeOpacity={brush.key === "s" ? 0.58 : undefined}
              strokeLinejoin="round"
              paintOrder="stroke"
            />
          </marker>
        ))}
      </defs>
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
  const geometry = arrowGeometry(from, to);

  if (!geometry) {
    return <DrawCircle shape={shape} orientation={orientation} />;
  }

  const outlineWidth = shape.modifiers?.outlineWidth ?? 0;
  const outlineColor = shape.modifiers?.outlineColor ?? "#111827";
  const outlineOpacity = shape.modifiers?.outlineOpacity ?? 0.45;

  return (
    <>
      {shape.modifiers?.glow && (
        <line
          x1={geometry.start.x}
          y1={geometry.start.y}
          x2={geometry.end.x}
          y2={geometry.end.y}
          stroke={brush.color}
          strokeWidth={strokeWidth + 14}
          strokeLinecap="round"
          opacity={0.22}
        />
      )}
      {outlineWidth > 0 && (
        <line
          x1={geometry.start.x}
          y1={geometry.start.y}
          x2={geometry.end.x}
          y2={geometry.end.y}
          stroke={outlineColor}
          strokeWidth={strokeWidth + outlineWidth}
          strokeLinecap="round"
          opacity={outlineOpacity}
        />
      )}
      <line
        x1={geometry.start.x}
        y1={geometry.start.y}
        x2={geometry.end.x}
        y2={geometry.end.y}
        stroke={brush.color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        markerEnd={`url(#${arrowMarkerId(brush.key)})`}
        opacity={brush.opacity}
      />
    </>
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
    opacity: shape.modifiers?.opacity ?? base.opacity,
  };
}

function arrowGeometry(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;

  const ux = dx / length;
  const uy = dy / length;
  const endpointClearance = Math.min(8, length * 0.06);
  const startClearance = Math.min(10, length * 0.08);
  const start = {
    x: from.x + ux * startClearance,
    y: from.y + uy * startClearance,
  };
  const end = {
    x: to.x - ux * endpointClearance,
    y: to.y - uy * endpointClearance,
  };

  return {
    start,
    end,
  };
}

function arrowMarkerId(key: string): string {
  return `xiangqi-arrowhead-${key}`;
}

function shapeKey(shape: XiangqiDrawShape): string {
  return `${shape.orig}-${shape.dest ?? "circle"}-${shape.brush ?? "green"}`;
}

function riverStyle(layout: BoardLayout) {
  return {
    left: `${layout.padX}%`,
    top: `${layout.padY + (layout.height * 4) / 9}%`,
    width: `${layout.width}%`,
    height: `${layout.height / 9}%`,
  };
}

function XiangqiCoordinates({
  orientation,
  layout,
  mode,
}: {
  orientation: Orientation;
  layout: BoardLayout;
  mode: Exclude<CoordinateDisplay, "no">;
}) {
  const topColor: XiangqiColor = orientation === "red" ? "black" : "red";
  const bottomColor: XiangqiColor = orientation === "red" ? "red" : "black";
  const topY = clamp(layout.padY / 2, 2.2, 97.8);
  const bottomY = clamp(
    layout.padY + layout.height + (100 - layout.padY - layout.height) / 2,
    2.2,
    97.8,
  );

  return (
    <>
      {XIANGQI_FILES.map((file) => (
        <span
          key={`coord-top-${file}`}
          className={clsx(classes.coordinate, classes.coordinateEdge)}
          style={{ left: `${pointLeft(file, orientation, layout)}%`, top: `${topY}%` }}
        >
          {xiangqiFileLabel(file, topColor)}
        </span>
      ))}
      {XIANGQI_FILES.map((file) => (
        <span
          key={`coord-bottom-${file}`}
          className={clsx(classes.coordinate, classes.coordinateEdge)}
          style={{ left: `${pointLeft(file, orientation, layout)}%`, top: `${bottomY}%` }}
        >
          {xiangqiFileLabel(file, bottomColor)}
        </span>
      ))}
      {mode === "all" &&
        XIANGQI_RANKS.flatMap((rank) =>
          XIANGQI_FILES.map((file) => {
            const sq = square(file, rank);
            return (
              <span
                key={`coord-point-${sq}`}
                className={clsx(classes.coordinate, classes.coordinatePoint)}
                style={pointStyle(sq, orientation, layout)}
              >
                {sq}
              </span>
            );
          }),
        )}
    </>
  );
}

function xiangqiFileLabel(file: number, color: XiangqiColor): string {
  return color === "red" ? (RED_FILE_LABELS[file] ?? "") : (BLACK_FILE_LABELS[file] ?? "");
}

function Marker({
  square: sq,
  orientation,
  layout,
  kind,
}: {
  square: Square;
  orientation: Orientation;
  layout: BoardLayout;
  kind: "from" | "to";
}) {
  return (
    <span
      className={clsx(classes.lastMove, kind === "from" && classes.lastMoveFrom)}
      style={pointStyle(sq, orientation, layout)}
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
