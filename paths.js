// Portable, same-origin static paths. Runtime settings are public configuration,
// never credentials or a substitute for the server's authorization checks.
const PAGES = new Set(['play', 'teacher', 'display']);
const BASE = /^\/(?:[A-Za-z0-9_-]+\/)*$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function normalizeAppBase(value) {
  if (typeof value !== 'string') throw new Error('Invalid application base');
  const base = value.endsWith('/') ? value : `${value}/`;
  if (!BASE.test(base)) throw new Error('Invalid application base');
  return base;
}

export function resolveRuntimeConfig(raw = {}, {scriptUrl = import.meta.url, pageUrl = globalThis.location?.href} = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  let inferredBase = '/', script;
  try {
    script = new URL(scriptUrl);
    if (['http:', 'https:'].includes(script.protocol)) {
      if (script.username || script.password || script.search || script.hash || !script.pathname.endsWith('/paths.js')) throw new Error('Invalid path module URL');
      if (pageUrl && new URL(pageUrl).origin !== script.origin) throw new Error('Path module must be same-origin');
      inferredBase = normalizeAppBase(script.pathname.slice(0, -'paths.js'.length));
    }
  } catch (error) {
    if (script?.protocol !== 'file:') throw error;
  }
  const appBase = raw.appBase == null ? inferredBase : normalizeAppBase(raw.appBase);
  if (script && ['http:', 'https:'].includes(script.protocol) && appBase !== inferredBase) throw new Error('Application base does not match the static assets');
  let apiBaseUrl = '';
  if (typeof raw.apiBaseUrl === 'string' && raw.apiBaseUrl) {
    const url = new URL(raw.apiBaseUrl);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) || url.username || url.password || url.search || url.hash || /(?:%|\\|\/\.)/.test(url.pathname)) throw new Error('Invalid API base URL');
    apiBaseUrl = url.href.replace(/\/+$/, '');
  }
  return Object.freeze({
    appBase,
    // Both are required. Missing runtime configuration never falls back to the
    // current site's /api or gives a visitor a teacher role.
    enabled: raw.enabled === true && Boolean(apiBaseUrl),
    apiBaseUrl,
    projectRef: typeof raw.projectRef === 'string' ? raw.projectRef : '',
    supabaseUrl: typeof raw.supabaseUrl === 'string' ? raw.supabaseUrl : '',
    publishableKey: typeof raw.publishableKey === 'string' ? raw.publishableKey : ''
  });
}

export function createPathHelpers(config) {
  const appBase = normalizeAppBase(config.appBase);
  return Object.freeze({
    assetUrl(path) {
      if (typeof path !== 'string' || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\.[A-Za-z0-9]+)?$/.test(path)) throw new Error('Invalid asset path');
      return `${appBase}${path}`;
    },
    pageUrl(page, params) {
      if (!PAGES.has(page)) throw new Error('Invalid page');
      const query = params ? new URLSearchParams(params).toString() : '';
      return `${appBase}${page}/${query ? `?${query}` : ''}`;
    },
    routeName(pathname) {
      for (const page of PAGES) if ([`${appBase}${page}`, `${appBase}${page}/`, `${appBase}${page}/index.html`].includes(pathname)) return page;
      return 'play';
    },
    apiUrl(logicalPath) {
      if (!config.enabled || !config.apiBaseUrl) {
        const error = new Error('학급 연결이 아직 준비되지 않았어요. 그림은 이 기기에서 계속 만들 수 있어요.');
        error.code = 'CONFIGURATION_REQUIRED';
        throw error;
      }
      if (typeof logicalPath !== 'string' || !/^\/api\/rooms(?:\/[A-Za-z0-9_-]+)*(?:\?[A-Za-z0-9_=&%-]+)?$/.test(logicalPath)) throw new Error('Invalid API path');
      return `${config.apiBaseUrl}/games/autumn-leaf${logicalPath.slice('/api'.length)}`;
    }
  });
}

export const runtimeConfig = resolveRuntimeConfig(globalThis.LEAF_RUNTIME_CONFIG);
const paths = createPathHelpers(runtimeConfig);
export const {assetUrl, pageUrl, routeName, apiUrl} = paths;
