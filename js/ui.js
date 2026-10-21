/* =========================================================================
   Shared UI primitives — toasts, modals, nav, reveal animations, particles.
   Kept deliberately light: no layout thrash, no DOM churn, rAF-throttled.
   ========================================================================= */

import { SERVER, SITE } from './config.js';

/* ----------------------------- helpers ------------------------------- */

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

export function debounce(fn, wait = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

const reduceMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------ toasts -------------------------------- */

export function ensureToastHost() {
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.className = 'toast-host';
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-atomic', 'false');
    document.body.appendChild(host);
  }
  return host;
}

const TOAST_ICONS = {
  success: 'fa-solid fa-check-circle',
  error: 'fa-solid fa-circle-exclamation',
  warning: 'fa-solid fa-triangle-exclamation',
  info: 'fa-solid fa-circle-info'
};

export function toast({ title, message = '', type = 'info', duration = 4200 } = {}) {
  const host = ensureToastHost();

  while (host.children.length >= 3) host.firstElementChild.remove();

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const icon = document.createElement('span');
  icon.className = 'toast__icon';
  icon.innerHTML = `<i class="${TOAST_ICONS[type] || TOAST_ICONS.info}"></i>`;

  const body = document.createElement('div');
  body.className = 'toast__body';

  const heading = document.createElement('strong');
  heading.className = 'toast__title';
  heading.textContent = title || '';

  const text = document.createElement('p');
  text.className = 'toast__text';
  text.textContent = message;

  body.append(heading, text);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast__close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  close.addEventListener('click', () => dismiss());

  const bar = document.createElement('span');
  bar.className = 'toast__bar';
  bar.style.animationDuration = `${duration}ms`;

  el.append(icon, body, close, bar);
  host.appendChild(el);

  requestAnimationFrame(() => el.classList.add('is-visible'));

  let timer = setTimeout(dismiss, duration);

  function dismiss() {
    clearTimeout(timer);
    el.classList.remove('is-visible');
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 260);
  }

  el.addEventListener('mouseenter', () => {
    clearTimeout(timer);
    el.classList.add('is-paused');
  });
  el.addEventListener('mouseleave', () => {
    el.classList.remove('is-paused');
    timer = setTimeout(dismiss, 1400);
  });

  return { dismiss };
}

/* ------------------------------ modals -------------------------------- */

let lastFocused = null;
let trapHandler = null;

export function openModal(target) {
  const modal = typeof target === 'string' ? document.getElementById(target) : target;
  if (!modal) return;

  qsa('.modal.is-open').forEach((m) => m.classList.remove('is-open'));

  lastFocused = document.activeElement;
  modal.classList.add('is-open');
  document.body.classList.add('modal-open');

  const focusable = modal.querySelector(
    'input:not([type="hidden"]), select, textarea, button:not([disabled]), a[href]'
  );
  setTimeout(() => {
    (focusable || modal).focus({ preventScroll: true });
  }, 60);

  if (trapHandler) document.removeEventListener('keydown', trapHandler);
  trapHandler = (event) => {
    if (event.key !== 'Tab') return;
    const nodes = qsa(
      'input:not([type="hidden"]), select, textarea, button:not([disabled]), a[href]',
      modal
    ).filter((node) => node.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', trapHandler);
}

export function closeModal(target) {
  const modal = typeof target === 'string' ? document.getElementById(target) : target;
  if (!modal) return;
  modal.classList.remove('is-open');
  if (!qsa('.modal.is-open').length) {
    document.body.classList.remove('modal-open');
  }
  if (trapHandler) {
    document.removeEventListener('keydown', trapHandler);
    trapHandler = null;
  }
  if (lastFocused && typeof lastFocused.focus === 'function') {
    lastFocused.focus({ preventScroll: true });
    lastFocused = null;
  }
}

export function closeAllModals() {
  qsa('.modal.is-open').forEach((modal) => closeModal(modal));
}

let modalsBound = false;

export function initModals() {
  if (modalsBound) return;
  modalsBound = true;

  document.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-open-modal]');
    if (opener) {
      event.preventDefault();
      openModal(opener.dataset.openModal);
      return;
    }

    const closer = event.target.closest('[data-close-modal]');
    if (closer) {
      event.preventDefault();
      closeModal(closer.closest('.modal'));
      return;
    }

    const backdrop = event.target;
    if (backdrop.classList && backdrop.classList.contains('modal')) {
      closeModal(backdrop);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = qs('.modal.is-open');
    if (open) closeModal(open);
  });
}

/* --------------------------- password toggle -------------------------- */

let passwordTogglesBound = false;

