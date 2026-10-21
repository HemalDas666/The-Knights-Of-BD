/* =========================================================================
   ACCOUNT PAGE
   ========================================================================= */

import {
  initAuth,
  onAuth,
  avatarUrlFor,
  updateUsername,
  updateIgn,
  resendVerification,
  refreshVerification,
  sendPasswordResetToCurrent
} from '../js/auth.js';
import { getOrders, isCloudAvailable } from '../js/data.js';
import {
  toast,
  initNav,
  initScrollProgress,
  initCopyButtons,
  bindServerAddresses,
  escapeHTML,
  closeModal,
  copyText,
  openModal
} from '../js/ui.js';
import { WALLET, PAYMENTS, formatBDT } from '../js/config.js';
import {
  createTopup,
  validateTopup,
  walletErrorMessage,
  watchTopups,
  watchWallet
} from '../js/wallet.js';

initAuth();
bindServerAddresses();
initNav();
initScrollProgress();
initCopyButtons();

const loadingView = document.getElementById('accountLoading');
const guestView = document.getElementById('guestView');
const userView = document.getElementById('userView');
const profileForm = document.getElementById('profileForm');
const topupForm = document.getElementById('topupForm');
const topupError = document.getElementById('topupError');
const topupNumber = document.getElementById('topupNumber');
const topupPresets = document.getElementById('topupPresets');
const topupSubmit = document.getElementById('topupSubmit');
const topupCopyBtn = document.getElementById('topupCopyBtn');

let loadedUid = null;
let lastUser = null;
let lastProfile = {};

let walletUnsubscribe = () => {};
let topupsUnsubscribe = () => {};
let topupBusy = false;
let topupMethod = 'bkash';
let walletErrorShown = false;
let topupAutoOpened = false;
const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function renderProfile(user, profile) {
  lastUser = user;
  lastProfile = profile;

  const name =
    profile.username ||
    user.displayName ||
    (user.email ? user.email.split('@')[0] : 'Knight');

  document.getElementById('acName').textContent = name;
  document.getElementById('acEmail').textContent = user.email || '';
  document.getElementById('acIgn').textContent = profile.ign || 'Not set';
  document.getElementById('acRank').textContent = user.emailVerified ? 'Verified Knight' : 'Member';

  const avatar = document.getElementById('acAvatar');
  avatar.onerror = () => {
    avatar.onerror = null;
    avatar.src = avatarUrlFor('');
  };
  avatar.src = avatarUrlFor(profile.ign);

  const since = Number(profile.createdAt) || 0;
  document.getElementById('acSince').textContent = since
    ? new Date(since).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  const verifiedBadge = document.getElementById('acVerifiedBadge');
  verifiedBadge.textContent = user.emailVerified ? 'Email verified' : 'Unverified';
  verifiedBadge.className = `badge ${user.emailVerified ? 'badge--green' : 'badge--muted'}`;

  if (profileForm && !profileForm.contains(document.activeElement)) {
    profileForm.elements.username.value = name;
    profileForm.elements.ign.value = profile.ign || '';
  }
}

function renderVerification(user) {
  const banner = document.getElementById('verifyBanner');
  if (!banner) return;

  banner.hidden = false;

  const icon = banner.firstElementChild;
  const title = document.getElementById('verifyTitle');
  const text = document.getElementById('verifyText');
  const actions = banner.querySelector('.verify-actions');

  if (user.emailVerified) {
    banner.classList.add('is-verified');
    icon.className = 'fa-solid fa-circle-check';
    title.textContent = 'Email verified';
    text.textContent = 'Your account is fully verified. Staff can reach you about any order.';
    actions.hidden = true;
  } else {
    banner.classList.remove('is-verified');
    icon.className = 'fa-solid fa-envelope-circle-check';
    title.textContent = 'Verify your email';
    text.textContent = `We sent a verification link to ${user.email}. Check your inbox (and spam folder).`;
    actions.hidden = false;
  }
}

const ORDER_STATUS_LABELS = {
  pending: 'Pending',
  paid: 'Paid',
  delivered: 'Delivered',
  cancelled: 'Cancelled'
};

const METHOD_LABELS = {
  bkash: 'bKash',
  nagad: 'Nagad',
  wallet: 'Wallet'
};

function statusClass(status) {
  return ORDER_STATUS_LABELS[status] ? status : 'pending';
}

function statusLabel(status) {
  return ORDER_STATUS_LABELS[status] || 'Pending';
}

function methodLabel(method) {
  return METHOD_LABELS[method] || (method ? String(method) : '—');
}

