/** Shared, dependency-free gallery geometry. Coordinates are fractions of a 1000×700 board. */
export const MIN_WIDTH = 0.04;
export const MAX_WIDTH = 0.5;
export const MAX_ITEMS = 500;
export const CARD_HEIGHT_RATIO = 8 / 7;
export const GALLERY_BACKGROUNDS = Object.freeze(['playground','meadow','zoo','ginkgo-path','autumn-lake','kindergarten-playground','classroom','sunlight', 'forest', 'sunset', 'paper']);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PRECISION = 100000;
const ITEM_KEYS = ['id', 'x', 'y', 'width', 'z'];
const OBJECT_KEYS=['aspect','rotation'];
const ceil=value=>Math.ceil(value*PRECISION)/PRECISION;
const normalizedRotation=angle=>((angle+180)%360+360)%360-180;
export function placementMetrics(item){const aspect=item.aspect??1.25,angle=(item.rotation||0)*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle)),height=item.width*10/7/aspect;return {height,rotatedWidth:item.width*(c+s/aspect),rotatedHeight:item.width*10/7*(c/aspect+s)};}
const finite = value => typeof value === 'number' && Number.isFinite(value);
const round = value => Math.round(value * PRECISION) / PRECISION;
const floor = value => Math.floor(value * PRECISION) / PRECISION;
const bounded = (value, min, max) => Math.max(min, Math.min(max, value));

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key))
    && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function validPlacement(item) {
  if(!item||typeof item!=='object'||Array.isArray(item))return false;
  const keys=Object.keys(item),allowed=[...ITEM_KEYS,...OBJECT_KEYS];
  if(!ITEM_KEYS.every(k=>Object.hasOwn(item,k))||keys.some(k=>!allowed.includes(k))||!exactKeys(item,keys))return false;
  if(Object.hasOwn(item,'aspect')&&(!finite(item.aspect)||item.aspect<.1||item.aspect>10))return false;
  if(Object.hasOwn(item,'rotation')&&(!finite(item.rotation)||item.rotation< -180||item.rotation>180))return false;
  const {height,rotatedWidth,rotatedHeight}=placementMetrics(item),cx=item.x+item.width/2,cy=item.y+height/2;
  return typeof item.id==='string'&&ID_PATTERN.test(item.id)&&finite(item.x)&&finite(item.y)&&finite(item.width)&&item.x>=0&&item.y>=0&&item.width>=MIN_WIDTH*Math.min(1,(item.aspect??1.25)/1.25)&&item.width<=MAX_WIDTH&&item.x+item.width<=1&&item.y+height<=1&&cx-rotatedWidth/2>=-1e-9&&cx+rotatedWidth/2<=1+1e-9&&cy-rotatedHeight/2>=-1e-9&&cy+rotatedHeight/2<=1+1e-9&&Number.isInteger(item.z)&&item.z>=0&&item.z<=9999;
}

/** Validate the complete wire payload. Revision/concurrency data belongs outside this object. */
export function validGallerySettings(body) {
  if (!exactKeys(body, ['background', 'items'])
    || !GALLERY_BACKGROUNDS.includes(body.background)
    || !Array.isArray(body.items) || body.items.length > MAX_ITEMS) return false;
  const ids = new Set();
  for (const item of body.items) {
    if (!validPlacement(item) || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
}

/** Return a fresh canonical placement. Invalid geometry uses safe defaults; IDs must be valid. */
export function clampPlacement(item) {
  if(!item||typeof item.id!=='string'||!ID_PATTERN.test(item.id))throw new TypeError('A gallery placement requires a valid artwork ID.');
  const hasAspect=Object.hasOwn(item,'aspect'),hasRotation=Object.hasOwn(item,'rotation'),aspect=bounded(finite(item.aspect)?item.aspect:1.25,.1,10),rotation=normalizedRotation(finite(item.rotation)?item.rotation:0),a=rotation*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));
  const minWidth=ceil(MIN_WIDTH*Math.min(1,aspect/1.25));
  const geometricMax=Math.min(MAX_WIDTH,.7*aspect,1/(c+s/aspect),.7/(c/aspect+s));
  const maxWidth=geometricMax<MAX_WIDTH?Math.max(minWidth,geometricMax-2/PRECISION):geometricMax;
  const width=Math.min(floor(maxWidth),round(bounded(finite(item.width)?item.width:.2,minWidth,maxWidth)));
  const metrics=placementMetrics({width,aspect,rotation}),padX=Math.max(0,(metrics.rotatedWidth-width)/2),padY=Math.max(0,(metrics.rotatedHeight-metrics.height)/2);
  const minX=ceil(padX),minY=ceil(padY),maxX=floor(1-width-padX),maxY=floor(1-metrics.height-padY);
  let x=bounded(round(finite(item.x)?item.x:0),minX,Math.max(minX,maxX)),y=bounded(round(finite(item.y)?item.y:0),minY,Math.max(minY,maxY));
  if(x+width>1)x=round(x-1/PRECISION);if(y+metrics.height>1)y=round(y-1/PRECISION);
  return {id:item.id,x:x||0,y:y||0,width,z:bounded(Math.round(finite(item.z)?item.z:0),0,9999),...(hasAspect?{aspect}:{}),...(hasRotation?{rotation}: {})};
}

