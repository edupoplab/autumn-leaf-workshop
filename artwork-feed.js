/**
 * A role-private, memory-only artwork cache. Create one instance per feed/session.
 * clear() immediately empties the cache and invalidates outstanding requests.
 * refresh() coalesces concurrent calls; a forced refresh waits for an active
 * ordinary refresh and then requests a complete manifest (cached art is reused).
 */
export function createArtworkFeed({ requestManifest, requestArt, batchSize = 20, onInvalidate } = {}) {
  if (typeof requestManifest !== 'function' || typeof requestArt !== 'function') {
    throw new TypeError('requestManifest and requestArt must be functions');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new TypeError('batchSize must be a positive integer');
  if (onInvalidate !== undefined && typeof onInvalidate !== 'function') throw new TypeError('onInvalidate must be a function');

  let epoch = 0;
  let etag = null;
  let committed = null;
  let committedResult = null;
  let active = null;
  const cache = new Map();
  const MAX_SYNC_ATTEMPTS = 3;

  function error(code, message) {
    return Object.assign(new Error(message), { code });
  }
  function assertCurrent(generation) {
    if (generation !== epoch) throw error('FEED_CLEARED', 'Artwork feed was cleared while a request was in flight');
  }
  function notify(ids) {
    // This callback is deliberately synchronous: removed cards must disappear
    // before the first request for any new artwork is started.
    if (onInvalidate) onInvalidate(ids);
  }
  function validateManifest(response) {
    if (!response || typeof response !== 'object' || typeof response.etag !== 'string' || !response.etag ||
        !response.data || typeof response.data !== 'object' || !Array.isArray(response.data.submissions)) {
      throw error('INVALID_MANIFEST', 'Invalid artwork manifest');
    }
    const ids = new Set();
    for (const item of response.data.submissions) {
      if (!item || typeof item.id !== 'string' || !item.id || typeof item.artVersion !== 'string' || !item.artVersion || ids.has(item.id)) {
        throw error('INVALID_MANIFEST', 'Manifest has an invalid or duplicate artwork ID/version');
      }
      ids.add(item.id);
    }
    // Snapshot metadata so a transport cannot mutate a validated manifest later.
    return { etag: response.etag, data: { ...response.data, submissions: response.data.submissions.map(item => ({ ...item })) } };
  }
  function assemble(manifest) {
    return {
      ...manifest,
      submissions: manifest.submissions.map(item => {
        const entry = cache.get(item.id);
        if (!entry || entry.version !== item.artVersion) throw error('CACHE_MISS', 'A required artwork version is missing');
        const { artVersion, ...metadata } = item;
        return { ...metadata, art: entry.art };
      })
    };
  }
  function validateArt(response, requested) {
    if (!response || !Array.isArray(response.submissions)) throw error('INVALID_ART_RESPONSE', 'Invalid artwork response');
    const expected = new Map(requested.map(item => [item.id, item.version]));
    const seen = new Set();
    const checked = [];
    for (const item of response.submissions) {
      if (!item || !expected.has(item.id) || seen.has(item.id) || item.artVersion !== expected.get(item.id) ||
          !Object.prototype.hasOwnProperty.call(item, 'art') || item.art === undefined) {
        throw error('INVALID_ART_RESPONSE', 'Artwork response contains an unexpected, duplicate, or mismatched version');
      }
      seen.add(item.id);
      checked.push({ id: item.id, version: item.artVersion, art: item.art });
    }
    if (seen.size !== expected.size) throw error('INVALID_ART_RESPONSE', 'Artwork response is missing a required version');
    return checked;
  }
  function reset() {
    cache.clear();
    etag = null;
    committed = null;
    committedResult = null;
  }

  async function load(generation, force) {
    try {
      assertCurrent(generation);
      for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt++) {
        try {
          const sentEtag = force || attempt > 0 ? null : etag;
          const response = await requestManifest(sentEtag);
          assertCurrent(generation);
          if (response && response.notModified === true) {
            if (sentEtag === null || committed === null) throw error('INVALID_MANIFEST', 'Received not-modified without a committed manifest');
            return committedResult;
          }
          const manifest = validateManifest(response);
          const visibleVersions = new Map(manifest.data.submissions.map(item => [item.id, item.artVersion]));
          // Evict removed and changed art before exposing the visible ID list or
          // awaiting any payload. A later failure never resurrects old art.
          for (const [id, entry] of cache) {
            if (visibleVersions.get(id) !== entry.version) cache.delete(id);
          }
          // The old conditional validator no longer describes the cache.
          etag = null;
          committed = null;
          committedResult = null;
          notify([...visibleVersions.keys()]);
          assertCurrent(generation); // onInvalidate may itself clear the feed.
          const missing = manifest.data.submissions
            .filter(item => !cache.has(item.id))
            .map(item => ({ id: item.id, version: item.artVersion }));
          for (let index = 0; index < missing.length; index += batchSize) {
            const requested = missing.slice(index, index + batchSize);
            const payload = await requestArt(requested);
            assertCurrent(generation);
            const checked = validateArt(payload, requested);
            for (const item of checked) cache.set(item.id, { version: item.version, art: item.art });
          }
          assertCurrent(generation);
          const result = assemble(manifest.data);
          // Commit the validator only after every requested version is present.
          committed = manifest.data;
          committedResult = result;
          etag = manifest.etag;
          return result;
        } catch (failure) {
          assertCurrent(generation);
          if (failure && failure.code === 'SYNC_CHANGED' && attempt + 1 < MAX_SYNC_ATTEMPTS) {
            // Visibility may have changed during a payload fetch. Remove the UI
            // immediately, then fetch a full manifest. Valid cached versions can
            // be reused only if that new manifest explicitly includes them.
            etag = null;
            committed = null;
            committedResult = null;
            notify([]);
            assertCurrent(generation);
            continue;
          }
          throw failure;
        }
      }
    } catch (failure) {
      if (generation !== epoch) throw error('FEED_CLEARED', 'Artwork feed was cleared while a request was in flight');
      reset();
      // Preserve the transport/validation error even if UI cleanup throws.
      try { notify([]); } catch { /* The original failure is more useful. */ }
      throw failure;
    }
  }

  function refresh({ force = false } = {}) {
    const generation = epoch;
    if (active && active.epoch === generation) {
      if (!force || active.force) return active.promise;
      // Preserve a caller's explicit forced-refresh intent without issuing
      // overlapping requests. Multiple waiting forced refreshes coalesce too.
      return active.promise.catch(() => {}).then(() => {
        assertCurrent(generation);
        return refresh({ force: true });
      });
    }
    const operation = { epoch: generation, force: Boolean(force), promise: null };
    operation.promise = Promise.resolve().then(() => load(generation, operation.force));
    active = operation;
    const release = () => { if (active === operation) active = null; };
    operation.promise.then(release, release);
    return operation.promise;
  }
  function clear() {
    epoch++;
    active = null;
    reset();
    notify([]);
  }
  return { refresh, clear };
}