function orderCard(order) {
  const status = statusClass(order.status);
  const date = Number(order.createdAt)
    ? new Date(Number(order.createdAt)).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })
    : '—';

  const amount =
    order.method === 'wallet' && Number(order.walletCharged)
      ? order.walletCharged
      : order.amount;

  const pendingWallet = order.method === 'wallet' && order.status === 'pending';

  return `
    <article class="order-card">
      <div class="order-card__main">
        <strong>${escapeHTML(order.itemName || 'Order')}</strong>
        <div class="order-card__meta">
          <span><i class="fa-solid fa-hashtag"></i> <code>${escapeHTML(order.orderId || '—')}</code></span>
          <span><i class="fa-regular fa-calendar"></i> ${date}</span>
          <span><i class="fa-solid fa-wallet"></i> ${escapeHTML(methodLabel(order.method))}</span>
        </div>
        ${
          pendingWallet
            ? '<p class="order-card__note"><i class="fa-solid fa-clock"></i> Awaiting staff approval before delivery.</p>'
            : ''
        }
        ${
          order.status === 'cancelled' && order.cancelReason
            ? `<p class="order-card__note order-card__note--danger"><i class="fa-solid fa-circle-info"></i> ${escapeHTML(
                order.cancelReason
              )}</p>`
            : ''
        }
      </div>
      <div class="order-card__side">
        <span class="order-amount">${escapeHTML(formatAmount(amount))}</span>
        <span class="badge status-pill--${status}">${statusLabel(status)}</span>
      </div>
    </article>`;
}

function formatAmount(value) {
  const n = Number(value) || 0;
  return `৳${n.toLocaleString('en-BD')}`;
}

function renderCloudNote() {
  const note = document.getElementById('cloudNote');
  if (!note) return;
  const ok = isCloudAvailable();
  note.classList.toggle('is-local', !ok);
  const icon = note.querySelector('i');
  const text = note.querySelector('span');
  if (icon) icon.className = ok ? 'fa-solid fa-cloud' : 'fa-solid fa-hard-drive';
  if (text) {
    text.textContent = ok
      ? 'Cloud sync active — orders follow your account on every device.'
      : 'Local mode — orders are saved on this device only. Enable Firestore to sync them.';
  }
}

