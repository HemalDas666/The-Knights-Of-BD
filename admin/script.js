/* =========================================================================
   OWNER CONSOLE — auth gate, live queues and wallet operations.
   -------------------------------------------------------------------------
   The UI is a convenience layer. Firestore rules are the real lock:
   only dasheaml08@gmail.com, with a verified email, may read or write.
   ========================================================================= */

import { auth } from '../js/firebase.js';
import {
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { ADMIN, formatBDT, itemById } from '../js/config.js';
import { isAdminEmail } from '../js/wallet.js';
import {
  adjustBalance,
  adminErrorMessage,
  approveTopup,
  cancelOrder,
  deductAndPayOrder,
  markDelivered,
  markOrderPaid,
  rejectTopup,
  watchAdminLogs,
  watchAllOrders,
  watchAllTopups,
  watchAllUsers,
  watchAllWallets
} from '../js/admin-data.js';
import {
  closeModal,
  copyText,
  debounce,
  escapeHTML,
  initModals,
  initPasswordToggles,
  openModal,
  toast
} from '../js/ui.js';

/* ------------------------------- helpers -------------------------------- */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = (value) => formatBDT(Number(value) || 0);
const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const FALLBACK_AVATAR = '../assets/KnightLOGO9.png';
const VALID_IGN = /^[A-Za-z0-9_]{3,16}$/;

function timeMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  return Number(value) || 0;
}

function relativeTime(value) {
  const ts = timeMs(value);
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short'
  });
}

function exactTime(value) {
  const ts = timeMs(value);
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function dateShort(value) {
  const ts = timeMs(value);
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function avatarMarkup(ign, className = 'admin-avatar') {
  const name = String(ign || '').trim();
  const valid = VALID_IGN.test(name);
  const src = valid
    ? `https://mc-heads.net/avatar/${encodeURIComponent(name)}/64`
    : FALLBACK_AVATAR;
  return `<img class="${className}" src="${src}" alt="" width="44" height="44" loading="lazy" decoding="async" referrerpolicy="no-referrer" ${
    valid ? 'data-avatar="1"' : ''
  }>`;
}

const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Credited',
  rejected: 'Rejected',
  paid: 'Paid',
  delivered: 'Delivered',
  cancelled: 'Cancelled'
};

function statusClass(status) {
  return STATUS_LABELS[status] ? status : 'pending';
}

function statusBadge(status, label) {
  const cls = statusClass(status);
  return `<span class="admin-badge admin-badge--${cls}">${escapeHTML(
    label || STATUS_LABELS[cls]
  )}</span>`;
}

const METHOD_META = {
  bkash: { label: 'bKash', icon: 'fa-solid fa-mobile-screen-button' },
  nagad: { label: 'Nagad', icon: 'fa-solid fa-mobile-screen-button' },
  wallet: { label: 'Wallet', icon: 'fa-solid fa-wallet' }
};

function methodBadge(method) {
  const meta = METHOD_META[method] || {
    label: method ? String(method) : 'Unknown',
    icon: 'fa-solid fa-money-bill'
  };
  const cls = METHOD_META[method] ? method : 'other';
  return `<span class="admin-method admin-method--${cls}"><i class="${meta.icon}"></i>${escapeHTML(
    meta.label
  )}</span>`;
}

function emptyState(icon, title, text) {
  return `<div class="admin-empty">
    <span class="admin-empty__icon"><i class="${icon}"></i></span>
    <strong>${escapeHTML(title)}</strong>
    <p>${escapeHTML(text)}</p>
  </div>`;
}

function skeleton(count = 2, modifier = '') {
  return Array.from(
    { length: count },
    () =>
      `<div class="admin-skeleton ${modifier}"><span></span><span></span><span></span></div>`
  ).join('');
}

function paint(host, html) {
  if (!host || host._painted === html) return;
  host.innerHTML = html;
  host._painted = html;
}

function setButtonBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
}

/* -------------------------------- state --------------------------------- */

const state = {
  authResolved: false,
  user: null,
  started: false,
  view: 'overview',
  topups: [],
  orders: [],
  users: [],
  wallets: new Map(),
  logs: [],
  loading: { topups: true, orders: true, users: true, wallets: true, logs: true },
  unsubs: [],
  topupFilter: 'pending',
  orderFilter: 'pending',
  playerQuery: '',
  permissionDenied: false,
  errorToastShown: false,
  selectedPlayerUid: null,
  adjustMode: 'add'
};

const adminBoot = document.getElementById('adminBoot');
const gateLogin = document.getElementById('gateLogin');
const gateVerify = document.getElementById('gateVerify');
const gateDenied = document.getElementById('gateDenied');
const adminShell = document.getElementById('adminShell');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminLoginError = document.getElementById('adminLoginError');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const setupBanner = document.getElementById('setupBanner');
const playerModal = document.getElementById('playerModal');
const playerModalBody = document.getElementById('playerModalBody');
const adminConfirm = document.getElementById('adminConfirm');
const confirmIcon = document.getElementById('confirmIcon');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmSummary = document.getElementById('confirmSummary');
const confirmInputWrap = document.getElementById('confirmInputWrap');
const confirmInputLabel = document.getElementById('confirmInputLabel');
const confirmInput = document.getElementById('confirmInput');
const confirmError = document.getElementById('confirmError');
const confirmOk = document.getElementById('confirmOk');
const confirmCancel = document.getElementById('confirmCancel');

/* ------------------------------- auth gate ------------------------------ */

function setGate(which) {
  const gates = {
    boot: adminBoot,
    login: gateLogin,
    verify: gateVerify,
    denied: gateDenied,
    shell: adminShell
  };

  Object.entries(gates).forEach(([key, node]) => {
    if (node) node.hidden = key !== which;
  });

  document.body.classList.toggle('admin-gate-mode', which !== 'shell');

  if (which !== 'shell') {
    $$('.modal.is-open').forEach((modal) => closeModal(modal));
  }

  window.scrollTo(0, 0);
}

function populateIdentity(user) {
  $$('[data-admin-email]').forEach((node) => {
    node.textContent = user?.email || ADMIN.email;
  });
}

function showLoginError(message) {
  if (!adminLoginError) return;
  adminLoginError.textContent = message;
  adminLoginError.hidden = false;
}

function clearLoginError() {
  if (!adminLoginError) return;
  adminLoginError.textContent = '';
  adminLoginError.hidden = true;
}

function authErrorMessage(error) {
  switch (error?.code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is incorrect.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/invalid-email':
      return 'That email address is not valid.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/requires-recent-login':
      return 'Please sign in again, then resend the verification email.';
    default:
      return 'Could not sign in. Please try again.';
  }
}

async function handleAuthState(user) {
  state.authResolved = true;
  state.user = user || null;

  if (!user) {
    stopListeners();
    resetData();
    state.started = false;
    setGate('login');
    return;
  }

  if (!isAdminEmail(user)) {
    stopListeners();
    state.started = false;
    const email = document.getElementById('deniedEmail');
    if (email) email.textContent = user.email || '—';
    setGate('denied');
    return;
  }

  if (!user.emailVerified) {
    stopListeners();
    state.started = false;
    const email = document.getElementById('verifyEmail');
    if (email) email.textContent = user.email || ADMIN.email;
    setGate('verify');
    return;
  }

  populateIdentity(user);

  if (state.started) {
    setGate('shell');
    return;
  }

  state.started = true;

  try {
    await user.getIdToken(true);
  } catch (error) {
    console.warn('[TKBD admin] Could not refresh token:', error?.code || error);
  }

  setGate('shell');
  setView('overview');
  startListeners();
}

async function doSignOut() {
  try {
    await signOut(auth);
    toast({ title: 'Signed out', message: 'The console is locked.', type: 'info' });
  } catch (error) {
    toast({
      title: 'Could not sign out',
      message: error?.message || 'Please try again.',
      type: 'error'
    });
  }
}

/* ----------------------------- data wiring ------------------------------ */

function resetData() {
  state.topups = [];
  state.orders = [];
  state.users = [];
  state.wallets = new Map();
  state.logs = [];
  state.loading = {
    topups: true,
    orders: true,
    users: true,
    wallets: true,
    logs: true
  };
  state.permissionDenied = false;
  state.errorToastShown = false;
  state.selectedPlayerUid = null;
  state.adjustMode = 'add';
  state.topupFilter = 'pending';
  state.orderFilter = 'pending';
  state.playerQuery = '';
  state.view = 'overview';
  document.title = 'Staff Console | The Knights Of BD';
  hideSetupBanner();
}

function stopListeners() {
  state.unsubs.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch {
      /* already stopped */
    }
  });
  state.unsubs = [];
}

