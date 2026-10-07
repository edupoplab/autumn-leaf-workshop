// DOM-free board geometry. Only addStrokePoint mutates its stroke.points array.
const BOARD_WIDTH = 1000;
const BOARD_HEIGHT = 700;
const MIN_PAIR_DISTANCE = 8;
const MAX_STROKE_POINTS = 512;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isPoint = point => point != null && Number.isFinite(point.x) && Number.isFinite(point.y);
const normalizeDegrees = degrees => ((degrees + 180) % 360 + 360) % 360 - 180;

/**
 * Apply a two-pointer gesture to the shape captured at gesture start.
 * Pass the same starting shape and starting pair for every gesture update.
 * Invalid or nearly coincident pairs are ignored (the original shape is returned).
 * The effective, clamped scale is used to keep the midpoint pivot anchored.
 * Clamping the resulting center to the board can necessarily move that pivot.
 */
export function transformFromPair(shape, startA, startB, currentA, currentB) {
  if (!shape || !Number.isFinite(shape.x) || !Number.isFinite(shape.y) ||
      !Number.isFinite(shape.scale) || shape.scale <= 0 || !Number.isFinite(shape.rotation) ||
      ![startA, startB, currentA, currentB].every(isPoint)) return shape;

  const startDX = startB.x - startA.x;
  const startDY = startB.y - startA.y;
  const currentDX = currentB.x - currentA.x;
  const currentDY = currentB.y - currentA.y;
  const startDistance = Math.hypot(startDX, startDY);
  const currentDistance = Math.hypot(currentDX, currentDY);
  if (!Number.isFinite(startDistance) || !Number.isFinite(currentDistance) ||
      startDistance < MIN_PAIR_DISTANCE || currentDistance < MIN_PAIR_DISTANCE) return shape;

  const deltaDegrees = normalizeDegrees(
    (Math.atan2(currentDY, currentDX) - Math.atan2(startDY, startDX)) * 180 / Math.PI
  );
  const radians = deltaDegrees * Math.PI / 180;
  const scale = clamp(shape.scale * currentDistance / startDistance, 0.25, 3);
  const ratio = scale / shape.scale;
  // Half sums avoid overflow from adding two large, finite coordinates.
  const startMidX = startA.x / 2 + startB.x / 2;
  const startMidY = startA.y / 2 + startB.y / 2;
  const currentMidX = currentA.x / 2 + currentB.x / 2;
  const currentMidY = currentA.y / 2 + currentB.y / 2;
  const offsetX = shape.x - startMidX;
  const offsetY = shape.y - startMidY;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = currentMidX + ratio * (offsetX * cos - offsetY * sin);
  const y = currentMidY + ratio * (offsetX * sin + offsetY * cos);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(ratio)) return shape;

  return {
    ...shape,
    x: clamp(x, 0, BOARD_WIDTH),
    y: clamp(y, 0, BOARD_HEIGHT),
    scale,
    rotation: normalizeDegrees(shape.rotation + deltaDegrees)
  };
}

function pointSegmentDistanceSquared(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : clamp(
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1
  );
  const offsetX = point.x - (a.x + t * dx);
  const offsetY = point.y - (a.y + t * dy);
  return offsetX * offsetX + offsetY * offsetY;
}

function cross(a, b, p) {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function withinSegmentBounds(point, a, b) {
  return point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) &&
    point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y);
}

function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC < 0 && abD > 0) || (abC > 0 && abD < 0)) &&
      ((cdA < 0 && cdB > 0) || (cdA > 0 && cdB < 0))) return true;
  return (abC === 0 && withinSegmentBounds(c, a, b)) ||
    (abD === 0 && withinSegmentBounds(d, a, b)) ||
    (cdA === 0 && withinSegmentBounds(a, c, d)) ||
    (cdB === 0 && withinSegmentBounds(b, c, d));
}

function segmentDistanceSquared(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistanceSquared(a, c, d),
    pointSegmentDistanceSquared(b, c, d),
    pointSegmentDistanceSquared(c, a, b),
    pointSegmentDistanceSquared(d, a, b)
  );
}

/**
 * Whole-stroke eraser: remove any stroke touched by the swept eraser capsule.
 * The contact distance includes the pencil's half-width; sparse segments count.
 * Empty/malformed entries and non-stroke objects (such as leaves) are retained.
 * Only call this on art.strokes; never replace art.shapes with its result.
 */
export function eraseStrokes(strokes, from, to, radius) {
  if (!Array.isArray(strokes)) return strokes;
  if (!isPoint(from) || !isPoint(to) || !Number.isFinite(radius) || radius < 0) return strokes;
  return strokes.filter(stroke => {
    if (!Array.isArray(stroke?.points) || stroke.points.length === 0) return true;
    const points = stroke.points;
    const width = Number.isFinite(stroke.width) ? Math.max(0, stroke.width) : 0;
    const contactDistanceSquared = (radius + width / 2) ** 2;
    if (points.length === 1) {
      return !isPoint(points[0]) ||
        pointSegmentDistanceSquared(points[0], from, to) > contactDistanceSquared;
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (isPoint(a) && isPoint(b) &&
          segmentDistanceSquared(a, b, from, to) <= contactDistanceSquared) return false;
    }
    return true;
  });
}

/**
 * Append one integer, board-clamped point in place; return true if appended.
 * Return false for invalid points or points less than two world units apart.
 * At 512 points, stop without truncation, overwriting, or reshaping the stroke.
 */
export function addStrokePoint(stroke, point) {
  if (!Array.isArray(stroke?.points) || !isPoint(point) ||
      stroke.points.length >= MAX_STROKE_POINTS) return false;
  const next = {
    x: clamp(Math.round(point.x), 0, BOARD_WIDTH),
    y: clamp(Math.round(point.y), 0, BOARD_HEIGHT)
  };
  const previous = stroke.points[stroke.points.length - 1];
  if (previous && (!isPoint(previous) || Math.hypot(next.x - previous.x, next.y - previous.y) < 2)) {
    return false;
  }
  stroke.points.push(next);
  return true;
}