async function renderOrders(user) {
  const list = document.getElementById('ordersList');
  const count = document.getElementById('ordersCount');
  const total = document.getElementById('acOrders');

  list.innerHTML = '<p class="form-hint">Loading orders…</p>';

  const orders = await getOrders(user.uid);

  if (count) count.textContent = String(orders.length);
  if (total) total.textContent = String(orders.length);

  if (!orders.length) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-bag-shopping"></i>
        <h3>No orders yet</h3>
        <p>Ranks, coins and vouchers you buy will appear here.</p>
        <div style="margin-top:16px;">
          <a class="btn btn-primary btn-sm" href="../store/">Browse the store</a>
        </div>
      </div>`;
    renderCloudNote();
    return;
  }

  list.innerHTML = orders.map(orderCard).join('');
  renderCloudNote();
}

/* ------------------------------- wallet -------------------------------- */

const TOPUP_STATUS = {
  pending: { label: 'Pending review', cls: 'pending' },
  approved: { label: 'Credited', cls: 'approved' },
  rejected: { label: 'Rejected', cls: 'rejected' }
};

function playerWalletError(error) {
  if (error?.code === 'permission-denied') {
    return 'Wallet sync is temporarily unavailable. Please try again later or ask staff on Discord.';
  }
  return walletErrorMessage(error);
}

function animateBalance(node, value) {
  if (!node) return;
  const target = Math.max(0, Math.round(Number(value) || 0));
  if (node.dataset.value === String(target)) return;
  node.dataset.value = String(target);

  const from = Number(String(node.textContent).replace(/[^\d]/g, '')) || 0;

  if (reducedMotion() || from === target) {
    node.textContent = formatBDT(target);
    return;
  }

  if (node._balanceRaf) cancelAnimationFrame(node._balanceRaf);
  const started = performance.now();

  const step = (now) => {
    const progress = Math.min(1, (now - started) / 700);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = formatBDT(Math.round(from + (target - from) * eased));
    if (progress < 1) node._balanceRaf = requestAnimationFrame(step);
  };

  node._balanceRaf = requestAnimationFrame(step);
}

function renderWallet(wallet) {
  const node = document.getElementById('walletBalance');
  if (!node) return;
  walletErrorShown = false;
  node.classList.remove('is-error');
  node.title = 'Store credit, updated live';
  animateBalance(node, wallet?.balance || 0);
}

function handleWalletError(error) {
  console.warn('[TKBD] Wallet unavailable:', error?.code || error);
  const node = document.getElementById('walletBalance');
  if (node) {
    node.textContent = '৳—';
    node.classList.add('is-error');
    node.title = playerWalletError(error);
  }
  if (walletErrorShown) return;
  walletErrorShown = true;
  toast({
    title: 'Wallet unavailable',
    message: playerWalletError(error),
    type: 'error',
    duration: 6500
  });
}

function topupDate(value) {
  const ts = Number(value) || 0;
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function topupCard(topup) {
  const meta = TOPUP_STATUS[topup.status] || TOPUP_STATUS.pending;
  const payment = PAYMENTS.find((row) => row.id === topup.method);
  const name = payment?.name || methodLabel(topup.method);
  const pending = topup.status === 'pending';
  const rejected = topup.status === 'rejected';
  const requestId = topup.requestId || topup.id;

  const message = pending
    ? 'Waiting for staff to verify the payment. You will see the credit here once approved.'
    : rejected
    ? 'This request was not credited.'
    : 'Added to your store credit.';

  return `
    <article class="topup-card topup-card--${meta.cls}">
      <span class="topup-card__icon"><i class="fa-solid fa-${
        pending ? 'hourglass-half' : rejected ? 'xmark' : 'check'
      }"></i></span>
      <div class="topup-card__body">
        <div class="topup-card__top">
          <strong>${escapeHTML(formatAmount(topup.amount))}</strong>
          <span class="badge status-pill--${meta.cls}">${meta.label}</span>
        </div>
        <div class="topup-card__meta">
          <span><i class="fa-solid fa-mobile-screen-button"></i> ${escapeHTML(name)}</span>
          <span><i class="fa-regular fa-calendar"></i> ${topupDate(topup.createdAt)}</span>
          ${
            topup.txnId
              ? `<span><i class="fa-solid fa-hashtag"></i> <code>${escapeHTML(
                  topup.txnId
                )}</code></span>`
              : ''
          }
        </div>
        <p class="topup-card__message">${escapeHTML(message)}</p>
        ${
          topup.adminNote
            ? `<p class="topup-card__reason"><i class="fa-solid fa-circle-info"></i> ${escapeHTML(
                topup.adminNote
              )}</p>`
            : ''
        }
        <p class="topup-card__id">Request <code>${escapeHTML(requestId || '—')}</code></p>
      </div>
    </article>`;
}

function renderTopups(rows) {
  const list = document.getElementById('topupList');
  const count = document.getElementById('topupsCount');
  const pendingNode = document.getElementById('walletPendingCount');
  if (!list) return;

  const topups = Array.isArray(rows) ? rows : [];
  const pending = topups.filter((row) => row.status === 'pending').length;

  if (count) count.textContent = String(topups.length);
  if (pendingNode) pendingNode.textContent = String(pending);

  if (!topups.length) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-wallet"></i>
        <h3>No top-ups yet</h3>
        <p>Add store credit with bKash or Nagad. Staff verify the payment before it appears in your wallet.</p>
        <div style="margin-top:16px;">
          <button type="button" class="btn btn-primary btn-sm" data-open-modal="topupModal">
            <i class="fa-solid fa-plus"></i> Top up wallet
          </button>
        </div>
      </div>`;
    return;
  }

  list.innerHTML = topups.map(topupCard).join('');
}

