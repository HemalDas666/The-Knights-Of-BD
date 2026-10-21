/* =========================================================================
   Live server status — no backend required.
   Primary source : api.mcstatus.io  (CORS enabled, rich data)
   Fallback source: api.mcsrvstat.us (CORS enabled)
   Results are cached per tab so multiple widgets never double-fetch.
   ========================================================================= */

import { SERVER } from './config.js';

const CACHE_PREFIX = 'kbd:status:';

function cacheKey(server) {
  return `${CACHE_PREFIX}${server.host}:${server.port}`;
}

function readCache(server) {
  try {
    const raw = sessionStorage.getItem(cacheKey(server));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed._at) return null;
    if (Date.now() - parsed._at > SERVER.statusCacheMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(server, data) {
  try {
    sessionStorage.setItem(cacheKey(server), JSON.stringify(data));
  } catch {
    /* private mode / quota — ignore */
  }
}

async function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
  } finally {
    clearTimeout(timer);
  }
}

/* Minecraft MOTD can contain legacy formatting codes like §a */
export function cleanMotd(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/§[0-9a-fk-orx]/gi, '')
    .replace(/[\u0000-\u001f]+/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function safeIcon(raw) {
  if (typeof raw !== 'string') return '';
  if (raw.startsWith('data:image/png;base64,')) return raw;
  if (/^https:\/\/api\.mcsrvstat\.us\/icon\/[A-Za-z0-9._:-]+$/.test(raw)) return raw;
  return '';
}

async function fromMcStatusIO(server) {
  const url = `https://api.mcstatus.io/v2/status/java/${encodeURIComponent(server.host)}:${server.port}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`mcstatus.io ${res.status}`);
  const data = await res.json();

  return {
    online: Boolean(data.online),
    players: {
      online: Number(data.players?.online) || 0,
      max: Number(data.players?.max) || 0
    },
    version: data.version?.name_clean || 'Unknown',
    motd: cleanMotd(data.motd?.clean),
    icon: safeIcon(data.icon),
    host: server.host,
    port: server.port,
    source: 'mcstatus.io',
    _at: Date.now()
  };
}

async function fromMcSrvStat(server) {
  const url = `https://api.mcsrvstat.us/3/${encodeURIComponent(server.host)}:${server.port}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`mcsrvstat.us ${res.status}`);
  const data = await res.json();

  return {
    online: Boolean(data.online),
    players: {
      online: Number(data.players?.online) || 0,
      max: Number(data.players?.max) || 0
    },
    version: data.version || 'Unknown',
    motd: cleanMotd((data.motd?.clean || []).join('\n')),
    icon: safeIcon(data.icon),
    host: server.host,
    port: server.port,
    source: 'mcsrvstat.us',
    _at: Date.now()
  };
}

const OFFLINE = (server) => ({
  online: false,
  players: { online: 0, max: 0 },
  version: '—',
  motd: '',
  icon: '',
  host: server.host,
  port: server.port,
  source: 'none',
  unreachable: true,
  _at: Date.now()
});

export async function getStatus(server, { force = false } = {}) {
  if (!force) {
    const cached = readCache(server);
    if (cached) return cached;
  }

  const attempts = [fromMcStatusIO, fromMcSrvStat];
  for (const attempt of attempts) {
    try {
      const data = await attempt(server);
      writeCache(server, data);
      return data;
    } catch {
      /* try the next provider */
    }
  }

  const fallback = OFFLINE(server);
  writeCache(server, fallback);
  return fallback;
}

/* ------------------------------------------------------------------ */

const SELECTORS = {
  pill: '[data-status-pill]',
  label: '[data-status-label]',
  online: '[data-status-online]',
  max: '[data-status-max]',
  bar: '[data-status-bar]',
  version: '[data-status-version]',
  motd: '[data-status-motd]',
  updated: '[data-status-updated]',
  icon: '[data-status-icon]',
  refresh: '[data-status-refresh]'
};

function relativeTime(ts) {
  const diff = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.round(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function paint(widget, data) {
  const set = (sel, value) => {
    const node = widget.querySelector(sel);
    if (node) node.textContent = value;
  };

  widget.classList.toggle('is-online', data.online);
  widget.classList.toggle('is-offline', !data.online);
  widget.dataset.loaded = 'true';
  widget.dataset.lastAt = String(data._at || Date.now());

  const pill = widget.querySelector(SELECTORS.pill);
  if (pill) {
    pill.classList.toggle('is-online', data.online);
    pill.classList.toggle('is-offline', !data.online);
  }

  set(SELECTORS.label, data.online ? 'Online' : 'Offline');
  set(SELECTORS.online, data.online ? String(data.players.online) : '—');
  set(SELECTORS.max, data.online ? String(data.players.max || '—') : '—');
  set(SELECTORS.version, data.online ? data.version : '—');
  set(SELECTORS.updated, relativeTime(data._at || Date.now()));

  const motd = widget.querySelector(SELECTORS.motd);
  if (motd) {
    motd.textContent = data.online ? data.motd : 'Server is currently offline.';
    motd.hidden = false;
  }

  const bar = widget.querySelector(SELECTORS.bar);
  if (bar) {
    const pct = data.online && data.players.max
      ? Math.min(100, Math.round((data.players.online / data.players.max) * 100))
      : 0;
    bar.style.width = `${pct}%`;
  }

  const icon = widget.querySelector(SELECTORS.icon);
  if (icon) {
    if (data.icon) {
      icon.src = data.icon;
      icon.hidden = false;
    } else {
      icon.hidden = true;
    }
  }
}

function startWidget(widget) {
  if (widget.dataset.statusBound === 'true') return;
  widget.dataset.statusBound = 'true';

  const server = {
    host: widget.dataset.statusHost || SERVER.primary.host,
    port: Number(widget.dataset.statusPort) || SERVER.primary.port
  };

  let busy = false;

  async function refresh(force = false) {
    if (busy) return;
    busy = true;
    widget.classList.add('is-loading');
    try {
      const data = await getStatus(server, { force });
      paint(widget, data);
    } finally {
      widget.classList.remove('is-loading');
      busy = false;
    }
  }

  const refreshBtn = widget.querySelector(SELECTORS.refresh);
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => refresh(true));
  }

  refresh(false);

  const timer = setInterval(() => {
    if (!document.hidden) refresh(false);
  }, SERVER.statusRefreshMs);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh(false);
  });

  widget._kbdTimer = timer;
}

export function mountStatusWidgets(root = document) {
  root.querySelectorAll('[data-status]').forEach(startWidget);

  /* Keep "updated 12s ago" labels fresh without refetching. */
  setInterval(() => {
    document.querySelectorAll('[data-status]').forEach((widget) => {
      const at = Number(widget.dataset.lastAt) || 0;
      if (at) {
        const node = widget.querySelector(SELECTORS.updated);
        if (node) node.textContent = relativeTime(at);
      }
    });
  }, 15000);
}
