import {assetUrl} from './paths.js';
import {artPreview} from './art.js';

// Browser-only, local export. No artwork or title is sent to a server.
export const EXPORT_WIDTH = 2000;
export const EXPORT_HEIGHT = 1400;
export const MAX_EXPORT_RECORDS = 500;
export const MAX_EXPORT_BYTES = 512 * 1024 * 1024;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ATLAS_PATH = assetUrl('playtable/material-atlas.webp');
const TIMEOUT_MS = 30000;
const encoder = new TextEncoder();
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const pad = (number, length = 2) => String(number).padStart(length, '0');

function checkedDate(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('다운로드 날짜를 확인해 주세요.');
  return date;
}

export function exportTimestamp(date = new Date()) {
  checkedDate(date);
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export function sanitizeArtworkTitle(title) {
  let safe = String(title ?? '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_').trim().replace(/\s+/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '');
  safe = Array.from(safe).slice(0, 50).join('');
  while (encoder.encode(safe).length > 160) safe = Array.from(safe).slice(0, -1).join('');
  safe = safe.replace(/[. ]+$/g, '') || '작품';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = `_${safe}`;
  return safe;
}

export function artworkFilename(title, index, date = new Date()) {
  if (!Number.isInteger(index) || index < 1 || index > MAX_EXPORT_RECORDS) throw new Error('작품 순서가 올바르지 않아요.');
  return `${exportTimestamp(date)}_${sanitizeArtworkTitle(title)}_${pad(index, 3)}.png`;
}

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('다운로드를 취소했어요.', 'AbortError');
}

function decodeImage(source, {signal, ImageClass = globalThis.Image} = {}) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const image = new ImageClass();
    let timer;
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      image.onload = image.onerror = null;
      if (error) { image.src = ''; reject(error); }
      else if (!image.naturalWidth || !image.naturalHeight) reject(new Error('작품 이미지를 읽을 수 없어요.'));
      else resolve(image);
    };
    const abort = () => finish(new DOMException('다운로드를 취소했어요.', 'AbortError'));
    signal?.addEventListener('abort', abort, {once: true});
    timer = setTimeout(() => finish(new Error('작품 이미지를 읽는 시간이 너무 길어요. 다시 시도해 주세요.')), TIMEOUT_MS);
    image.onerror = () => finish(new Error('작품에 필요한 이미지를 읽지 못했어요. 다운로드를 다시 시도해 주세요.'));
    image.onload = () => { if (typeof image.decode !== 'function') finish(); };
    image.src = source;
    if (typeof image.decode === 'function') image.decode().then(() => finish(), () => finish(new Error('작품에 필요한 이미지를 해석하지 못했어요.')));
  });
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('재료 사진을 파일에 담지 못했어요.'));
    reader.onabort = () => reject(new Error('재료 사진 읽기가 중단되었어요.'));
    reader.readAsDataURL(blob);
  });
}

// The only network request allowed by this helper is the site's static atlas.
export function createArtworkResourceLoader({fetchImpl = globalThis.fetch, baseUrl = globalThis.location?.href, atlasPath = ATLAS_PATH, signal, decode = decodeImage, toDataUrl = blobDataUrl} = {}) {
  let atlasPromise;
  return async (href) => {
    checkAbort(signal);
    const base = new URL(baseUrl);
    const url = new URL(href, base);
    const expected = new URL(atlasPath, base);
    if (expected.origin !== base.origin || expected.search || expected.hash || expected.username || expected.password || !/^\/(?:[A-Za-z0-9_-]+\/)*playtable\/material-atlas\.webp$/.test(expected.pathname)) throw new Error('Invalid atlas path');
    if (!['http:', 'https:'].includes(base.protocol) || url.origin !== base.origin || url.pathname !== expected.pathname || url.search || url.hash || url.username || url.password) {
      throw new Error('사이트 밖의 이미지는 작품 파일에 담을 수 없어요.');
    }
    if (!atlasPromise) atlasPromise = (async () => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, {once: true});
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetchImpl(url.href, {mode: 'same-origin', credentials: 'same-origin', redirect: 'error', signal: controller.signal});
        if (!response.ok || response.redirected || (response.url && response.url !== url.href)) throw new Error('재료 사진을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
        const blob = await response.blob();
        if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error('재료 사진 파일이 올바르지 않아요.');
        const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
        if (String.fromCharCode(...header.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...header.slice(8, 12)) !== 'WEBP') throw new Error('재료 사진 파일이 올바르지 않아요.');
        const dataUrl = await toDataUrl(new Blob([blob], {type: 'image/webp'}));
        if (!/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)) throw new Error('재료 사진을 파일에 담지 못했어요.');
        await decode(dataUrl, {signal});
        checkAbort(signal);
        return dataUrl;
      } catch (error) {
        checkAbort(signal);
        if (error.name === 'AbortError') throw new Error('재료 사진을 불러오는 시간이 너무 길어요. 다시 시도해 주세요.');
        throw error;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
      }
    })();
    return atlasPromise;
  };
}