function handleTopupsError(error) {
  console.warn('[TKBD] Top-up history unavailable:', error?.code || error);
  const list = document.getElementById('topupList');
  if (list) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-cloud-bolt"></i>
        <h3>Could not load top-ups</h3>
        <p>${escapeHTML(playerWalletError(error))}</p>
      </div>`;
  }
  if (walletErrorShown) return;
  walletErrorShown = true;
  toast({
    title: 'Wallet unavailable',
    message: playerWalletError(error),
    type: 'error',
    duration: 6500
  });
}

function stopWalletWatchers() {
  try {
    walletUnsubscribe();
  } catch {
    /* ignore */
  }
  try {
    topupsUnsubscribe();
  } catch {
    /* ignore */
  }
  walletUnsubscribe = () => {};
  topupsUnsubscribe = () => {};
}

function resetWalletDisplay() {
  const balance = document.getElementById('walletBalance');
  if (balance) {
    balance.textContent = '৳0';
    balance.dataset.value = '';
    balance.classList.remove('is-error');
  }
  const pending = document.getElementById('walletPendingCount');
  if (pending) pending.textContent = '0';
  const count = document.getElementById('topupsCount');
  if (count) count.textContent = '0';
  const list = document.getElementById('topupList');
  if (list) list.innerHTML = '<p class="form-hint">Loading top-ups…</p>';
  walletErrorShown = false;
}

function startWalletWatchers(user) {
  stopWalletWatchers();
  walletErrorShown = false;

  try {
    walletUnsubscribe = watchWallet(user.uid, renderWallet, handleWalletError);
    topupsUnsubscribe = watchTopups(user.uid, renderTopups, handleTopupsError);
  } catch (error) {
    handleWalletError(error);
  }
}

/* ----------------------------- top-up form ----------------------------- */

function paymentFor(id) {
  return PAYMENTS.find((payment) => payment.id === id) || PAYMENTS[0];
}

function setTopupMethod(id) {
  const payment = paymentFor(id);
  topupMethod = payment.id;

  if (topupNumber) topupNumber.textContent = payment.number;

  document.querySelectorAll('[data-topup-method]').forEach((button) => {
    const active = button.dataset.topupMethod === payment.id;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-checked', String(active));
  });
}

function clearTopupError() {
  if (!topupError) return;
  topupError.textContent = '';
  topupError.hidden = true;
  topupForm?.querySelectorAll('[aria-invalid="true"]').forEach((input) => {
    input.removeAttribute('aria-invalid');
  });
}

function showTopupError(message, fieldErrors = null) {
  if (topupError) {
    topupError.textContent = message;
    topupError.hidden = false;
  }

  if (!fieldErrors || !topupForm) return;

  let first = null;
  Object.keys(fieldErrors).forEach((field) => {
    const input = topupForm.elements[field];
    if (!input) return;
    input.setAttribute('aria-invalid', 'true');
    if (!first) first = input;
  });

  first?.focus({ preventScroll: false });
}

function setTopupBusy(busy) {
  topupBusy = busy;
  if (!topupSubmit) return;
  topupSubmit.disabled = busy;
  topupSubmit.classList.toggle('is-busy', busy);
}

function setupTopupModal() {
  if (!topupForm) return;

  const amountInput = topupForm.elements.amount;
  if (amountInput) {
    amountInput.min = String(WALLET.minTopup);
    amountInput.max = String(WALLET.maxTopup);
  }
  const min = document.getElementById('topupMin');
  const max = document.getElementById('topupMax');
  if (min) min.textContent = WALLET.minTopup.toLocaleString('en-BD');
  if (max) max.textContent = WALLET.maxTopup.toLocaleString('en-BD');

  if (topupPresets) {
    topupPresets.innerHTML = WALLET.presets
      .map(
        (amount) =>
          `<button type="button" data-topup-preset="${amount}">৳${amount.toLocaleString(
            'en-BD'
          )}</button>`
      )
      .join('');
  }

  setTopupMethod('bkash');

  document.querySelectorAll('[data-topup-method]').forEach((button) => {
    button.addEventListener('click', () => setTopupMethod(button.dataset.topupMethod));
  });

  topupPresets?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-topup-preset]');
    if (!button || !amountInput) return;
    amountInput.value = button.dataset.topupPreset;
    amountInput.removeAttribute('aria-invalid');
    clearTopupError();
    topupPresets.querySelectorAll('button').forEach((node) => {
      node.classList.toggle('is-active', node === button);
    });
    amountInput.focus();
  });

  amountInput?.addEventListener('input', () => {
    topupPresets?.querySelectorAll('button.is-active').forEach((node) => {
      node.classList.remove('is-active');
    });
  });

  topupForm.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    event.target.removeAttribute('aria-invalid');
    if (topupError && !topupError.hidden) clearTopupError();
  });

  topupCopyBtn?.addEventListener('click', async () => {
    const payment = paymentFor(topupMethod);
    const ok = await copyText(payment.number);
    toast(
      ok
        ? {
            title: `${payment.name} number copied`,
            message: `Send money to ${payment.number}.`,
            type: 'success'
          }
        : {
            title: 'Copy failed',
            message: `Copy it manually: ${payment.number}`,
            type: 'error'
          }
    );
  });

  topupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (topupBusy) return;

    if (!lastUser) {
      toast({
        title: 'Log in first',
        message: 'Your top-up request needs an account.',
        type: 'warning'
      });
      return;
    }

    clearTopupError();

    const amount = Number(amountInput?.value);
    const senderNumber = String(topupForm.elements.senderNumber.value || '').trim();
    const txnId = String(topupForm.elements.txnId.value || '').trim();
    const note = String(topupForm.elements.note.value || '').trim();

    const check = validateTopup({
      amount,
      method: topupMethod,
      senderNumber,
      txnId
    });

    if (!check.ok) {
      showTopupError(Object.values(check.errors)[0], check.errors);
      return;
    }

    setTopupBusy(true);

    try {
      await createTopup({
        uid: lastUser.uid,
        email: lastUser.email || '',
        username: lastProfile.username || '',
        ign: lastProfile.ign || '',
        amount: check.amount,
        method: topupMethod,
        senderNumber: check.sender,
        txnId: check.txn,
        note
      });

      topupForm.reset();
      topupPresets?.querySelectorAll('button.is-active').forEach((node) => {
        node.classList.remove('is-active');
      });
      setTopupMethod(topupMethod);
      clearTopupError();
      closeModal('topupModal');

      toast({
        title: 'Top-up request sent',
        message: `We received your ${formatAmount(
          check.amount
        )} request. Staff will verify the payment and credit your wallet.`,
        type: 'success',
        duration: 6200
      });

      document.getElementById('topups')?.scrollIntoView({
        behavior: reducedMotion() ? 'auto' : 'smooth',
        block: 'start'
      });
    } catch (error) {
      console.error('[TKBD] Could not create top-up:', error);
      if (error?.fieldErrors) {
        showTopupError(Object.values(error.fieldErrors)[0], error.fieldErrors);
      } else {
        showTopupError(playerWalletError(error));
      }
    } finally {
      setTopupBusy(false);
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-open-modal="topupModal"]')) return;
    clearTopupError();
    setTimeout(() => amountInput?.focus({ preventScroll: true }), 140);
  });
}

/* ------------------------------ auth wiring --------------------------- */

onAuth(async ({ ready, user, profile }) => {
  if (!ready) return;

  loadingView.hidden = true;
  guestView.hidden = Boolean(user);
  userView.hidden = !user;

  if (!user) {
    loadedUid = null;
    stopWalletWatchers();
    resetWalletDisplay();
    return;
  }

  renderProfile(user, profile || {});
  renderVerification(user);

  if (loadedUid !== user.uid) {
    loadedUid = user.uid;
    startWalletWatchers(user);
    await renderOrders(user);
  } else {
    renderCloudNote();
  }

  if (!topupAutoOpened && new URLSearchParams(window.location.search).has('topup')) {
    topupAutoOpened = true;
    setTimeout(() => {
      openModal('topupModal');
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash || '#wallet'}`);
      setTimeout(() => topupForm?.elements.amount?.focus({ preventScroll: true }), 180);
    }, 420);
  }
});