function startListeners() {
  stopListeners();
  state.permissionDenied = false;
  state.errorToastShown = false;
  state.loading = {
    topups: true,
    orders: true,
    users: true,
    wallets: true,
    logs: true
  };
  hideSetupBanner();
  renderAll();

  state.unsubs.push(
    watchAllTopups((rows) => {
      state.topups = rows;
      state.loading.topups = false;
      renderTopups();
      renderOverview();
      updateCounts();
    }, handleDataError),
    watchAllOrders((rows) => {
      state.orders = rows;
      state.loading.orders = false;
      renderOrders();
      renderOverview();
      renderPlayers();
      updateCounts();
    }, handleDataError),
    watchAllUsers((rows) => {
      state.users = rows;
      state.loading.users = false;
      renderPlayers();
    }, handleDataError),
    watchAllWallets((rows) => {
      state.wallets = new Map(rows.map((wallet) => [wallet.uid, wallet]));
      state.loading.wallets = false;
      renderPlayers();
      renderOrders();
      renderOverview();
    }, handleDataError),
    watchAdminLogs((rows) => {
      state.logs = rows;
      state.loading.logs = false;
      renderOverview();
    }, handleDataError)
  );

  syncFilterButtons();
}

function handleDataError(error) {
  console.error('[TKBD admin] Firestore listener failed:', error);
  state.loading = {
    topups: false,
    orders: false,
    users: false,
    wallets: false,
    logs: false
  };

  if (error?.code === 'permission-denied') {
    state.permissionDenied = true;
    showSetupBanner();
  }

  if (!state.errorToastShown) {
    state.errorToastShown = true;
    toast({
      title:
        error?.code === 'permission-denied'
          ? 'Firestore access blocked'
          : 'Connection problem',
      message: adminErrorMessage(error),
      type: 'error',
      duration: 8000
    });
  }

  renderAll();
}

function showSetupBanner() {
  if (setupBanner) setupBanner.hidden = false;
}

function hideSetupBanner() {
  if (setupBanner) setupBanner.hidden = true;
}

function renderAll() {
  renderOverview();
  renderTopups();
  renderOrders();
  renderPlayers();
  updateCounts();
}

function syncFilterButtons() {
  $$('[data-topup-filter]').forEach((button) => {
    button.classList.toggle(
      'is-active',
      button.dataset.topupFilter === state.topupFilter
    );
  });
  $$('[data-order-filter]').forEach((button) => {
    button.classList.toggle(
      'is-active',
      button.dataset.orderFilter === state.orderFilter
    );
  });
}

/* -------------------------------- counts -------------------------------- */

function getFilterCount(key) {
  const [group, value] = String(key).split('.');
  if (group === 'topups') {
    if (value === 'all') return state.topups.length;
    return state.topups.filter((row) => row.status === value).length;
  }
  if (group === 'orders') {
    if (value === 'all') return state.orders.length;
    if (value === 'wallet') {
      return state.orders.filter((row) => row.method === 'wallet').length;
    }
    return state.orders.filter((row) => row.status === value).length;
  }
  return 0;
}

function updateCounts() {
  const pendingTopups = state.topups.filter(
    (row) => row.status === 'pending'
  ).length;
  const pendingOrders = state.orders.filter(
    (row) => row.status === 'pending'
  ).length;

  const badgeText = (count) => (count > 99 ? '99+' : String(count));

  $$('[data-nav-badge="topups"]').forEach((node) => {
    node.hidden = pendingTopups === 0;
    node.textContent = badgeText(pendingTopups);
  });
  $$('[data-nav-badge="orders"]').forEach((node) => {
    node.hidden = pendingOrders === 0;
    node.textContent = badgeText(pendingOrders);
  });
  $$('[data-nav-dot="topups"]').forEach((node) => {
    node.hidden = pendingTopups === 0;
  });
  $$('[data-nav-dot="orders"]').forEach((node) => {
    node.hidden = pendingOrders === 0;
  });

  $$('[data-filter-count]').forEach((node) => {
    node.textContent = badgeText(getFilterCount(node.dataset.filterCount));
  });

  const total = pendingTopups + pendingOrders;
  document.title = total
    ? `(${total}) Staff Console | The Knights Of BD`
    : 'Staff Console | The Knights Of BD';
}

function animateStat(node, value, isMoney) {
  if (!node) return;
  const from = Number(String(node.textContent).replace(/[^\d]/g, '')) || 0;
  const target = Number(value) || 0;
  const render = (current) =>
    (node.textContent = isMoney ? money(current) : String(current));

  if (reducedMotion() || from === target) {
    render(target);
    return;
  }

  if (node._statRaf) cancelAnimationFrame(node._statRaf);
  const started = performance.now();
  const duration = 620;

  const step = (now) => {
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    render(Math.round(from + (target - from) * eased));
    if (progress < 1) node._statRaf = requestAnimationFrame(step);
  };

  node._statRaf = requestAnimationFrame(step);
}

function setStat(name, value, isMoney = false) {
  const node = $(`[data-stat="${name}"]`);
  if (!node) return;
  const key = String(value);
  if (node.dataset.statValue === key) return;
  node.dataset.statValue = key;
  animateStat(node, value, isMoney);
}

/* ------------------------------ overview -------------------------------- */

function renderOverview() {
  const pendingTopups = state.topups.filter(
    (row) => row.status === 'pending'
  ).length;
  const pendingOrders = state.orders.filter(
    (row) => row.status === 'pending'
  ).length;
  const walletOrders = state.orders.filter(
    (row) => row.method === 'wallet' && row.status === 'pending'
  ).length;
  const liability = [...state.wallets.values()].reduce(
    (sum, wallet) => sum + (Number(wallet.balance) || 0),
    0
  );

  setStat('pendingTopups', pendingTopups);
  setStat('walletOrders', walletOrders);
  setStat('pendingOrders', pendingOrders);
  setStat('liability', liability, true);

  renderAttention();
  renderActivity();
}

function renderAttention() {
  const host = document.getElementById('attentionList');
  if (!host) return;

  if (state.loading.topups || state.loading.orders) {
    paint(host, skeleton(2));
    return;
  }

  if (state.permissionDenied && !state.topups.length && !state.orders.length) {
    paint(
      host,
      emptyState(
        'fa-solid fa-lock',
        'Waiting for Firestore access',
        'Publish the updated rules, then press Retry on the banner above.'
      )
    );
    return;
  }

  const rows = [
    ...state.topups
      .filter((topup) => topup.status === 'pending')
      .map((topup) => ({
        type: 'topup',
        at: timeMs(topup.createdAt),
        data: topup
      })),
    ...state.orders
      .filter((order) => order.status === 'pending')
      .map((order) => ({
        type: 'order',
        at: timeMs(order.createdAt),
        data: order
      }))
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 7);

  if (!rows.length) {
    paint(
      host,
      emptyState(
        'fa-solid fa-check-double',
        'Inbox zero',
        'No top-ups or orders are waiting for a decision.'
      )
    );
    return;
  }

  paint(
    host,
    rows
      .map((row, index) => {
        if (row.type === 'topup') {
          const topup = row.data;
          const name = topup.username || topup.ign || topup.email || 'Player';
          return `<button type="button" class="admin-attention admin-attention--gold" data-jump="topups" data-jump-filter="pending" style="--i:${index}">
            <span class="admin-attention__icon"><i class="fa-solid fa-arrow-down-long"></i></span>
            <span class="admin-attention__body">
              <strong>Top-up from ${escapeHTML(name)}</strong>
              <span>${escapeHTML(METHOD_META[topup.method]?.label || topup.method || 'Payment')} · ${escapeHTML(relativeTime(topup.createdAt))}</span>
            </span>
            <span class="admin-attention__side"><b>${money(topup.amount)}</b><i class="fa-solid fa-arrow-right"></i></span>
          </button>`;
        }

        const order = row.data;
        const name = order.username || order.ign || order.email || 'Player';
        return `<button type="button" class="admin-attention admin-attention--pink" data-jump="orders" data-jump-filter="pending" style="--i:${index}">
          <span class="admin-attention__icon"><i class="fa-solid fa-receipt"></i></span>
          <span class="admin-attention__body">
            <strong>${escapeHTML(order.itemName || 'Order')} · ${escapeHTML(name)}</strong>
            <span>${escapeHTML(METHOD_META[order.method]?.label || order.method || 'Payment')} · ${escapeHTML(order.orderId || order.id)}</span>
          </span>
          <span class="admin-attention__side"><b>${money(order.amount)}</b><i class="fa-solid fa-arrow-right"></i></span>
        </button>`;
      })
      .join('')
  );
}

