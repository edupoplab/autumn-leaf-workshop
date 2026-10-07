/**
 * Existing-account Supabase Auth for teacher UI only.
 * Never use client state, user metadata, or this helper as a server authorization check.
 */
const MESSAGES = Object.freeze({
  CONFIGURATION: 'Teacher sign-in is not configured.',
  INVALID_INPUT: 'Enter your email and password.',
  REGISTRATION_FAILED: 'Unable to create your account. Check the details or try later.',
  INVALID_CREDENTIALS: 'Unable to sign in with those credentials.',
  SESSION_EXPIRED: 'Your session has ended. Sign in again.',
  INVALID_RESPONSE: 'Unable to verify your sign-in. Try again.',
  NETWORK: 'Unable to reach sign-in. Try again.',
  TIMEOUT: 'Sign-in took too long. Try again.',
  CANCELLED: 'The sign-in request was cancelled.',
  RATE_LIMITED: 'Too many sign-in attempts. Try again later.',
});
const MAX_RESPONSE_BYTES = 65536;
const MAX_SESSION_CHARS = 32768;
const REFRESH_SKEW_MS = 60000;
const MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenString = (value, max = 16384) => typeof value === 'string' && value.length >= 8 && value.length <= max && /^[A-Za-z0-9._~+/=-]+$/.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class TeacherAuthError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(MESSAGES, code) ? code : 'NETWORK';
    super(MESSAGES[safeCode]);
    this.name = 'TeacherAuthError';
    this.code = safeCode;
  }
}
const failure = code => new TeacherAuthError(code);
const safeError = error => error instanceof TeacherAuthError ? error : failure('NETWORK');