/* ------------------------------ profile form -------------------------- */

profileForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = profileForm.querySelector('[type="submit"]');
  const username = profileForm.elements.username.value.trim();
  const ign = profileForm.elements.ign.value.trim();

  if (!username || !ign) {
    toast({ title: 'Missing details', message: 'Fill in both your username and Minecraft IGN.', type: 'error' });
    return;
  }

  button.disabled = true;
  button.classList.add('is-busy');

  try {
    const currentName = lastProfile.username || lastUser?.displayName || '';
    if (username !== currentName) await updateUsername(username);
    if (ign !== lastProfile.ign) await updateIgn(ign);

    toast({ title: 'Profile saved', message: 'Your details are up to date.', type: 'success' });
  } catch (error) {
    toast({
      title: 'Could not save',
      message: error?.message || 'Please try again.',
      type: 'error',
      duration: 5200
    });
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
  }
});

/* ------------------------------ verify --------------------------------- */

document.getElementById('resendVerifyBtn')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  await resendVerification();
  button.disabled = false;
});

document.getElementById('checkVerifyBtn')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.classList.add('is-busy');
  try {
    const verified = await refreshVerification();
    if (verified) {
      toast({ title: 'Email verified', message: 'Your account is fully verified.', type: 'success' });
    } else {
      toast({
        title: 'Not verified yet',
        message: 'Click the link in your email, then try again.',
        type: 'warning'
      });
    }
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
  }
});

/* ------------------------------ password ------------------------------- */

document.getElementById('resetPasswordBtn')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await sendPasswordResetToCurrent();
    toast({
      title: 'Reset email sent',
      message: 'Check your inbox for the password reset link.',
      type: 'success'
    });
  } catch (error) {
    toast({
      title: 'Could not send email',
      message: 'Please try again in a moment.',
      type: 'error'
    });
  } finally {
    button.disabled = false;
  }
});

/* ------------------------------ bootstrap ----------------------------- */

setupTopupModal();