function logDescriptor(log) {
  const name = log.targetName || 'Player';
  const item = log.itemName || 'order';
  const amount = Number(log.amount) || 0;
  const delta = Number(log.delta) || 0;

  switch (log.action) {
    case 'topup.approved':
      return {
        icon: 'fa-solid fa-arrow-down-long',
        tone: 'gold',
        text: `Credited ${money(amount)} to ${name}`
      };
    case 'topup.rejected':
      return {
        icon: 'fa-solid fa-xmark',
        tone: 'red',
        text: `Rejected a ${money(amount)} top-up from ${name}`
      };
    case 'order.paid':
      return {
        icon: 'fa-solid fa-check',
        tone: 'cyan',
        text: `Marked ${item} paid for ${name}`
      };
    case 'order.wallet_paid':
      return {
        icon: 'fa-solid fa-wallet',
        tone: 'pink',
        text: `Deducted ${money(amount)} from ${name} for ${item}`
      };
    case 'order.delivered':
      return {
        icon: 'fa-solid fa-box-open',
        tone: 'green',
        text: `Delivered ${item} to ${name}`
      };
    case 'order.refunded':
      return {
        icon: 'fa-solid fa-rotate-left',
        tone: 'gold',
        text: `Refunded ${money(amount)} to ${name}`
      };
    case 'order.cancelled':
      return {
        icon: 'fa-solid fa-ban',
        tone: 'red',
        text: `Cancelled ${item} for ${name}`
      };
    case 'wallet.adjust':
      return {
        icon: 'fa-solid fa-sliders',
        tone: delta > 0 ? 'green' : 'red',
        text: `${delta > 0 ? 'Added' : 'Removed'} ${money(
          Math.abs(delta)
        )} ${delta > 0 ? 'to' : 'from'} ${name}`
      };
    default:
      return {
        icon: 'fa-solid fa-circle-info',
        tone: 'muted',
        text: `${String(log.action || 'Action')} · ${name}`
      };
  }
}

function ownerLabel(by) {
  if (!by) return 'Console';
  if (state.user?.email && by === state.user.email) return 'Owner';
  return by;
}

function renderActivity() {
  const host = document.getElementById('activityList');
  if (!host) return;

  if (state.loading.logs) {
    paint(host, skeleton(3));
    return;
  }

  if (!state.logs.length) {
    paint(
      host,
      emptyState(
        state.permissionDenied ? 'fa-solid fa-lock' : 'fa-solid fa-clock-rotate-left',
        state.permissionDenied ? 'No activity loaded' : 'No activity yet',
        state.permissionDenied
          ? 'Publish the Firestore rules, then press Retry.'
          : 'Credits, deductions and deliveries will be logged here.'
      )
    );
    return;
  }

  paint(
    host,
    state.logs
      .slice(0, 8)
      .map((log, index) => {
        const info = logDescriptor(log);
        return `<div class="admin-activity" style="--i:${index}">
          <span class="admin-activity__icon admin-activity__icon--${info.tone}"><i class="${info.icon}"></i></span>
          <div class="admin-activity__body">
            <p>${escapeHTML(info.text)}</p>
            <span title="${escapeHTML(exactTime(log.at))}">${escapeHTML(
              relativeTime(log.at)
            )} · ${escapeHTML(ownerLabel(log.by))}</span>
          </div>
        </div>`;
      })
      .join('')
  );
}

/* -------------------------------- top-ups ------------------------------- */

function filteredTopups() {
  if (state.topupFilter === 'all') return state.topups;
  return state.topups.filter((topup) => topup.status === state.topupFilter);
}

function topupCard(topup, index) {
  const status = statusClass(topup.status);
  const name = topup.username || topup.ign || topup.email || 'Player';
  const method = METHOD_META[topup.method]?.label || topup.method || 'Payment';
  const reviewed = timeMs(topup.reviewedAt);
  const pending = topup.status === 'pending';

  const actions = pending
    ? `<button type="button" class="btn btn-primary btn-sm" data-approve-topup="${escapeHTML(
        topup.id
      )}">
        <span class="btn__label"><i class="fa-solid fa-check"></i> Approve</span>
        <span class="btn__spinner" aria-hidden="true"></span>
      </button>
      <button type="button" class="btn btn-danger btn-sm" data-reject-topup="${escapeHTML(
        topup.id
      )}">
        <span class="btn__label"><i class="fa-solid fa-xmark"></i> Reject</span>
        <span class="btn__spinner" aria-hidden="true"></span>
      </button>`
    : '';

  return `<article class="admin-item" style="--i:${index}">
    ${avatarMarkup(topup.ign)}
    <div class="admin-item__body">
      <div class="admin-item__top">
        <div class="admin-item__identity">
          <strong>${escapeHTML(name)}</strong>
          <span>${escapeHTML(topup.email || 'No email on request')}</span>
        </div>
        <span class="admin-item__amount">${money(topup.amount)}</span>
      </div>

      <div class="admin-item__tags">
        ${statusBadge(status)}
        ${methodBadge(topup.method)}
        <span class="admin-badge admin-badge--ghost">IGN: ${escapeHTML(topup.ign || '—')}</span>
      </div>

      <div class="admin-item__meta">
        <span><i class="fa-solid fa-phone"></i> Sender <b>${escapeHTML(
          topup.senderNumber || '—'
        )}</b>
          <button type="button" class="admin-inline-copy" data-admin-copy="${escapeHTML(
            topup.senderNumber || ''
          )}" aria-label="Copy sender number"><i class="fa-regular fa-copy"></i></button>
        </span>
        <span><i class="fa-solid fa-hashtag"></i> Trx <b>${escapeHTML(
          topup.txnId || '—'
        )}</b>
          <button type="button" class="admin-inline-copy" data-admin-copy="${escapeHTML(
            topup.txnId || ''
          )}" aria-label="Copy transaction ID"><i class="fa-regular fa-copy"></i></button>
        </span>
        <span><i class="fa-regular fa-clock"></i> ${escapeHTML(
          relativeTime(topup.createdAt)
        )}</span>
      </div>

      <div class="admin-item__meta admin-item__meta--soft">
        <span><i class="fa-solid fa-fingerprint"></i> <code>${escapeHTML(
          topup.requestId || topup.id
        )}</code></span>
        <span>${escapeHTML(dateShort(topup.createdAt))}</span>
      </div>

      ${
        topup.note
          ? `<p class="admin-item__note"><i class="fa-solid fa-quote-left"></i> ${escapeHTML(
              topup.note
            )}</p>`
          : ''
      }

      ${
        !pending
          ? `<div class="admin-item__review">
              <i class="fa-solid fa-clock-rotate-left"></i>
              ${escapeHTML(
                topup.status === 'rejected' ? 'Rejected' : 'Credited'
              )} ${reviewed ? escapeHTML(relativeTime(topup.reviewedAt)) : ''}
              ${topup.reviewedBy ? ` by ${escapeHTML(ownerLabel(topup.reviewedBy))}` : ''}
              ${topup.adminNote ? `<span class="admin-item__review-note">“${escapeHTML(topup.adminNote)}”</span>` : ''}
            </div>`
          : ''
      }
    </div>

    <div class="admin-item__actions">${actions}</div>
  </article>`;
}

function renderTopups() {
  const host = document.getElementById('topupList');
  if (!host) return;

  if (state.loading.topups) {
    paint(host, skeleton(3));
    return;
  }

  if (state.permissionDenied && !state.topups.length) {
    paint(
      host,
      emptyState(
        'fa-solid fa-lock',
        'No top-ups loaded',
        'Publish the Firestore rules in SETUP.md, then press Retry on the banner.'
      )
    );
    return;
  }

  const rows = filteredTopups();

  if (!rows.length) {
    const copy = {
      pending: ['All clear', 'No top-up requests are waiting for you.'],
      approved: [
        'No approved top-ups',
        'Requests you credit will appear here with their audit trail.'
      ],
      rejected: ['No rejected top-ups', 'Rejected requests will be listed here.'],
      all: ['No top-up requests yet', 'Player top-up requests will appear here.']
    }[state.topupFilter] || ['Nothing here', 'Try a different filter.'];

    paint(host, emptyState('fa-solid fa-wallet', copy[0], copy[1]));
    return;
  }

  paint(host, rows.map((topup, index) => topupCard(topup, index)).join(''));
}

/* -------------------------------- orders -------------------------------- */

function filteredOrders() {
  if (state.orderFilter === 'all') return state.orders;
  if (state.orderFilter === 'wallet') {
    return state.orders.filter((order) => order.method === 'wallet');
  }
  return state.orders.filter((order) => order.status === state.orderFilter);
}