const ALLOWED_ELEMENTS = new Set(['svg', 'g', 'defs', 'rect', 'path', 'image', 'clipPath', 'filter', 'feColorMatrix', 'mask', 'circle', 'polygon']);

export async function embedArtworkResources(original, {loadResource = createArtworkResourceLoader(), signal} = {}) {
  checkAbort(signal);
  const svg = original.cloneNode(true);
  const elements = [svg, ...svg.querySelectorAll('*')];
  for (const element of elements) {
    if (element.namespaceURI !== SVG_NS || !ALLOWED_ELEMENTS.has(element.localName)) throw new Error('지원하지 않는 그림 요소가 있어 다운로드를 멈췄어요.');
    for (const attribute of element.attributes) {
      const name = attribute.name;
      if (/^on/i.test(name) || name === 'style' || name === 'xml:base') throw new Error('안전하지 않은 그림 요소가 있어 다운로드를 멈췄어요.');
      if (/^(?:xlink:)?href$/i.test(name) && element.localName !== 'image') throw new Error('지원하지 않는 이미지 연결이 있어요.');
      if (/url\s*\(/i.test(attribute.value) && !/^url\(\s*#[A-Za-z0-9_-]+\s*\)$/.test(attribute.value)) throw new Error('외부 이미지 연결이 있어 다운로드를 멈췄어요.');
    }
  }
  const images = [...svg.querySelectorAll('image')];
  // One embedded atlas is shared by every material. This avoids copying a large
  // data URL up to 80 times while preserving every original clip and color filter.
  const assets = new Map();
  let assetIndex = 0;
  let defs;
  for (const originalImage of images) {
    checkAbort(signal);
    const href = originalImage.getAttribute('href') || originalImage.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!href) throw new Error('작품에 필요한 재료 사진이 없어요.');
    let assetId = assets.get(href);
    if (!assetId) {
      const dataUrl = await loadResource(href);
      if (!/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)) throw new Error('재료 사진을 안전하게 담지 못했어요.');
      do { assetId = `art-export-atlas-${++assetIndex}`; } while (elements.some(element => element.getAttribute('id') === assetId));
      if (!defs) { defs = svg.ownerDocument.createElementNS(SVG_NS, 'defs'); svg.prepend(defs); }
      const asset = svg.ownerDocument.createElementNS(SVG_NS, 'image');
      asset.setAttribute('id', assetId);
      asset.setAttribute('href', dataUrl);
      asset.setAttribute('width', '1254');
      asset.setAttribute('height', '1254');
      defs.append(asset);
      assets.set(href, assetId);
    }
    const use = svg.ownerDocument.createElementNS(SVG_NS, 'use');
    for (const attribute of originalImage.attributes) if (!/^(?:xlink:)?href$/i.test(attribute.name)) use.setAttribute(attribute.name, attribute.value);
    use.setAttribute('href', `#${assetId}`);
    originalImage.replaceWith(use);
  }
  checkAbort(signal);
  svg.setAttribute('width', String(EXPORT_WIDTH));
  svg.setAttribute('height', String(EXPORT_HEIGHT));
  return svg;
}

export async function renderArtworkPng(record, {loadResource = createArtworkResourceLoader(), signal} = {}) {
  checkAbort(signal);
  const svg = await embedArtworkResources(artPreview(record.art, record.title), {loadResource, signal});
  const source = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([source], {type: 'image/svg+xml;charset=utf-8'}));
  let canvas;
  try {
    const image = await decodeImage(url, {signal});
    canvas = document.createElement('canvas');
    canvas.width = EXPORT_WIDTH;
    canvas.height = EXPORT_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이 브라우저에서 그림 파일을 만들 수 없어요. 다른 브라우저에서 다시 시도해 주세요.');
    context.drawImage(image, 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
    const png = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('그림 파일을 만드는 시간이 너무 길어요. 다시 시도해 주세요.')), TIMEOUT_MS);
      try {
        canvas.toBlob(blob => { clearTimeout(timeout); blob ? resolve(blob) : reject(new Error('그림 파일을 만들지 못했어요.')); }, 'image/png');
      } catch (error) { clearTimeout(timeout); reject(error); }
    });
    checkAbort(signal);
    return png;
  } finally {
    URL.revokeObjectURL(url);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

const CRC_TABLE = Uint32Array.from({length: 256}, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function binary(length) {
  const bytes = new Uint8Array(length);
  return {bytes, view: new DataView(bytes.buffer)};
}
function dosTimestamp(date) {
  checkedDate(date);
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {time: date.getHours() << 11 | date.getMinutes() << 5 | Math.floor(date.getSeconds() / 2), day: (year - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate()};
}

// ZIP method 0 (stored). UTF-8 names, CRC-32, central directory, no dependencies.
export async function createStoredZip(entries, {date = new Date(), signal, maxBytes = MAX_EXPORT_BYTES} = {}) {
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_EXPORT_RECORDS) throw new Error('다운로드할 작품 수를 확인해 주세요.');
  const parts = [], central = [], names = new Set();
  const stamp = dosTimestamp(date);
  let offset = 0;
  for (const entry of entries) {
    checkAbort(signal);
    const name = encoder.encode(entry.filename);
    if (!name.length || name.length > 65535 || /[\\/\u0000-\u001f\u007f]/.test(entry.filename) || entry.filename === '..' || names.has(entry.filename)) throw new Error('작품 파일 이름이 올바르지 않아요.');
    names.add(entry.filename);
    if (!(entry.blob instanceof Blob) || !entry.blob.size) throw new Error('비어 있는 작품 파일이 있어요.');
    if (offset + entry.blob.size + 30 + name.length > maxBytes) throw new Error('선택한 작품의 파일 용량이 너무 커요. 작품을 나누어 다운로드해 주세요.');
    const checksum = entry.crc ?? crc32(new Uint8Array(await entry.blob.arrayBuffer()));
    const header = binary(30);
    header.view.setUint32(0, 0x04034b50, true);
    header.view.setUint16(4, 20, true);
    header.view.setUint16(6, 0x0800, true);
    header.view.setUint16(10, stamp.time, true);
    header.view.setUint16(12, stamp.day, true);
    header.view.setUint32(14, checksum, true);
    header.view.setUint32(18, entry.blob.size, true);
    header.view.setUint32(22, entry.blob.size, true);
    header.view.setUint16(26, name.length, true);
    parts.push(header.bytes, name, entry.blob);
    const directory = binary(46);
    directory.view.setUint32(0, 0x02014b50, true);
    directory.view.setUint16(4, 20, true);
    directory.view.setUint16(6, 20, true);
    directory.view.setUint16(8, 0x0800, true);
    directory.view.setUint16(12, stamp.time, true);
    directory.view.setUint16(14, stamp.day, true);
    directory.view.setUint32(16, checksum, true);
    directory.view.setUint32(20, entry.blob.size, true);
    directory.view.setUint32(24, entry.blob.size, true);
    directory.view.setUint16(28, name.length, true);
    directory.view.setUint32(42, offset, true);
    central.push(directory.bytes, name);
    offset += 30 + name.length + entry.blob.size;
  }
  const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
  if (offset + centralSize + 22 > maxBytes || offset + centralSize + 22 > 0xffffffff) throw new Error('선택한 작품의 파일 용량이 너무 커요. 작품을 나누어 다운로드해 주세요.');
  const end = binary(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, entries.length, true);
  end.view.setUint16(10, entries.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, offset, true);
  checkAbort(signal);
  return new Blob([...parts, ...central, end.bytes], {type: 'application/zip'});
}

async function checkedPng(blob) {
  if (!(blob instanceof Blob) || blob.type !== 'image/png' || blob.size < 45) throw new Error('완성되지 않은 그림 파일이 있어 다운로드를 멈췄어요.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte) || view.getUint32(12) !== 0x49484452 || view.getUint32(16) !== EXPORT_WIDTH || view.getUint32(20) !== EXPORT_HEIGHT || view.getUint32(bytes.length - 8) !== 0x49454e44 || view.getUint32(bytes.length - 4) !== 0xae426082) throw new Error('완성되지 않은 그림 파일이 있어 다운로드를 멈췄어요.');
  return crc32(bytes);
}

/** records: selected teacher-authorized {title, art} records, in display order.
 * Returns only after every PNG and the complete ZIP succeed. No download starts
 * here; the caller can save blob using one object URL and anchor.download.
 */
export async function createArtworkZip(records, {date = new Date(), render = renderArtworkPng, signal, onProgress, maxBytes = MAX_EXPORT_BYTES} = {}) {
  checkedDate(date);
  if (!Array.isArray(records) || !records.length) throw new Error('다운로드할 작품을 먼저 선택해 주세요.');
  if (records.length > MAX_EXPORT_RECORDS) throw new Error(`한 번에 ${MAX_EXPORT_RECORDS}개까지 다운로드할 수 있어요.`);
  // Snapshot the whole selection before asynchronous work; edits/refreshes cannot
  // silently replace the selected content during a long batch.
  const snapshot = records.map(record => ({title: String(record.title ?? ''), art: structuredClone(record.art)}));
  const exportDate = new Date(date.getTime());
  const loadResource = createArtworkResourceLoader({signal});
  const entries = [];
  let totalBytes = 0;
  for (let index = 0; index < snapshot.length; index++) {
    checkAbort(signal);
    onProgress?.({completed: index, total: snapshot.length, phase: 'rendering'});
    try {
      const blob = await render(snapshot[index], {loadResource, signal});
      if (!(blob instanceof Blob)) throw new Error('그림 파일을 만들지 못했어요.');
      totalBytes += blob.size;
      if (totalBytes > maxBytes) throw new Error('선택한 작품의 파일 용량이 너무 커요. 작품을 나누어 다운로드해 주세요.');
      const crc = await checkedPng(blob);
      entries.push({filename: artworkFilename(snapshot[index].title, index + 1, exportDate), blob, crc});
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error(`${index + 1}번째 작품을 저장하지 못했어요. ${error.message || '다시 시도해 주세요.'}`, {cause: error});
    }
    // Keep cancellation and progress controls responsive between artworks.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  checkAbort(signal);
  onProgress?.({completed: snapshot.length, total: snapshot.length, phase: 'packaging'});
  const blob = await createStoredZip(entries, {date: exportDate, signal, maxBytes});
  checkAbort(signal);
  onProgress?.({completed: snapshot.length, total: snapshot.length, phase: 'complete'});
  return {blob, filename: `${exportTimestamp(exportDate)}_작품.zip`, entries: entries.map(({filename, blob}) => ({filename, size: blob.size})), width: EXPORT_WIDTH, height: EXPORT_HEIGHT};
}