function readConfig(config) {
  try {
    if (!record(config) || typeof config.supabaseUrl !== 'string' || typeof config.publishableKey !== 'string') return null;
    const url = new URL(config.supabaseUrl);
    // This bounded helper is for hosted Supabase projects, not arbitrary credential destinations.
    if (url.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return null;
    if (!/^sb_publishable_[A-Za-z0-9_-]{8,512}$/.test(config.publishableKey)) return null;
    if (typeof config.gameKey !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(config.gameKey)) return null;
    return { origin: url.origin, key: config.publishableKey, gameKey: config.gameKey };
  } catch { return null; }
}

function browserSessionStorage() {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

function verifiedIdentity(value) {
  if (!record(value) || typeof value.id !== 'string' || !UUID.test(value.id) || value.is_anonymous === true || typeof value.email !== 'string' || !value.email.includes('@') || value.email.length > 320) throw failure('INVALID_RESPONSE');
  // No editable metadata, role, raw response, token, or credential is returned.
  return Object.freeze({ id: value.id, email: value.email });
}

/**
 * config: { supabaseUrl, publishableKey, gameKey }.
 * options: { storage = sessionStorage, fetchImpl = fetch, now = Date.now,
 *            timeoutMs = 10000 }. Inject storage/fetch/clock for synthetic tests.
 * Public API: signIn(email,password), getAccessToken(), getUser(), signOut(), clear().
 * A missing/invalid configuration disables all Auth network operations.
 */
export function createTeacherAuth(config, options = {}) {
  const settings = readConfig(config);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const now = options.now ?? Date.now;
  const storage = Object.hasOwn(options, 'storage') ? options.storage : browserSessionStorage();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(30000, options.timeoutMs)) : 10000;
  const configured = Boolean(settings && typeof fetchImpl === 'function' && typeof now === 'function');
  const storageKey = settings ? `teacher-auth:v1:${settings.origin}:${settings.gameKey}` : null;
  let session = null;
  let user = null;
  let verifiedToken = null;
  let revision = 0;
  let refreshFlight = null;
  let verifyFlight = null;
  let recovery = null;
  let callback = null;
  try {
    const candidate = new URL(options.redirectUrl);
    if (candidate.protocol === 'https:' && !candidate.username && !candidate.password && !candidate.search && !candidate.hash && /\/teacher\/$/.test(candidate.pathname)) callback = candidate.href;
  } catch { /* A callback must be configured explicitly by the app. */ }
  const controllers = new Set();

  function requireConfigured() { if (!configured) throw failure('CONFIGURATION'); }
  function requireCurrent(expectedRevision) { if (revision !== expectedRevision) throw failure('CANCELLED'); }
  function removeStoredSession() {
    if (!storage || !storageKey) return true;
    try { storage.removeItem(storageKey); return true; } catch {
      // An empty marker also prevents restoration if removal alone is unavailable.
      try { storage.setItem(storageKey, ''); return true; } catch { return false; }
    }
  }
  function clear() {
    revision += 1;
    session = null;
    user = null;
    verifiedToken = null;
    recovery = null;
    refreshFlight = null;
    verifyFlight = null;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    return Object.freeze({ storageCleared: removeStoredSession() });
  }
  function persist() {
    if (!storage || !storageKey || !session) return;
    try {
      storage.setItem(storageKey, JSON.stringify({ version: 1, project: settings.origin, gameKey: settings.gameKey, ...session }));
    } catch {
      // If browser storage becomes unavailable, retain only an in-memory session.
      removeStoredSession();
    }
  }
  function restore() {
    if (!configured || !storage || !storageKey) return;
    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return;
      if (raw.length > MAX_SESSION_CHARS) throw failure('INVALID_RESPONSE');
      const value = JSON.parse(raw);
      if (!record(value) || value.version !== 1 || value.project !== settings.origin || value.gameKey !== settings.gameKey || !tokenString(value.accessToken) || !tokenString(value.refreshToken, 4096) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0 || value.expiresAt > now() + MAX_LIFETIME_MS || typeof value.userId !== 'string' || !UUID.test(value.userId)) throw failure('INVALID_RESPONSE');
      session = { accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt, userId: value.userId };
      // The stored identity is only a consistency check. It is never trusted as verified.
    } catch { removeStoredSession(); }
  }

  async function readJson(response) {
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) throw failure('INVALID_RESPONSE');
    const declaredSize = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) throw failure('INVALID_RESPONSE');
    let text;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0;
      text = '';
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) {
            void reader.cancel().catch(() => {});
            throw failure('INVALID_RESPONSE');
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
    } else {
      // Modern browser Fetch provides a readable stream; do not buffer an unbounded fallback.
      throw failure('INVALID_RESPONSE');
    }
    try { return JSON.parse(text); } catch { throw failure('INVALID_RESPONSE'); }
  }

  async function request(path, { method = 'GET', body, accessToken, empty = false, signIn = false, registration = false } = {}) {
    requireConfigured();
    const controller = new AbortController();
    controllers.add(controller);
    let timer;
    let abortHandler;
    try {
      const cancelled = new Promise((_, reject) => {
        abortHandler = () => reject(failure('CANCELLED'));
        controller.signal.addEventListener('abort', abortHandler, { once: true });
      });
      const timedOut = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(failure('TIMEOUT'));
          controller.abort();
        }, timeoutMs);
      });
      const work = (async () => {
        const headers = { apikey: settings.key, Accept: 'application/json' };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        const response = await fetchImpl(`${settings.origin}/auth/v1${path}`, {
          method, headers, body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
        });
        if (!response || !Number.isInteger(response.status)) throw failure('INVALID_RESPONSE');
        if (response.status === 429) throw failure('RATE_LIMITED');
        if ([400, 401, 403, 422].includes(response.status)) throw failure(registration ? 'REGISTRATION_FAILED' : signIn ? 'INVALID_CREDENTIALS' : 'SESSION_EXPIRED');
        if (empty) {
          if (response.status !== 204 && response.status !== 200) throw failure('NETWORK');
          return null;
        }
        if (response.status !== 200) throw failure('NETWORK');
        try { return await readJson(response); } catch (error) {
          if (error instanceof TeacherAuthError) throw error;
          throw failure('INVALID_RESPONSE');
        }
      })();
      return await Promise.race([work, cancelled, timedOut]);
    } catch (error) { throw safeError(error); }
    finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abortHandler);
      controllers.delete(controller);
    }
  }

  function parseSession(value, previousUserId = null) {
    if (!record(value) || !tokenString(value.access_token) || !tokenString(value.refresh_token, 4096) || String(value.token_type).toLowerCase() !== 'bearer' || !Number.isInteger(value.expires_in) || value.expires_in <= 0 || value.expires_in * 1000 > MAX_LIFETIME_MS) throw failure('INVALID_RESPONSE');
    const claimed = verifiedIdentity(value.user);
    if (previousUserId && claimed.id !== previousUserId) throw failure('INVALID_RESPONSE');
    let expiresAt = now() + value.expires_in * 1000;
    if (value.expires_at !== undefined) {
      if (!Number.isSafeInteger(value.expires_at) || value.expires_at <= 0) throw failure('INVALID_RESPONSE');
      expiresAt = Math.min(expiresAt, value.expires_at * 1000);
    }
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) throw failure('INVALID_RESPONSE');
    return { accessToken: value.access_token, refreshToken: value.refresh_token, expiresAt, userId: claimed.id };
  }
  async function verifyCandidate(candidate, expectedRevision) {
    const freshUser = verifiedIdentity(await request('/user', { accessToken: candidate.accessToken }));
    requireCurrent(expectedRevision);
    if (freshUser.id !== candidate.userId) throw failure('INVALID_RESPONSE');
    return freshUser;
  }
  function commit(candidate, freshUser, expectedRevision) {
    requireCurrent(expectedRevision);
    session = candidate;
    user = freshUser;
    verifiedToken = candidate.accessToken;
    persist();
  }
  async function signIn(email, password) {
    requireConfigured();
    clear();
    const expectedRevision = revision;
    if (typeof email !== 'string' || email.trim().length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email.trim()) || typeof password !== 'string' || !password.length || password.length > 4096) throw failure('INVALID_INPUT');
    try {
      const payload = await request('/token?grant_type=password', { method: 'POST', body: { email: email.trim(), password }, signIn: true });
      // Credentials are used only for the request; never stored or returned.
      password = undefined;
      requireCurrent(expectedRevision);
      const candidate = parseSession(payload);
      const freshUser = await verifyCandidate(candidate, expectedRevision);
      commit(candidate, freshUser, expectedRevision);
      return { ...freshUser };
    } catch (error) {
      if (revision === expectedRevision) clear();
      throw safeError(error);
    } finally { password = undefined; }
  }
  async function signUp(email, password) {
    requireConfigured();
    if (typeof email !== 'string' || email.trim().length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email.trim()) || typeof password !== 'string' || password.length < 8 || password.length > 128) throw failure('INVALID_INPUT');
    try {
      const payload = await request('/signup' + (callback ? '?redirect_to=' + encodeURIComponent(callback) : ''), { method:'POST', body:{ email:email.trim(), password }, registration:true });
      password = undefined;
      if (!record(payload)) throw failure('INVALID_RESPONSE');
      // Signup does not establish a local session or grant a teacher role.
      // Return the same message for existing accounts and newly created accounts.
      return Object.freeze({ confirmationRequested:true });
    } finally { password = undefined; }
  }
  async function refresh() {
    if (refreshFlight) return refreshFlight;
    const previous = session;
    const expectedRevision = revision;
    if (!previous) return null;
    const work = (async () => {
      try {
        const payload = await request('/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: previous.refreshToken } });
        requireCurrent(expectedRevision);
        const candidate = parseSession(payload, previous.userId);
        const freshUser = await verifyCandidate(candidate, expectedRevision);
        commit(candidate, freshUser, expectedRevision);
        return candidate;
      } catch (error) {
        if (revision === expectedRevision) clear();
        throw safeError(error);
      }
    })();
    refreshFlight = work;
    try { return await work; } finally { if (refreshFlight === work) refreshFlight = null; }
  }
  async function requestPasswordReset(email) {
    requireConfigured();
    if (!callback) throw failure('CONFIGURATION');
    if (typeof email !== 'string' || email.trim().length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email.trim())) throw failure('INVALID_INPUT');
    await request('/recover?redirect_to=' + encodeURIComponent(callback + '?reset=1'), { method:'POST', body:{email:email.trim()}, empty:true });
    return Object.freeze({requested:true});
  }
  async function beginRecovery(fragment) {
    requireConfigured();
    clear();
    const expectedRevision = revision;
    if (typeof fragment !== 'string' || fragment.length > MAX_SESSION_CHARS) throw failure('SESSION_EXPIRED');
    const values = new URLSearchParams(fragment.replace(/^#/, ''));
    const token = values.get('access_token'), lifetime = Number(values.get('expires_in'));
    if (values.get('type') !== 'recovery' || !tokenString(token) || !Number.isSafeInteger(lifetime) || lifetime <= 0 || lifetime > 86400) throw failure('SESSION_EXPIRED');
    let expiresAt = now() + lifetime * 1000;
    if (values.has('expires_at')) {
      const expiry = Number(values.get('expires_at'));
      if (!Number.isSafeInteger(expiry)) throw failure('SESSION_EXPIRED');
      expiresAt = Math.min(expiresAt, expiry * 1000);
    }
    if (expiresAt <= now()) throw failure('SESSION_EXPIRED');
    const identity = verifiedIdentity(await request('/user', {accessToken:token}));
    requireCurrent(expectedRevision);
    // Recovery is ephemeral and cannot become a teacher session or enter browser storage.
    recovery = {accessToken:token, expiresAt, identity};
    return {...identity};
  }
  async function resetPassword(password) {
    requireConfigured();
    const current = recovery, expectedRevision = revision;
    if (!current || current.expiresAt <= now()) { recovery = null; throw failure('SESSION_EXPIRED'); }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw failure('INVALID_INPUT');
    try {
      const fresh = verifiedIdentity(await request('/user', {accessToken:current.accessToken}));
      requireCurrent(expectedRevision);
      if (recovery !== current || fresh.id !== current.identity.id) throw failure('INVALID_RESPONSE');
      const updated = verifiedIdentity(await request('/user', {method:'PUT',accessToken:current.accessToken,body:{password}}));
      password = undefined;
      requireCurrent(expectedRevision);
      if (updated.id !== current.identity.id) throw failure('INVALID_RESPONSE');
      clear();
      try { await request('/logout?scope=local', {method:'POST',accessToken:current.accessToken,empty:true}); } catch { /* No local recovery or login state remains. */ }
      return Object.freeze({changed:true});
    } catch (error) {
      if (revision === expectedRevision) clear();
      throw safeError(error);
    } finally { password = undefined; }
  }
  async function verifyCurrent() {
    const current = session;
    const expectedRevision = revision;
    if (!current) return null;
    if (verifyFlight?.token === current.accessToken && verifyFlight.revision === expectedRevision) return verifyFlight.promise;
    const work = (async () => {
      try {
        const freshUser = await verifyCandidate(current, expectedRevision);
        if (session !== current) throw failure('CANCELLED');
        user = freshUser;
        verifiedToken = current.accessToken;
        return current;
      } catch (error) {
        if (revision === expectedRevision && session === current) clear();
        throw safeError(error);
      }
    })();
    verifyFlight = { token: current.accessToken, revision: expectedRevision, promise: work };
    try { return await work; } finally { if (verifyFlight?.promise === work) verifyFlight = null; }
  }
  async function ensureSession(forceVerify = false) {
    requireConfigured();
    if (!session) return null;
    if (session.expiresAt - now() <= REFRESH_SKEW_MS) return refresh();
    if (forceVerify || !user || verifiedToken !== session.accessToken) return verifyCurrent();
    return session;
  }
  async function getAccessToken() {
    const current = await ensureSession();
    // Recheck after the await: a simultaneous clear/signOut must not leak a cached token.
    return current && current === session ? current.accessToken : null;
  }
  async function getUser() {
    const current = await ensureSession(true);
    return current && current === session && user ? { ...user } : null;
  }
  async function signOut() {
    // Call only from an explicit user logout action. Clear first, even if offline.
    const token = session?.accessToken;
    const { storageCleared } = clear();
    let serverSignedOut = false;
    if (configured && token) {
      try { await request('/logout?scope=local', { method: 'POST', accessToken: token, empty: true }); serverSignedOut = true; } catch { /* Best effort; never restore local state. */ }
    }
    return { storageCleared, serverSignedOut };
  }
  restore();
  return Object.freeze({ configured, signIn, signUp, requestPasswordReset, beginRecovery, resetPassword, getAccessToken, getUser, signOut, clear });
}