function orderCard(order, index) {
  const status = statusClass(order.status);
  const name = order.username || order.ign || order.email || 'Player';
  const catalog = itemById(order.itemId);
  const expected = catalog
    ? Number(catalog.price) || 0
    : Number(order.amount) || 0;
  const recorded = Number(order.amount) || 0;
  const wallet = state.wallets.get(order.uid);
  const walletReady = !state.loading.wallets;
  const balance = wallet ? Math.max(0, Number(wallet.balance) || 0) : 0;
  const walletPending = order.method === 'wallet' && order.status === 'pending';
  const insufficient =
    walletReady && walletPending && balance < expected;
  const discrepancy =
    catalog && Math.round(recorded) !== Math.round(Number(catalog.price) || 0);
  const displayAmount =
    walletPending ? expected : Number(order.walletCharged ?? order.amount) || 0;
  const paid = order.status === 'paid';
  const pending = order.status === 'pending';
  const refundable = order.method === 'wallet' && paid;

  const walletChip =
    order.method === 'wallet'
      ? `<span class="admin-wallet-chip${insufficient ? ' is-low' : ''}">
          <i class="fa-solid fa-wallet"></i>
          Wallet ${
            walletReady ? money(balance) : '…'
          }
        </span>`
      : '';

  let actions = '';
  if (pending && order.method === 'wallet') {
    actions = `<button type="button" class="btn btn-gold btn-sm${
      insufficient ? ' is-warning' : ''
    }" data-deduct-order="${escapeHTML(order.id)}">
        <span class="btn__label"><i class="fa-solid fa-wallet"></i> Deduct &amp; pay</span>
        <span class="btn__spinner" aria-hidden="true"></span>
      </button>
      <button type="button" class="btn btn-ghost btn-sm" data-cancel-order="${escapeHTML(
        order.id
      )}">
        <span class="btn__label"><i class="fa-solid fa-ban"></i> Cancel</span>
        <span class="btn__spinner" aria-hidden="true"></span>
      </button>`;
  } else if (pending) {
    actions = `<button type="button" class="btn btn-primary btn-sm" data-pay-order="${escapeHTML(
      order.id
    )}">
        <span class="btn__label"><i class="fa-solid fa-check"></i> Mark paid</span>
        <span class="btn__spinner" aria-hidden="true"></span>
      </button>
      <button type="button" class="btn btn-ghost btn-sm" data-cancel-order="${escapeHTML(
        order.id
      )}">
        <span class="btn__label"><i class="fa-solid fa-ban"></i> Cancel</span>
        <span class="btn__spinner" aria-hidden="true"></span>
      </button>`;
  } else if (paid) {
    actions = `<button type="button" class="btn btn-primary btn-sm" data-deliver-order="${escapeHTML(
      order.id
    )}">
        <span class="btn__label"><i class="fa-solid fa-box-open"></i> Mark delivered</span>
        <span class="btn__spinner" aria-hidden="true"></span>
      </button>
      <button type="button" class="btn btn-ghost btn-sm" data-cancel-order="${escapeHTML(
        order.id
      )}">
        <span class="btn__label"><i class="fa-solid fa-${
          refundable ? 'rotate-left' : 'ban'
        }"></i> ${refundable ? 'Refund &amp; cancel' : 'Cancel'}</span>
        <span class="btn__spinner" aria-hidden="true"></span>
      </button>`;
  }

  return `<article class="admin-item" style="--i:${index}">
    ${avatarMarkup(order.ign)}
    <div class="admin-item__body">
      <div class="admin-item__top">
        <div class="admin-item__identity">
          <strong>${escapeHTML(order.itemName || 'Order')}</strong>
          <span>${escapeHTML(name)}${
            order.email ? ` · ${escapeHTML(order.email)}` : ''
          }</span>
        </div>
        <span class="admin-item__amount">${money(displayAmount)}</span>
      </div>

      <div class="admin-item__tags">
        ${statusBadge(status)}
        ${methodBadge(order.method)}
        ${walletChip}
        <span class="admin-badge admin-badge--ghost">IGN: ${escapeHTML(order.ign || '—')}</span>
      </div>

      <div class="admin-item__meta">
        <span><i class="fa-solid fa-hashtag"></i> <code>${escapeHTML(
          order.orderId || order.id
        )}</code>
          <button type="button" class="admin-inline-copy" data-admin-copy="${escapeHTML(
            order.orderId || order.id
          )}" aria-label="Copy order ID"><i class="fa-regular fa-copy"></i></button>
        </span>
        <span><i class="fa-regular fa-calendar"></i> ${escapeHTML(
          dateShort(order.createdAt)
        )}</span>
        <span><i class="fa-regular fa-clock"></i> ${escapeHTML(
          relativeTime(order.createdAt)
        )}</span>
      </div>

      ${
        discrepancy
          ? `<p class="admin-warning"><i class="fa-solid fa-triangle-exclamation"></i>
              Catalog price is ${money(expected)} but this order recorded ${money(
              recorded
            )}. ${order.method === 'wallet' ? 'The catalog price will be deducted.' : 'Check the payment before approving.'}
            </p>`
          : ''
      }

      ${
        insufficient
          ? `<p class="admin-warning admin-warning--strong"><i class="fa-solid fa-circle-exclamation"></i>
              Not enough wallet balance. Add credit on the player's account or ask them to top up before deducting.
            </p>`
          : ''
      }

      ${
        order.status === 'paid' || order.status === 'delivered'
          ? `<div class="admin-item__review">
              <i class="fa-solid fa-check-double"></i>
              ${
                order.method === 'wallet'
                  ? `Wallet charged ${money(order.walletCharged ?? order.amount)}`
                  : `Payment received`
              }
              ${order.reviewedBy ? ` · approved by ${escapeHTML(ownerLabel(order.reviewedBy))}` : ''}
              ${timeMs(order.paidAt) ? ` · ${escapeHTML(relativeTime(order.paidAt))}` : ''}
              ${timeMs(order.deliveredAt) ? ` · delivered ${escapeHTML(relativeTime(order.deliveredAt))}` : ''}
            </div>`
          : ''
      }

      ${
        order.status === 'cancelled'
          ? `<div class="admin-item__review">
              <i class="fa-solid fa-ban"></i>
              Cancelled ${timeMs(order.cancelledAt) ? escapeHTML(relativeTime(order.cancelledAt)) : ''}
              ${order.cancelReason ? `<span class="admin-item__review-note">“${escapeHTML(order.cancelReason)}”</span>` : ''}
            </div>`
          : ''
      }
    </div>

    <div class="admin-item__actions">${actions}</div>
  </article>`;
}

function renderOrders() {
  const host = document.getElementById('orderList');
  if (!host) return;

  if (state.loading.orders) {
    paint(host, skeleton(3));
    return;
  }

  if (state.permissionDenied && !state.orders.length) {
    paint(
      host,
      emptyState(
        'fa-solid fa-lock',
        'No orders loaded',
        'Publish the Firestore rules in SETUP.md, then press Retry on the banner.'
      )
    );
    return;
  }

  const rows = filteredOrders();

  if (!rows.length) {
    const copy = {
      pending: ['All clear', 'No orders are waiting for approval.'],
      wallet: ['No wallet orders', 'Orders paid from store credit will appear here.'],
      paid: ['No paid orders', 'Paid orders waiting for delivery will appear here.'],
      delivered: ['No delivered orders', 'Completed orders will appear here.'],
      cancelled: ['No cancelled orders', 'Nothing has been cancelled.'],
      all: ['No orders yet', 'Store purchases will appear here.']
    }[state.orderFilter] || ['Nothing here', 'Try a different filter.'];

    paint(host, emptyState('fa-solid fa-receipt', copy[0], copy[1]));
    return;
  }

  paint(host, rows.map((order, index) => orderCard(order, index)).join(''));
}

/* -------------------------------- players ------------------------------- */

function playerFor(uid) {
  if (!uid) return null;
  const user = state.users.find((row) => (row.uid || row.id) === uid);
  const wallet = state.wallets.get(uid);
  if (!user && !wallet) return null;

  const name =
    user?.username ||
    user?.ign ||
    (user?.email ? String(user.email).split('@')[0] : '') ||
    `Player ${String(uid).slice(0, 6)}`;

  return {
    uid,
    name,
    username: user?.username || '',
    email: user?.email || '',
    ign: user?.ign || '',
    createdAt: timeMs(user?.createdAt),
    balance: Math.max(0, Number(wallet?.balance) || 0)
  };
}