export function initPasswordToggles() {
  if (passwordTogglesBound) return;
  passwordTogglesBound = true;

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-toggle-password]');
    if (!btn) return;
    const field = btn.closest('.input-group')?.querySelector('input');
    if (!field) return;
    const showing = field.type === 'text';
    field.type = showing ? 'password' : 'text';
    btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    btn.classList.toggle('is-active', !showing);
    btn.innerHTML = showing
      ? '<i class="fa-solid fa-eye"></i>'
      : '<i class="fa-solid fa-eye-slash"></i>';
  });
}

/* ------------------------------ clipboard ----------------------------- */

export async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    if (navigator.vibrate) navigator.vibrate(40);
    return true;
  } catch {
    return false;
  }
}

let copyButtonsBound = false;

export function initCopyButtons() {
  if (copyButtonsBound) return;
  copyButtonsBound = true;

  document.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-copy]');
    if (!btn) return;
    event.preventDefault();
    const value = btn.dataset.copy;
    const ok = await copyText(value);
    if (ok) {
      toast({
        title: 'IP copied',
        message: `${value} is on your clipboard. Paste it in Minecraft → Multiplayer → Add Server.`,
        type: 'success',
        duration: 4600
      });
    } else {
      toast({
        title: 'Copy failed',
        message: `Copy it manually: ${value}`,
        type: 'error'
      });
    }
  });
}

/* -------------------------------- nav --------------------------------- */

let navBound = false;

export function initNav() {
  if (navBound) return;
  navBound = true;

  const nav = document.getElementById('siteNav');
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');

  if (nav) {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        nav.classList.toggle('is-scrolled', window.scrollY > 12);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.classList.toggle('is-active', open);
    });

    links.addEventListener('click', (event) => {
      if (event.target.closest('a')) {
        links.classList.remove('is-open');
        toggle.classList.remove('is-active');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }
}

/* --------------------------- scroll progress -------------------------- */

export function initScrollProgress() {
  const bar = document.getElementById('scrollProgress');
  if (!bar) return;

  let ticking = false;
  const update = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const progress = max > 0 ? doc.scrollTop / max : 0;
      bar.style.transform = `scaleX(${progress})`;
      ticking = false;
    });
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}

/* ----------------------------- reveal-on-scroll ----------------------- */

export function initReveal() {
  const nodes = qsa('[data-reveal]');
  if (!nodes.length) return;

  if (!('IntersectionObserver' in window) || reduceMotion()) {
    nodes.forEach((node) => node.classList.add('is-revealed'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
  );

  nodes.forEach((node) => observer.observe(node));
}

/* ------------------------------ particles ----------------------------- */

export function initParticles(canvas) {
  if (!canvas || reduceMotion()) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const PALETTE = ['0,225,255', '108,92,231', '255,45,133'];
  const isSmall = window.matchMedia('(max-width: 768px)').matches;
  const COUNT = isSmall ? 26 : 52;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let frame = 0;
  let running = false;

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn() {
    particles = Array.from({ length: COUNT }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.6 + 0.4,
      vx: (Math.random() - 0.5) * 0.16,
      vy: -(Math.random() * 0.22 + 0.05),
      a: Math.random() * 0.35 + 0.08,
      c: PALETTE[(Math.random() * PALETTE.length) | 0],
      phase: Math.random() * Math.PI * 2
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.phase += 0.008;

      if (p.y < -12) {
        p.y = height + 12;
        p.x = Math.random() * width;
      }
      if (p.x < -12) p.x = width + 12;
      if (p.x > width + 12) p.x = -12;

      const twinkle = 0.65 + Math.sin(p.phase) * 0.35;
      ctx.beginPath();
      ctx.fillStyle = `rgba(${p.c},${(p.a * twinkle).toFixed(3)})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    frame = requestAnimationFrame(draw);
  }

  function start() {
    if (running) return;
    running = true;
    frame = requestAnimationFrame(draw);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frame);
  }

  size();
  spawn();
  start();

  const onResize = debounce(() => {
    size();
    spawn();
  }, 200);
  window.addEventListener('resize', onResize, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });
}

/* --------------------------- count-up numbers ------------------------- */

export function countUp(node, to, { duration = 900, suffix = '' } = {}) {
  if (!node) return;
  if (reduceMotion()) {
    node.textContent = `${to}${suffix}`;
    return;
  }
  const start = performance.now();
  const from = 0;

  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = `${Math.round(from + (to - from) * eased)}${suffix}`;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ------------------------ server address hydration -------------------- */

/* Any element with data-ip="primary|alternate" gets the live address from
   config.js. Elements with data-copy get the clipboard value too. */
export function bindServerAddresses(root = document) {
  root.querySelectorAll('[data-ip]').forEach((node) => {
    const address = SERVER[node.dataset.ip];
    if (!address) return;
    if (node.hasAttribute('data-copy')) {
      node.dataset.copy = address.ip;
    } else {
      node.textContent = address.ip;
    }
  });

  root.querySelectorAll('[data-discord]').forEach((link) => {
    link.href = SITE.discord;
  });
}
