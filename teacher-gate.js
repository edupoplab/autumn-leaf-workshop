/**
 * Temporary, tab-local teacher UI PIN. This is NOT authentication or a room
 * capability. The caller must independently authorize every teacher operation.
 * Nothing in this module makes network requests or creates management access.
 */
export const TEACHER_GATE_MAX_AGE_MS = 4 * 60 * 60 * 1000;
export const TEACHER_GATE_ITERATIONS = 150_000;
export const TEACHER_GATE_STORAGE_KEY = 'leaf:teacher-ui-pin:v1';

const PIN_PATTERN = /^[0-9]{4,8}$/;
const RECORD_KEYS = ['blockedUntil', 'createdAt', 'digest', 'expiresAt', 'failures', 'salt', 'scope', 'version'];
const fail = (status, extra = {}) => ({ ok: false, status, ...extra });
const isTime = value => Number.isSafeInteger(value) && value > 0;
const isScope = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x20\x7f]/.test(value);
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const unhex = value => Uint8Array.from(value.match(/../g), byte => Number.parseInt(byte, 16));

/**
 * Options are injectable for tests. Omit them in browsers to use WebCrypto,
 * sessionStorage and Date.now. There is intentionally no localStorage fallback.
 *
 * initialize({scope, expiresAt?}) -> read-only public state (expiry is Unix ms).
 * set(pin), check(pin)           -> Promise<{ok, status, expiresAt?, retryAfterMs?}>
 * read()                        -> {status, expiresAt?, retryAfterMs?}
 * clear()                       -> {ok, status}
 * rebind({scope, expiresAt?})    -> preserves PIN and SHORTENS its expiry only.
 *
 * Call initialize only after independently verifying that this view may show a
 * teacher gate. Rebind requires a successful set/check in this helper instance.
 * No successful result is proof of teacher membership or permission to manage.
 */