function playerRows() {
  const orderCounts = new Map();
  state.orders.forEach((order) => {
    if (!order.uid) return;
    orderCounts.set(order.uid, (orderCounts.get(order.uid) || 0) + 1);
  });

  const seen = new Set();
  const rows = [];

  state.users.forEach((user) => {
    const uid = user.uid || user.id;
    if (!uid || seen.has(uid)) return;
    seen.add(uid);
    const player = playerFor(uid);
    if (player) rows.push({ ...player, orderCount: orderCounts.get(uid) || 0 });
  });

  state.wallets.forEach((wallet, uid) => {
    if (!uid || seen.has(uid)) return;
    seen.add(uid);
    const player = playerFor(uid);
    if (player) rows.push({ ...player, orderCount: orderCounts.get(uid) || 0 });
  });

  return rows.sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  );
}

function playerCard(player, index) {
  const uid = String(player.uid);
  const uidShort = uid.length > 12 ? `${uid.slice(0, 10)}…` : uid;
  return `<article class="admin-player" style="--i:${index}">
    <div class="admin-player__top">
      ${avatarMarkup(player.ign)}
      <div class="admin-player__identity">
        <strong>${escapeHTML(player.name)}</strong>
        <span>${escapeHTML(player.email || 'No email on profile')}</span>
      </div>
      <span class="admin-player__balance">${money(player.balance)}</span>
    </div>

    <div class="admin-player__meta">
      <span><i class="fa-solid fa-gamepad"></i> ${escapeHTML(
        player.ign || 'IGN not set'
      )}</span>
      <span><i class="fa-solid fa-receipt"></i> ${player.orderCount} order${
        player.orderCount === 1 ? '' : 's'
      }</span>
      <span><i class="fa-solid fa-calendar-plus"></i> ${
        player.createdAt ? escapeHTML(dateShort(player.createdAt)) : '—'
      }</span>
    </div>

    <div class="admin-player__foot">
      <code title="${escapeHTML(uid)}">${escapeHTML(uidShort)}</code>
      <button type="button" class="btn btn-ghost btn-sm" data-manage-player="${escapeHTML(
        uid
      )}">
        Manage <i class="fa-solid fa-arrow-right"></i>
      </button>
    </div>
  </article>`;
}

function renderPlayers() {
  const host = document.getElementById('playerList');
  const count = document.getElementById('playerCount');
  if (!host) return;

  if (state.loading.users || state.loading.wallets) {
    paint(host, skeleton(4, 'admin-skeleton--player'));
    if (count) count.textContent = 'Loading…';
    return;
  }

  if (state.permissionDenied && !state.users.length) {
    paint(
      host,
      emptyState(
        'fa-solid fa-lock',
        'No players loaded',
        'Publish the Firestore rules in SETUP.md, then press Retry on the banner.'
      )
    );
    if (count) count.textContent = '0 players';
    return;
  }

  const all = playerRows();
  const query = state.playerQuery.trim().toLowerCase();
  const rows = query
    ? all.filter((player) =>
        `${player.name} ${player.username} ${player.email} ${player.ign} ${player.uid}`
          .toLowerCase()
          .includes(query)
      )
    : all;

  if (count) {
    count.textContent = query
      ? `${rows.length} of ${all.length} players`
      : `${all.length} player${all.length === 1 ? '' : 's'}`;
  }

  if (!all.length) {
    paint(
      host,
      emptyState(
        'fa-solid fa-users',
        'No player accounts yet',
        'Accounts appear here as soon as players register on the site.'
      )
    );
    return;
  }

  if (!rows.length) {
    paint(
      host,
      emptyState(
        'fa-solid fa-magnifying-glass',
        'No players found',
        `Nothing matches “${state.playerQuery.trim()}”.`
      )
    );
    return;
  }

  paint(host, rows.map((player, index) => playerCard(player, index)).join(''));
}

/* ----------------------------- player modal ----------------------------- */

function miniOrder(order) {
  return `<div class="admin-mini-row">
    <div class="admin-mini-row__main">
      <strong>${escapeHTML(order.itemName || 'Order')}</strong>
      <span>${escapeHTML(order.orderId || order.id)} · ${escapeHTML(
        dateShort(order.createdAt)
      )}</span>
    </div>
    ${statusBadge(order.status)}
    <b>${money(order.walletCharged ?? order.amount)}</b>
  </div>`;
}

function miniTopup(topup) {
  return `<div class="admin-mini-row">
    <div class="admin-mini-row__main">
      <strong>${money(topup.amount)} · ${escapeHTML(
        METHOD_META[topup.method]?.label || topup.method || 'Payment'
      )}</strong>
      <span>${escapeHTML(dateShort(topup.createdAt))} · ${escapeHTML(
        topup.txnId || '—'
      )}</span>
    </div>
    ${statusBadge(topup.status)}
  </div>`;
}

function updateAdjustPreview() {
  const form = document.getElementById('balanceForm');
  const preview = document.getElementById('adjustPreview');
  if (!form || !preview) return;

  const player = playerFor(form.dataset.uid);
  if (!player) return;

  const amount = Math.max(
    0,
    Math.floor(Number(form.elements.amount?.value) || 0)
  );
  const delta = state.adjustMode === 'remove' ? -amount : amount;
  const next = player.balance + delta;

  $$('[data-adjust-mode]', form).forEach((button) => {
    button.classList.toggle(
      'is-active',
      button.dataset.adjustMode === state.adjustMode
    );
  });

  if (!amount) {
    preview.textContent = `Current balance: ${money(player.balance)}`;
    preview.classList.remove('is-negative');
    return;
  }

  if (next < 0) {
    preview.textContent = `Not enough balance — current is ${money(
      player.balance
    )}.`;
    preview.classList.add('is-negative');
    return;
  }

  preview.textContent = `New balance: ${money(next)}  ·  current ${money(
    player.balance
  )}`;
  preview.classList.remove('is-negative');
}

function renderPlayerModal(uid) {
  if (!playerModalBody) return;
  const player = playerFor(uid);

  if (!player) {
    playerModalBody.innerHTML = emptyState(
      'fa-solid fa-user-slash',
      'Player not found',
      'This account may have been removed. Refresh the console and try again.'
    );
    return;
  }

  const orders = state.orders
    .filter((order) => order.uid === uid)
    .sort((a, b) => timeMs(b.createdAt) - timeMs(a.createdAt));
  const topups = state.topups
    .filter((topup) => topup.uid === uid)
    .sort((a, b) => timeMs(b.createdAt) - timeMs(a.createdAt));
  const mode = state.adjustMode === 'remove' ? 'remove' : 'add';

  playerModalBody.innerHTML = `
    <div class="admin-player-modal__head">
      ${avatarMarkup(player.ign, 'admin-player-modal__avatar')}
      <div>
        <span class="admin-panel__eyebrow">Player account</span>
        <h2 id="playerModalName">${escapeHTML(player.name)}</h2>
        <p>${escapeHTML(player.email || 'No email on profile')}</p>
      </div>
    </div>

    <div class="admin-player-modal__stats">
      <div class="admin-player-modal__stat admin-player-modal__stat--balance">
        <span>Store credit</span>
        <strong>${money(player.balance)}</strong>
      </div>
      <div class="admin-player-modal__stat">
        <span>Orders</span>
        <strong>${orders.length}</strong>
      </div>
      <div class="admin-player-modal__stat">
        <span>Top-ups</span>
        <strong>${topups.length}</strong>
      </div>
    </div>

    <div class="admin-player-modal__facts">
      <div><span>Username</span><strong>${escapeHTML(
        player.username || '—'
      )}</strong></div>
      <div><span>Minecraft IGN</span><strong>${escapeHTML(
        player.ign || '—'
      )}</strong></div>
      <div><span>Member since</span><strong>${
        player.createdAt ? escapeHTML(dateShort(player.createdAt)) : '—'
      }</strong></div>
      <div><span>Player UID</span><button type="button" class="admin-copy-id" data-admin-copy="${escapeHTML(
        player.uid
      )}" title="${escapeHTML(player.uid)}">${escapeHTML(
    `${String(player.uid).slice(0, 12)}…`
  )} <i class="fa-regular fa-copy"></i></button></div>
    </div>

    <form class="admin-balance-form" id="balanceForm" data-uid="${escapeHTML(
      player.uid
    )}" novalidate>
      <div class="admin-balance-form__head">
        <div>
          <span class="admin-panel__eyebrow">Manual action</span>
          <h3>Adjust store credit</h3>
        </div>
        <span class="admin-balance-form__hint">Moves instantly</span>
      </div>

      <div class="admin-adjust-toggle" role="group" aria-label="Adjustment type">
        <button type="button" data-adjust-mode="add" class="${
          mode === 'add' ? 'is-active' : ''
        }"><i class="fa-solid fa-plus"></i> Add credit</button>
        <button type="button" data-adjust-mode="remove" class="${
          mode === 'remove' ? 'is-active' : ''
        }"><i class="fa-solid fa-minus"></i> Remove credit</button>
      </div>

      <label class="field">
        <span class="field__label">Amount (BDT)</span>
        <input type="number" name="amount" min="1" step="1" inputmode="numeric" placeholder="500">
      </label>

      <div class="admin-presets">
        <span>Quick</span>
        <button type="button" data-adjust-preset="100">100</button>
        <button type="button" data-adjust-preset="500">500</button>
        <button type="button" data-adjust-preset="1000">1,000</button>
        <button type="button" data-adjust-preset="2500">2,500</button>
      </div>

      <label class="field">
        <span class="field__label">Reason</span>
        <input type="text" name="reason" maxlength="160" autocomplete="off" placeholder="e.g. bKash top-up, manual correction">
      </label>

      <p class="admin-adjust-preview" id="adjustPreview">Current balance: ${money(
        player.balance
      )}</p>

      <button type="submit" class="btn btn-primary btn-block">
        <span class="btn__label"><i class="fa-solid fa-sliders"></i> Apply adjustment</span>
        <span class="btn__spinner" aria-hidden="true"></span>
      </button>
    </form>

    <div class="admin-player-modal__lists">
      <section class="admin-mini-panel">
        <header><h3><i class="fa-solid fa-receipt"></i> Recent orders</h3><span>${orders.length}</span></header>
        ${
          orders.length
            ? orders.slice(0, 5).map(miniOrder).join('')
            : '<p class="admin-mini-empty">No orders yet.</p>'
        }
      </section>

      <section class="admin-mini-panel">
        <header><h3><i class="fa-solid fa-arrow-down-long"></i> Recent top-ups</h3><span>${topups.length}</span></header>
        ${
          topups.length
            ? topups.slice(0, 5).map(miniTopup).join('')
            : '<p class="admin-mini-empty">No top-up requests yet.</p>'
        }
      </section>
    </div>`;

  requestAnimationFrame(updateAdjustPreview);
}