function checkIds(ids) {
  if (!Array.isArray(ids) || ids.length > MAX_ITEMS) {
    throw new RangeError(`A gallery supports at most ${MAX_ITEMS} artwork IDs.`);
  }
  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || seen.has(id)) {
      throw new TypeError('Artwork IDs must be valid and unique.');
    }
    seen.add(id);
  }
}

/** Deterministic, non-overlapping grid for zero through 500 artworks; never mutates the input. */
export function arrangeGallery(ids) {
  checkIds(ids);
  if (!ids.length) return [];
  let best = { columns: 1, rows: ids.length, limit: 0, unused: Infinity };
  for (let columns = 1; columns <= ids.length; columns += 1) {
    const rows = Math.ceil(ids.length / columns);
    const limit = Math.min(MAX_WIDTH, 1 / columns, 1 / (rows * CARD_HEIGHT_RATIO));
    const unused = rows * columns - ids.length;
    if (limit > best.limit || (limit === best.limit && unused < best.unused)) {
      best = { columns, rows, limit, unused };
    }
  }
  const gutter = Math.min(0.025, Math.max(0, (best.limit - MIN_WIDTH) * 0.35));
  const width = Math.max(MIN_WIDTH, floor(best.limit - gutter));
  const height = width * CARD_HEIGHT_RATIO;
  return ids.map((id, index) => clampPlacement({
    id,
    x: (index % best.columns + 0.5) / best.columns - width / 2,
    y: (Math.floor(index / best.columns) + 0.5) / best.rows - height / 2,
    width,
    z: index,
  }));
}

// Collision tests use a common physical coordinate space: board width 1, height .7.
// The public y coordinate remains a fraction of the board height.
const COLLISION_EPSILON = 1e-10;
const INSERT_WIDTHS = Object.freeze([0.14, 0.12, 0.1, 0.08, 0.064, 0.05, MIN_WIDTH]);

function collisionShape(item) {
  const aspect = item.aspect ?? 1.25;
  const angle = (item.rotation || 0) * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  const halfWidth = item.width / 2, halfHeight = item.width / aspect / 2;
  return {
    cx: item.x + halfWidth,
    cy: item.y * .7 + halfHeight,
    halfWidth, halfHeight,
    axes: [[c, s], [-s, c]],
    extentX: Math.abs(c) * halfWidth + Math.abs(s) * halfHeight,
    extentY: Math.abs(s) * halfWidth + Math.abs(c) * halfHeight,
  };
}

function shapesOverlap(a, b) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  if (Math.abs(dx) >= a.extentX + b.extentX - COLLISION_EPSILON
    || Math.abs(dy) >= a.extentY + b.extentY - COLLISION_EPSILON) return false;
  // Separating-axis theorem, including both rectangles' rotated axes.
  for (const [x, y] of [...a.axes, ...b.axes]) {
    const ra = a.halfWidth * Math.abs(x * a.axes[0][0] + y * a.axes[0][1])
      + a.halfHeight * Math.abs(x * a.axes[1][0] + y * a.axes[1][1]);
    const rb = b.halfWidth * Math.abs(x * b.axes[0][0] + y * b.axes[0][1])
      + b.halfHeight * Math.abs(x * b.axes[1][0] + y * b.axes[1][1]);
    if (Math.abs(dx * x + dy * y) >= ra + rb - COLLISION_EPSILON) return false;
  }
  return true;
}

/** Rotation-aware rectangle overlap. Existing intentional overlaps remain untouched. */
export function placementsOverlap(a, b) {
  return shapesOverlap(collisionShape(a), collisionShape(b));
}

function gridSlots(width) {
  const columns = Math.floor(1 / width);
  const rows = Math.floor(1 / (width * CARD_HEIGHT_RATIO));
  const slots = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      slots.push({
        x: (column + 0.5) / columns - width / 2,
        y: (row + 0.5) / rows - width * CARD_HEIGHT_RATIO / 2,
        width,
      });
    }
  }
  return slots;
}

// Grid candidates are fixed, independent of the number or timing of arrivals.
const INSERT_GRIDS = INSERT_WIDTHS.map(width => gridSlots(width));

