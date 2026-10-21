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
  escapeHTML
} from '../js/ui.js';

initAuth();
bindServerAddresses();
initNav();
initScrollProgress();
initCopyButtons();

const loadingView = document.getElementById('accountLoading');
const guestView = document.getElementById('guestView');
const userView = document.getElementById('userView');
const profileForm = document.getElementById('profileForm');

let loadedUid = null;
let lastUser = null;
let lastProfile = {};

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

function statusClass(status) {
  return ['pending', 'paid', 'delivered'].includes(status) ? status : 'pending';
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

  const method = String(order.method || '')
    .replace(/^./, (ch) => ch.toUpperCase());

  return `
    <article class="order-card">
      <div class="order-card__main">
        <strong>${escapeHTML(order.itemName || 'Order')}</strong>
        <div class="order-card__meta">
          <span><i class="fa-solid fa-hashtag"></i> <code>${escapeHTML(order.orderId || '—')}</code></span>
          <span><i class="fa-regular fa-calendar"></i> ${date}</span>
          <span><i class="fa-solid fa-wallet"></i> ${escapeHTML(method || '—')}</span>
        </div>
      </div>
      <div class="order-card__side">
        <span class="order-amount">${escapeHTML(formatAmount(order.amount))}</span>
        <span class="badge status-pill--${status}">${status}</span>
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

/* ------------------------------ auth wiring --------------------------- */

onAuth(async ({ ready, user, profile }) => {
  if (!ready) return;

  loadingView.hidden = true;
  guestView.hidden = Boolean(user);
  userView.hidden = !user;

  if (!user) {
    loadedUid = null;
    return;
  }

  renderProfile(user, profile || {});
  renderVerification(user);

  if (loadedUid !== user.uid) {
    loadedUid = user.uid;
    await renderOrders(user);
  } else {
    renderCloudNote();
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