function showPlayerModal(uid, { resetMode = true } = {}) {
  state.selectedPlayerUid = uid;
  if (resetMode) state.adjustMode = 'add';
  renderPlayerModal(uid);
  openModal('playerModal');
}

/* ------------------------------ confirm UI ------------------------------ */

let confirmResolver = null;

const confirmObserver = new MutationObserver(() => {
  if (!adminConfirm.classList.contains('is-open') && confirmResolver) {
    const resolve = confirmResolver;
    confirmResolver = null;
    resolve({ ok: false, value: '' });
  }
});
confirmObserver.observe(adminConfirm, {
  attributes: true,
  attributeFilter: ['class']
});

function finishConfirm(result) {
  const resolve = confirmResolver;
  confirmResolver = null;
  closeModal('adminConfirm');
  if (resolve) resolve(result);
}

function askConfirm({
  title = 'Confirm action',
  message = '',
  summary = [],
  inputLabel = '',
  inputPlaceholder = '',
  inputRequired = false,
  confirmText = 'Confirm',
  danger = false,
  icon = 'fa-solid fa-triangle-exclamation'
} = {}) {
  return new Promise((resolve) => {
    if (confirmResolver) {
      const previous = confirmResolver;
      confirmResolver = null;
      closeModal('adminConfirm');
      previous({ ok: false, value: '' });
    }

    confirmResolver = resolve;
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmIcon.className = `admin-confirm__icon${
      danger ? ' admin-confirm__icon--danger' : ''
    }`;
    confirmIcon.innerHTML = `<i class="${icon}"></i>`;

    confirmSummary.hidden = !summary.length;
    confirmSummary.innerHTML = summary
      .map(
        (row) =>
          `<div><span>${escapeHTML(row.label)}</span><strong>${escapeHTML(
            row.value
          )}</strong></div>`
      )
      .join('');

    confirmInputWrap.hidden = !inputLabel;
    confirmInputLabel.textContent = inputLabel || 'Reason';
    confirmInput.placeholder = inputPlaceholder || '';
    confirmInput.value = '';
    confirmInput.dataset.required = inputRequired ? 'true' : 'false';
    confirmError.hidden = true;
    confirmError.textContent = '';

    confirmOk.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    confirmOk.textContent = confirmText;

    openModal('adminConfirm');

    setTimeout(() => {
      if (inputLabel) confirmInput.focus({ preventScroll: true });
      else confirmOk.focus({ preventScroll: true });
    }, 90);
  });
}

/* ------------------------------- actions -------------------------------- */

const adminEmail = () => state.user?.email || ADMIN.email;

function findTopup(id) {
  return state.topups.find((topup) => topup.id === id);
}

function findOrder(id) {
  return state.orders.find((order) => order.id === id);
}

async function runAction(button, task, { successTitle, successMessage, errorTitle = 'Action failed' }) {
  setButtonBusy(button, true);
  try {
    const result = await task();
    if (successTitle) {
      toast({
        title: successTitle,
        message: successMessage || '',
        type: 'success'
      });
    }
    return result;
  } catch (error) {
    console.error('[TKBD admin] Action failed:', error);
    toast({
      title: errorTitle,
      message: adminErrorMessage(error),
      type: 'error',
      duration: 7200
    });
    return null;
  } finally {
    setButtonBusy(button, false);
  }
}

async function handleApproveTopup(button, id) {
  const topup = findTopup(id);
  if (!topup) {
    toast({ title: 'Request moved', message: 'Refresh the queue.', type: 'warning' });
    return;
  }

  const name = topup.username || topup.ign || topup.email || 'Player';
  const result = await askConfirm({
    title: 'Credit this top-up?',
    message: `${name} will receive store credit. Only approve after you have confirmed the money arrived.`,
    summary: [
      { label: 'Player', value: `${name}${topup.ign ? ` (${topup.ign})` : ''}` },
      { label: 'Amount', value: money(topup.amount) },
      { label: 'Method', value: METHOD_META[topup.method]?.label || topup.method || '—' },
      { label: 'Sender', value: topup.senderNumber || '—' },
      { label: 'Transaction', value: topup.txnId || '—' },
      { label: 'Request', value: topup.requestId || topup.id }
    ],
    confirmText: `Credit ${money(topup.amount)}`,
    icon: 'fa-solid fa-wallet'
  });

  if (!result.ok) return;

  await runAction(
    button,
    () => approveTopup(topup, adminEmail()),
    {
      successTitle: 'Balance credited',
      successMessage: `${money(topup.amount)} was added to ${name}'s wallet.`
    }
  );
}

async function handleRejectTopup(button, id) {
  const topup = findTopup(id);
  if (!topup) {
    toast({ title: 'Request moved', message: 'Refresh the queue.', type: 'warning' });
    return;
  }

  const name = topup.username || topup.ign || topup.email || 'Player';
  const result = await askConfirm({
    title: 'Reject this top-up?',
    message: 'No balance will be credited. Give the player a clear reason so they can fix the request.',
    summary: [
      { label: 'Player', value: name },
      { label: 'Amount', value: money(topup.amount) },
      { label: 'Transaction', value: topup.txnId || '—' }
    ],
    inputLabel: 'Reason for rejection',
    inputPlaceholder: 'e.g. Transaction ID not found in our statement',
    inputRequired: true,
    confirmText: 'Reject request',
    danger: true,
    icon: 'fa-solid fa-xmark'
  });

  if (!result.ok) return;

  await runAction(
    button,
    () => rejectTopup(topup, result.value, adminEmail()),
    {
      successTitle: 'Top-up rejected',
      successMessage: `${name}'s request was not credited.`
    }
  );
}

async function handlePayOrder(button, id) {
  const order = findOrder(id);
  if (!order) {
    toast({ title: 'Order moved', message: 'Refresh the queue.', type: 'warning' });
    return;
  }

  const name = order.username || order.ign || 'Player';
  const result = await askConfirm({
    title: 'Mark this order paid?',
    message:
      'Only approve after you have verified the bKash or Nagad payment. This unlocks delivery.',
    summary: [
      { label: 'Order', value: order.orderId || order.id },
      { label: 'Item', value: order.itemName || '—' },
      { label: 'Player', value: `${name} (${order.ign || 'no IGN'})` },
      { label: 'Amount', value: money(order.amount) },
      { label: 'Method', value: METHOD_META[order.method]?.label || order.method || '—' }
    ],
    confirmText: 'Mark paid',
    icon: 'fa-solid fa-check'
  });

  if (!result.ok) return;

  await runAction(button, () => markOrderPaid(order, adminEmail()), {
    successTitle: 'Order marked paid',
    successMessage: `${order.itemName || 'The order'} is ready to deliver.`
  });
}