function sampledEdges(values) {
  const sorted = [...values].sort((a, b) => a - b);
  // Bound custom-layout work: 64 × 64 edge candidates per width, including both board edges.
  // Regular grid candidates are always exhaustive; contact search samples the remaining gaps.
  if (sorted.length <= 64) return sorted;
  return Array.from({ length: 64 }, (_, index) => sorted[Math.round(index * (sorted.length - 1) / 63)]);
}

function findInsertion(id, z, occupied) {
  for (let index = 0; index < INSERT_WIDTHS.length; index += 1) {
    const width = INSERT_WIDTHS[index];
    const trySlot = slot => {
      const placement = clampPlacement({ id, ...slot, z });
      const shape = collisionShape(placement);
      return occupied.some(other => shapesOverlap(shape, other)) ? null : { placement, shape };
    };
    for (const slot of INSERT_GRIDS[index]) {
      const found = trySlot(slot);
      if (found) return found;
    }
    // Custom layouts can leave useful gaps between the regular grid positions.
    // Try board edges and obstacle bounding-box contacts in deterministic reading order.
    // Bounding boxes propose candidates only; SAT still determines real collisions.
    const xs = new Set([0, floor(1 - width)]);
    const height = width * CARD_HEIGHT_RATIO;
    const ys = new Set([0, floor(1 - height)]);
    for (const other of occupied) {
      for (const x of [floor(other.cx - other.extentX - width), ceil(other.cx + other.extentX)]) {
        if (x >= 0 && x <= 1 - width) xs.add(x);
      }
      for (const y of [floor((other.cy - other.extentY) / .7 - height), ceil((other.cy + other.extentY) / .7)]) {
        if (y >= 0 && y <= 1 - height) ys.add(y);
      }
    }
    for (const y of sampledEdges(ys)) {
      for (const x of sampledEdges(xs)) {
        const found = trySlot({ x, y, width });
        if (found) return found;
      }
    }
  }
  return null;
}

/**
 * Visible projection only: keep original savedItems in storage so hidden work can return.
 * Retained valid placements are copied exactly, in saved order, including intentional overlaps.
 * New IDs are considered in supplied order; every insertion is independent of the final count.
 * Search fixed normalized grids, shrinking only the new item, then try edge-aligned gaps.
 * No fallback ever overlaps an existing item. If no supported slot fits, return overflow IDs
 * for a visible waiting tray. This is a packing search, not proof that no geometric packing exists.
 * A teacher may explicitly auto-arrange to fit up to 500; insertion never moves their work.
 */
export function reconcileGalleryWithOverflow(savedItems, approvedIds) {
  checkIds(approvedIds);
  if (!Array.isArray(savedItems)) throw new TypeError('Saved gallery items must be an array.');
  const approved = new Set(approvedIds);
  const retained = new Set();
  const items = [];
  for (const item of savedItems) {
    if (validPlacement(item) && approved.has(item.id) && !retained.has(item.id)) {
      items.push({ ...item });
      retained.add(item.id);
    }
  }
  const newIds = approvedIds.filter(id => !retained.has(id));
  const occupied = items.map(collisionShape);
  let nextZ = Math.min(9999, Math.max(-1, ...items.map(item => item.z)) + 1);
  for (let index = 0; index < newIds.length; index += 1) {
    const found = findInsertion(newIds[index], nextZ, occupied);
    // All new items share the same default cell geometry. Once this geometry cannot fit,
    // later IDs cannot fit either, so retain their input order in a single overflow result.
    if (!found) return { items, overflowIds: newIds.slice(index) };
    items.push(found.placement);
    occupied.push(found.shape);
    nextZ = Math.min(9999, nextZ + 1);
  }
  return { items, overflowIds: [] };
}

/** Items-only projection. Call reconcileGalleryWithOverflow to show the waiting tray. */
export function reconcileGallery(savedItems, approvedIds) {
  return reconcileGalleryWithOverflow(savedItems, approvedIds).items;
}
export const galleryHeight=(width,aspect=1.25)=>width*10/7/aspect;
export function mergeGalleryItems(saved,updated){const byId=new Map(saved.map(i=>[i.id,i]));for(const item of updated)byId.set(item.id,item);return [...byId.values()];}

/** Fit a newly cropped object inside its existing legacy/auto-arranged cell. */
export function fitObjectPlacement(item,aspect){
 const ratio=bounded(finite(aspect)?aspect:1.25,.1,10);
 if(Object.hasOwn(item,'aspect'))return clampPlacement({...item,aspect:ratio,rotation:item.rotation||0});
 const oldHeight=galleryHeight(item.width),width=item.width*Math.min(1,ratio/1.25),height=galleryHeight(width,ratio);
 return clampPlacement({...item,x:item.x+(item.width-width)/2,y:item.y+(oldHeight-height)/2,width,aspect:ratio,rotation:0});
}