export function createTeacherGate(options = {}) {
  const key = options.key ?? TEACHER_GATE_STORAGE_KEY;
  const now = options.now ?? (() => Date.now());
  let context = null;
  let generation = 0;
  let verified = null;
  let queue = Promise.resolve();

  function clock() {
    try { const value = now(); return isTime(value) ? value : null; }
    catch { return null; }
  }
  function storage() {
    try {
      const value = Object.prototype.hasOwnProperty.call(options, 'storage') ? options.storage : globalThis.sessionStorage;
      return value && ['getItem', 'setItem', 'removeItem'].every(name => typeof value[name] === 'function') ? value : null;
    } catch { return null; }
  }
  function webCrypto() {
    try {
      const value = Object.prototype.hasOwnProperty.call(options, 'crypto') ? options.crypto : globalThis.crypto;
      return value?.subtle && typeof value.subtle.importKey === 'function' && typeof value.subtle.deriveBits === 'function' && typeof value.getRandomValues === 'function' ? value : null;
    } catch { return null; }
  }
  function remove() {
    const target = storage();
    if (!target) return false;
    try { target.removeItem(key); return target.getItem(key) === null; }
    catch { return false; }
  }
  function write(record, expectedRaw) {
    const target = storage();
    if (!target) return 'storage-unavailable';
    try {
      if (target.getItem(key) !== expectedRaw) return 'changed';
      const raw = JSON.stringify(record);
      target.setItem(key, raw);
      return target.getItem(key) === raw ? null : 'storage-unavailable';
    } catch { return 'storage-unavailable'; }
  }
  function validRecord(record, time) {
    return record && typeof record === 'object' && !Array.isArray(record) &&
      Object.keys(record).sort().join(',') === RECORD_KEYS.join(',') &&
      record.version === 1 && isScope(record.scope) &&
      isTime(record.createdAt) && record.createdAt <= time && isTime(record.expiresAt) &&
      record.expiresAt > record.createdAt && record.expiresAt - record.createdAt <= TEACHER_GATE_MAX_AGE_MS &&
      typeof record.salt === 'string' && /^[a-f0-9]{32}$/.test(record.salt) &&
      typeof record.digest === 'string' && /^[a-f0-9]{64}$/.test(record.digest) &&
      Number.isInteger(record.failures) && record.failures >= 0 && record.failures <= 100 &&
      Number.isSafeInteger(record.blockedUntil) && (record.blockedUntil === 0 ||
        (record.blockedUntil >= record.createdAt && record.blockedUntil <= record.expiresAt));
  }
  function readInternal() {
    if (!context) return { status: 'uninitialized' };
    const time = clock();
    if (time === null) return { status: 'clock-unavailable' };
    const target = storage();
    if (!target) return { status: 'storage-unavailable' };
    let raw;
    try { raw = target.getItem(key); }
    catch { return { status: 'storage-unavailable' }; }
    if (raw === null) return { status: context.expiresAt <= time ? 'expired' : 'missing', raw: null };
    let record;
    try { record = JSON.parse(raw); } catch { /* Invalid data is cleared below. */ }
    if (!validRecord(record, time)) {
      verified = null;
      return { status: remove() ? 'invalid' : 'storage-unavailable' };
    }
    if (record.expiresAt <= time) {
      verified = null;
      return { status: remove() ? 'expired' : 'storage-unavailable' };
    }
    if (record.scope !== context.scope) return { status: 'scope-mismatch' };
    const expiresAt = Math.min(record.expiresAt, context.expiresAt);
    if (expiresAt <= time) {
      verified = null;
      return { status: remove() ? 'expired' : 'storage-unavailable' };
    }
    if (expiresAt !== record.expiresAt) {
      record.expiresAt = expiresAt;
      record.blockedUntil = Math.min(record.blockedUntil, expiresAt);
      const error = write(record, raw);
      if (error) return { status: error };
      raw = JSON.stringify(record);
    }
    return { status: 'ready', expiresAt, retryAfterMs: Math.max(0, record.blockedUntil - time), record, raw };
  }
  function publicState(state) {
    const { status, expiresAt, retryAfterMs } = state;
    return { status, ...(expiresAt === undefined ? {} : { expiresAt }), ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
  }
  function fingerprint(record) {
    return [record.scope, record.createdAt, record.salt, record.digest].join(':');
  }
  function binding(input) {
    if (!input || !isScope(input.scope)) return null;
    if (input.expiresAt !== undefined && !isTime(input.expiresAt)) return null;
    return { scope: input.scope, expiresAt: input.expiresAt ?? Infinity };
  }
  function serialize(work) {
    const requestedGeneration = generation;
    const result = queue.then(() => requestedGeneration === generation ? work(requestedGeneration) : fail('cancelled'));
    queue = result.catch(() => {});
    return result;
  }
  async function derive(pin, salt, crypto) {
    const bytes = new TextEncoder().encode(pin);
    let material;
    try { material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveBits']); }
    finally { bytes.fill(0); }
    const result = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: TEACHER_GATE_ITERATIONS, salt }, material, 256);
    return hex(new Uint8Array(result));
  }

  function initialize(input) {
    generation += 1;
    verified = null;
    context = binding(input);
    return context ? publicState(readInternal()) : { status: 'invalid-context' };
  }
  function read() { return publicState(readInternal()); }
  function clear() {
    generation += 1;
    verified = null;
    return remove() ? { ok: true, status: 'cleared' } : fail('storage-unavailable');
  }
  function set(pin) {
    return serialize(async requestedGeneration => {
      if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) return fail('invalid-pin');
      const state = readInternal();
      if (state.status === 'ready') return fail('already-set');
      if (!['missing', 'expired', 'invalid'].includes(state.status)) return fail(state.status);
      const time = clock();
      if (time === null) return fail('clock-unavailable');
      const expiresAt = Math.min(time + TEACHER_GATE_MAX_AGE_MS, context.expiresAt);
      if (expiresAt <= time) return fail('expired');
      const crypto = webCrypto();
      if (!crypto) return fail('crypto-unavailable');
      let salt, digest;
      try {
        salt = crypto.getRandomValues(new Uint8Array(16));
        digest = await derive(pin, salt, crypto);
      } catch { return fail('crypto-unavailable'); }
      if (requestedGeneration !== generation) return fail('cancelled');
      const after = clock();
      if (after === null) return fail('clock-unavailable');
      if (after < time || after >= expiresAt) return fail('expired');
      const record = { version: 1, scope: context.scope, createdAt: time, expiresAt, salt: hex(salt), digest, failures: 0, blockedUntil: 0 };
      const error = write(record, null);
      if (error) return fail(error);
      verified = fingerprint(record);
      return { ok: true, status: 'set', expiresAt };
    });
  }
  function check(pin) {
    return serialize(async requestedGeneration => {
      const state = readInternal();
      if (state.status !== 'ready') return fail(state.status);
      if (state.retryAfterMs > 0) return fail('cooldown', { retryAfterMs: state.retryAfterMs });
      const crypto = webCrypto();
      if (!crypto) return fail('crypto-unavailable');
      let digest = '';
      if (typeof pin === 'string' && PIN_PATTERN.test(pin)) {
        try { digest = await derive(pin, unhex(state.record.salt), crypto); }
        catch { return fail('crypto-unavailable'); }
      }
      if (requestedGeneration !== generation) return fail('cancelled');
      const time = clock();
      if (time === null) return fail('clock-unavailable');
      if (time < state.record.createdAt || time >= state.expiresAt) return fail('expired');
      let difference = digest.length ^ state.record.digest.length;
      for (let i = 0; i < state.record.digest.length; i += 1) difference |= (digest.charCodeAt(i) || 0) ^ state.record.digest.charCodeAt(i);
      const success = difference === 0;
      const failures = success ? 0 : Math.min(100, state.record.failures + 1);
      const delay = failures < 5 ? 0 : Math.min(300_000, 30_000 * (2 ** Math.floor((failures - 5) / 5)));
      const record = { ...state.record, failures, blockedUntil: delay ? Math.min(time + delay, state.expiresAt) : 0 };
      const error = write(record, state.raw);
      if (error) { verified = null; return fail(error); }
      verified = success ? fingerprint(record) : null;
      return success ? { ok: true, status: 'verified', expiresAt: record.expiresAt }
        : fail('incorrect-pin', { retryAfterMs: Math.max(0, record.blockedUntil - time) });
    });
  }
  function rebind(input) {
    const target = binding(input);
    if (!target) return fail('invalid-context');
    const state = readInternal();
    if (state.status !== 'ready') return fail(state.status);
    if (verified !== fingerprint(state.record)) return fail('verification-required');
    const time = clock();
    if (time === null) return fail('clock-unavailable');
    const expiresAt = Math.min(state.expiresAt, target.expiresAt);
    if (expiresAt <= time) return fail('expired');
    const record = { ...state.record, scope: target.scope, expiresAt, blockedUntil: Math.min(state.record.blockedUntil, expiresAt) };
    const error = write(record, state.raw);
    if (error) return fail(error);
    generation += 1;
    context = target;
    verified = fingerprint(record);
    return { ok: true, status: 'rebound', expiresAt };
  }
  return Object.freeze({ initialize, set, check, read, clear, rebind });
}