async function handleDeductOrder(button, id) {
  const order = findOrder(id);
  if (!order) {
    toast({ title: 'Order moved', message: 'Refresh the queue.', type: 'warning' });
    return;
  }

  if (state.loading.wallets) {
    toast({
      title: 'Wallets are loading',
      message: 'Try again in a second so we can check the balance.',
      type: 'info'
    });
    return;
  }

  const catalog = itemById(order.itemId);
  const charge = catalog
    ? Number(catalog.price) || 0
    : Number(order.amount) || 0;
  const wallet = state.wallets.get(order.uid);
  const balance = wallet ? Math.max(0, Number(wallet.balance) || 0) : 0;
  const name = order.username || order.ign || 'Player';

  if (charge <= 0) {
    toast({
      title: 'Invalid price',
      message: 'This item has no catalog price. Check js/config.js.',
      type: 'error'
    });
    return;
  }

  if (balance < charge) {
    toast({
      title: 'Not enough wallet balance',
      message: `${name} has ${money(balance)} but this order needs ${money(
        charge
      )}. Add credit on the Players tab first.`,
      type: 'warning',
      duration: 7200
    });
    return;
  }

  const result = await askConfirm({
    title: 'Deduct wallet & approve?',
    message: `The catalog price will be deducted from ${name}'s store credit. This cannot be reversed from the order card — use Refund & cancel if needed.`,
    summary: [
      { label: 'Order', value: order.orderId || order.id },
      { label: 'Item', value: order.itemName || '—' },
      { label: 'Player', value: `${name} (${order.ign || 'no IGN'})` },
      { label: 'Wallet balance', value: money(balance) },
      { label: 'Deduction', value: money(charge) },
      { label: 'Remaining', value: money(balance - charge) }
    ],
    confirmText: `Deduct ${money(charge)}`,
    icon: 'fa-solid fa-wallet'
  });

  if (!result.ok) return;

  await runAction(button, () => deductAndPayOrder(order, charge, adminEmail()), {
    successTitle: 'Wallet deducted',
    successMessage: `${money(charge)} charged to ${name}. ${money(
      balance - charge
    )} remains.`
  });
}

async function handleDeliverOrder(button, id) {
  const order = findOrder(id);
  if (!order) {
    toast({ title: 'Order moved', message: 'Refresh the queue.', type: 'warning' });
    return;
  }

  const name = order.username || order.ign || 'Player';
  const result = await askConfirm({
    title: 'Mark as delivered?',
    message: `Confirm that ${order.itemName || 'the item'} has been delivered to ${
      order.ign || name
    } in-game. This closes the order.`,
    summary: [
      { label: 'Order', value: order.orderId || order.id },
      { label: 'Item', value: order.itemName || '—' },
      { label: 'Player', value: `${name} (${order.ign || 'no IGN'})` },
      { label: 'Amount', value: money(order.amount) }
    ],
    confirmText: 'Delivered',
    icon: 'fa-solid fa-box-open'
  });

  if (!result.ok) return;

  await runAction(button, () => markDelivered(order, adminEmail()), {
    successTitle: 'Order delivered',
    successMessage: `${order.itemName || 'The order'} is complete.`
  });
}

async function handleCancelOrder(button, id) {
  const order = findOrder(id);
  if (!order) {
    toast({ title: 'Order moved', message: 'Refresh the queue.', type: 'warning' });
    return;
  }

  const name = order.username || order.ign || 'Player';
  const refund = order.method === 'wallet' && order.status === 'paid';
  const pending = order.status === 'pending';

  const message = refund
    ? `The wallet will be refunded ${money(
        order.walletCharged ?? order.amount
      )} and the order will be cancelled.`
    : pending
    ? 'No money has been deducted for this pending order. It will be cancelled.'
    : order.method === 'wallet'
    ? 'This order will be cancelled. No automatic refund is available for this status.'
    : 'This is a manual payment. Cancel the order, then settle any refund with the player yourself.';

  const result = await askConfirm({
    title: refund ? 'Refund & cancel?' : 'Cancel this order?',
    message,
    summary: [
      { label: 'Order', value: order.orderId || order.id },
      { label: 'Item', value: order.itemName || '—' },
      { label: 'Player', value: name },
      { label: 'Amount', value: money(order.amount) },
      ...(refund
        ? [{ label: 'Refund to wallet', value: money(order.walletCharged ?? order.amount) }]
        : [])
    ],
    inputLabel: 'Reason',
    inputPlaceholder: 'e.g. Player requested cancellation',
    inputRequired: true,
    confirmText: refund ? 'Refund & cancel' : 'Cancel order',
    danger: true,
    icon: refund ? 'fa-solid fa-rotate-left' : 'fa-solid fa-ban'
  });

  if (!result.ok) return;

  await runAction(
    button,
    () =>
      cancelOrder(order, adminEmail(), {
        reason: result.value,
        refund
      }),
    {
      successTitle: refund ? 'Order refunded' : 'Order cancelled',
      successMessage: refund
        ? `${money(order.walletCharged ?? order.amount)} returned to ${name}'s wallet.`
        : `${order.itemName || 'The order'} was cancelled.`
    }
  );
}

async function submitBalance(form) {
  const uid = form.dataset.uid;
  const player = playerFor(uid);
  if (!player) return;

  const amount = Number(form.elements.amount?.value);
  const reason = String(form.elements.reason?.value || '').trim();
  const remove = state.adjustMode === 'remove';

  if (!Number.isInteger(amount) || amount <= 0) {
    toast({
      title: 'Enter an amount',
      message: 'Use a whole number of Taka, for example 500.',
      type: 'warning'
    });
    form.elements.amount?.focus();
    return;
  }

  if (!reason) {
    toast({
      title: 'Reason required',
      message: 'Every manual balance change is logged. Add a short reason.',
      type: 'warning'
    });
    form.elements.reason?.focus();
    return;
  }

  const delta = remove ? -amount : amount;
  const next = player.balance + delta;

  if (next < 0) {
    toast({
      title: 'Not enough balance',
      message: `${player.name} only has ${money(player.balance)}.`,
      type: 'error'
    });
    return;
  }

  const result = await askConfirm({
    title: remove ? 'Remove store credit?' : 'Add store credit?',
    message: `${player.name}'s wallet will change from ${money(
      player.balance
    )} to ${money(next)}. This is written to the audit log.`,
    summary: [
      { label: 'Player', value: `${player.name}${player.ign ? ` (${player.ign})` : ''}` },
      { label: 'Change', value: `${remove ? '-' : '+'}${money(amount)}` },
      { label: 'New balance', value: money(next) },
      { label: 'Reason', value: reason }
    ],
    confirmText: `${remove ? 'Remove' : 'Add'} ${money(amount)}`,
    danger: remove,
    icon: 'fa-solid fa-sliders'
  });

  if (!result.ok) {
    showPlayerModal(uid, { resetMode: false });
    return;
  }

  const submit = form.querySelector('[type="submit"]');
  setButtonBusy(submit, true);

  try {
    const response = await adjustBalance(
      { uid, delta, reason, name: player.name },
      adminEmail()
    );

    const wallet = state.wallets.get(uid) || { uid, balance: player.balance };
    state.wallets.set(uid, { ...wallet, balance: response.balance });
    renderOverview();
    renderPlayers();

    toast({
      title: 'Wallet updated',
      message: `${player.name} now has ${money(response.balance)} in store credit.`,
      type: 'success'
    });
    showPlayerModal(uid, { resetMode: true });
  } catch (error) {
    console.error('[TKBD admin] Balance adjustment failed:', error);
    toast({
      title: 'Adjustment failed',
      message: adminErrorMessage(error),
      type: 'error',
      duration: 7200
    });
    showPlayerModal(uid, { resetMode: false });
  } finally {
    setButtonBusy(submit, false);
  }
}

/* ------------------------------ navigation ------------------------------ */

const VIEW_TITLES = {
  overview: 'Overview',
  topups: 'Top-ups',
  orders: 'Orders',
  players: 'Players'
};

function setView(view, filter = '') {
  if (!VIEW_TITLES[view]) return;
  const changed = state.view !== view;
  state.view = view;

  if (filter) {
    if (
      view === 'topups' &&
      ['pending', 'approved', 'rejected', 'all'].includes(filter)
    ) {
      state.topupFilter = filter;
    }
    if (
      view === 'orders' &&
      ['pending', 'wallet', 'paid', 'delivered', 'cancelled', 'all'].includes(
        filter
      )
    ) {
      state.orderFilter = filter;
    }
  }

  $$('[data-admin-view]').forEach((button) => {
    const active = button.dataset.adminView === view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });

  $$('[data-admin-panel]').forEach((panel) => {
    const active = panel.dataset.adminPanel === view;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  });

  const title = document.getElementById('adminViewTitle');
  if (title) title.textContent = VIEW_TITLES[view];

  syncFilterButtons();
  if (view === 'topups') renderTopups();
  if (view === 'orders') renderOrders();

  if (changed) {
    window.scrollTo({
      top: 0,
      behavior: reducedMotion() ? 'auto' : 'smooth'
    });
  }
}

/* ------------------------------- bindings ------------------------------- */

function bindConfirm() {
  confirmOk.addEventListener('click', () => {
    const required = confirmInput.dataset.required === 'true';
    const value = confirmInput.value.trim();

    if (required && !value) {
      confirmError.textContent = 'Enter a reason before continuing.';
      confirmError.hidden = false;
      confirmInput.focus({ preventScroll: true });
      return;
    }

    finishConfirm({ ok: true, value });
  });

  confirmCancel.addEventListener('click', () => {
    closeModal('adminConfirm');
  });

  confirmInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    confirmOk.click();
  });
}

function bindLogin() {
  if (!adminLoginForm) return;

  adminLoginForm.addEventListener('input', clearLoginError);

  adminLoginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (adminLoginBtn?.disabled) return;

    const email = adminLoginForm.elements.email.value.trim();
    const password = adminLoginForm.elements.password.value;

    clearLoginError();

    if (!email || !password) {
      showLoginError('Enter both your owner email and password.');
      return;
    }

    setButtonBusy(adminLoginBtn, true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error('[TKBD admin] Sign-in failed:', error?.code || error);
      showLoginError(authErrorMessage(error));
      adminLoginForm.elements.password.focus();
    } finally {
      setButtonBusy(adminLoginBtn, false);
    }
  });
}

function bindVerify() {
  const resend = document.getElementById('resendVerifyAdmin');
  const check = document.getElementById('checkVerifyAdmin');

  resend?.addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user) return;
    setButtonBusy(resend, true);
    try {
      await sendEmailVerification(user);
      toast({
        title: 'Verification sent',
        message: `Check ${user.email} and the spam folder.`,
        type: 'success'
      });
    } catch (error) {
      toast({
        title: 'Could not send email',
        message: authErrorMessage(error),
        type: 'error'
      });
    } finally {
      setButtonBusy(resend, false);
    }
  });

  check?.addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user) return;
    setButtonBusy(check, true);

    try {
      await reload(user);
      if (!user.emailVerified) {
        toast({
          title: 'Not verified yet',
          message: 'Open the link in your inbox, then try again.',
          type: 'warning'
        });
        return;
      }

      await user.getIdToken(true);
      state.started = false;
      await handleAuthState(user);
      toast({
        title: 'Verified',
        message: 'Welcome back, owner.',
        type: 'success'
      });
    } catch (error) {
      toast({
        title: 'Could not verify',
        message: authErrorMessage(error),
        type: 'error'
      });
    } finally {
      setButtonBusy(check, false);
    }
  });
}

function bindControls() {
  document.addEventListener('click', async (event) => {
    const viewButton = event.target.closest('[data-admin-view]');
    if (viewButton) {
      event.preventDefault();
      setView(viewButton.dataset.adminView);
      return;
    }

    const jump = event.target.closest('[data-jump]');
    if (jump) {
      event.preventDefault();
      setView(jump.dataset.jump, jump.dataset.jumpFilter || '');
      return;
    }

    const topupFilter = event.target.closest('[data-topup-filter]');
    if (topupFilter) {
      state.topupFilter = topupFilter.dataset.topupFilter;
      syncFilterButtons();
      renderTopups();
      return;
    }

    const orderFilter = event.target.closest('[data-order-filter]');
    if (orderFilter) {
      state.orderFilter = orderFilter.dataset.orderFilter;
      syncFilterButtons();
      renderOrders();
      return;
    }

    const approve = event.target.closest('[data-approve-topup]');
    if (approve) {
      event.preventDefault();
      handleApproveTopup(approve, approve.dataset.approveTopup);
      return;
    }

    const reject = event.target.closest('[data-reject-topup]');
    if (reject) {
      event.preventDefault();
      handleRejectTopup(reject, reject.dataset.rejectTopup);
      return;
    }

    const pay = event.target.closest('[data-pay-order]');
    if (pay) {
      event.preventDefault();
      handlePayOrder(pay, pay.dataset.payOrder);
      return;
    }

    const deduct = event.target.closest('[data-deduct-order]');
    if (deduct) {
      event.preventDefault();
      handleDeductOrder(deduct, deduct.dataset.deductOrder);
      return;
    }

    const deliver = event.target.closest('[data-deliver-order]');
    if (deliver) {
      event.preventDefault();
      handleDeliverOrder(deliver, deliver.dataset.deliverOrder);
      return;
    }

    const cancel = event.target.closest('[data-cancel-order]');
    if (cancel) {
      event.preventDefault();
      handleCancelOrder(cancel, cancel.dataset.cancelOrder);
      return;
    }

    const manage = event.target.closest('[data-manage-player]');
    if (manage) {
      event.preventDefault();
      showPlayerModal(manage.dataset.managePlayer);
      return;
    }

    const copy = event.target.closest('[data-admin-copy]');
    if (copy) {
      event.preventDefault();
      const value = copy.dataset.adminCopy;
      if (!value) return;
      const ok = await copyText(value);
      toast(
        ok
          ? { title: 'Copied', message: 'Copied to your clipboard.', type: 'success' }
          : { title: 'Copy failed', message: 'Copy the value manually.', type: 'error' }
      );
      return;
    }

    const mode = event.target.closest('[data-adjust-mode]');
    if (mode) {
      state.adjustMode = mode.dataset.adjustMode === 'remove' ? 'remove' : 'add';
      updateAdjustPreview();
      return;
    }

    const preset = event.target.closest('[data-adjust-preset]');
    if (preset) {
      const input = document.querySelector('#balanceForm [name="amount"]');
      if (input) {
        input.value = preset.dataset.adjustPreset;
        updateAdjustPreview();
        input.focus({ preventScroll: true });
      }
      return;
    }

    const refresh = event.target.closest('[data-refresh]');
    if (refresh) {
      event.preventDefault();
      startListeners();
      toast({
        title: 'Refreshing',
        message: 'Reconnecting to the live queues…',
        type: 'info'
      });
      return;
    }

    if (event.target.closest('#retryFirestore')) {
      event.preventDefault();
      startListeners();
      toast({
        title: 'Retrying Firestore',
        message: 'If you just published the rules, the queues should fill in.',
        type: 'info'
      });
      return;
    }

    if (
      event.target.closest('#adminSignOut') ||
      event.target.closest('#adminSignOutTop') ||
      event.target.closest('#verifySignOut') ||
      event.target.closest('#deniedSignOut')
    ) {
      event.preventDefault();
      doSignOut();
    }
  });

  document.addEventListener('submit', (event) => {
    if (event.target.id !== 'balanceForm') return;
    event.preventDefault();
    submitBalance(event.target);
  });

  document.addEventListener('input', (event) => {
    if (event.target.closest('#balanceForm')) updateAdjustPreview();
  });

  document.getElementById('playerSearch')?.addEventListener(
    'input',
    debounce(() => {
      state.playerQuery = document.getElementById('playerSearch').value;
      renderPlayers();
    }, 120)
  );
}

function bindAvatarFallback() {
  document.addEventListener(
    'error',
    (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;
      if (image.dataset.avatar !== '1') return;
      image.dataset.avatar = '';
      image.src = FALLBACK_AVATAR;
    },
    true
  );
}

/* --------------------------------- boot --------------------------------- */

function init() {
  initModals();
  initPasswordToggles();
  bindConfirm();
  bindLogin();
  bindVerify();
  bindControls();
  bindAvatarFallback();

  onAuthStateChanged(auth, (user) => {
    handleAuthState(user).catch((error) => {
      console.error('[TKBD admin] Boot failed:', error);
      toast({
        title: 'Console failed to start',
        message: error?.message || 'Reload the page and try again.',
        type: 'error',
        duration: 8000
      });
    });
  });

  setTimeout(() => {
    if (state.authResolved) return;
    const text = adminBoot?.querySelector('p');
    if (text) text.textContent = 'Still connecting — check your network and reload.';
  }, 9000);
}

init();


