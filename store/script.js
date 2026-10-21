/* =========================================================================
   STORE — catalog, currency converter, checkout
   Prices come from js/config.js only. Nothing is hard-coded in the HTML.
   ========================================================================= */

import { CATEGORIES, ITEMS, PAYMENTS, FX, formatBDT, itemById } from '../js/config.js';
import { initAuth, onAuth, getUser, getProfileData } from '../js/auth.js';
import {
  toast,
  initNav,
  initScrollProgress,
  initReveal,
  initCopyButtons,
  bindServerAddresses,
  openModal,
  closeModal
} from '../js/ui.js';
import { saveOrder } from '../js/data.js';

initAuth();
bindServerAddresses();
initNav();
initScrollProgress();
initCopyButtons();
initReveal();

/* ----------------------------- catalog -------------------------------- */

function cardHTML(item) {
  const badge = item.badge
    ? `<span class="product-card__badge">${item.badge}</span>`
    : '';

  if (item.kind === 'rank') {
    return `
      <article class="rank-card tier-${item.tier}">
        ${badge}
        <div class="rank-card__icon"><i class="${item.icon}"></i></div>
        <h3>${item.name.replace(' Rank', '').toUpperCase()}</h3>
        <ul class="rank-card__perks">
          ${item.perks.map((perk) => `<li><i class="fa-solid fa-check"></i>${perk}</li>`).join('')}
        </ul>
        <div class="rank-card__price">${formatBDT(item.price)} <span>BDT</span></div>
        <button type="button" class="product-card__buy" data-buy="${item.id}">
          Buy now <i class="fa-solid fa-arrow-right"></i>
        </button>
      </article>`;
  }

  return `
    <article class="product-card">
      ${badge}
      <div class="product-card__value">${item.big}<small>${item.unit}</small></div>
      <div class="product-card__price">${formatBDT(item.price)} <span>BDT</span></div>
      <button type="button" class="product-card__buy" data-buy="${item.id}">
        Buy now <i class="fa-solid fa-arrow-right"></i>
      </button>
    </article>`;
}

function renderCatalog() {
  const root = document.getElementById('storeRoot');
  if (!root) return;

  root.innerHTML = CATEGORIES.map((cat) => {
    const items = ITEMS.filter((item) => item.cat === cat.id);
    return `
      <section class="category-block" id="cat-${cat.id}">
        <div class="category-head">
          <div>
            <h2><i class="${cat.icon}"></i> ${cat.title}</h2>
            <p>${cat.blurb}</p>
          </div>
          <span class="category-count">${items.length} items</span>
        </div>
        <div class="store-grid">${items.map(cardHTML).join('')}</div>
      </section>`;
  }).join('');
}

renderCatalog();

/* --------------------------- currency converter ------------------------ */

const fxAmount = document.getElementById('fxAmount');
const fxCurrency = document.getElementById('fxCurrency');
const fxResult = document.getElementById('fxResult');
const fxBadge = document.getElementById('fxBadge');

let fxRates = { ...FX.fallback };
let fxLive = false;

function readFxCache() {
  try {
    const raw = localStorage.getItem(FX.cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.rates || Date.now() - parsed.at > FX.ttlMs) return null;
    return parsed.rates;
  } catch {
    return null;
  }
}

function writeFxCache(rates) {
  try {
    localStorage.setItem(FX.cacheKey, JSON.stringify({ at: Date.now(), rates }));
  } catch {
    /* ignore */
  }
}

function applyRates(rates, live) {
  fxRates = { ...FX.fallback, ...rates };
  fxLive = live;
  if (fxBadge) {
    fxBadge.textContent = live ? 'Live rates' : 'Approx rates';
    fxBadge.classList.toggle('is-static', !live);
  }
  updateConversion();
}

async function loadRates() {
  const cached = readFxCache();
  if (cached) {
    applyRates(cached, true);
    return;
  }

  try {
    const res = await fetch(FX.endpoint, { cache: 'no-store' });
    if (!res.ok) throw new Error('rates unavailable');
    const data = await res.json();
    if (data?.result !== 'success' || !data.rates) throw new Error('bad payload');
    writeFxCache(data.rates);
    applyRates(data.rates, true);
  } catch {
    applyRates(FX.fallback, false);
  }
}

function updateConversion() {
  if (!fxResult || !fxAmount || !fxCurrency) return;
  const amount = Number(fxAmount.value);
  const code = fxCurrency.value;
  const rate = fxRates[code];

  if (!Number.isFinite(amount) || amount <= 0 || !rate) {
    fxResult.textContent = '—';
    return;
  }

  const value = amount * rate;
  try {
    fxResult.textContent = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: value < 1 ? 4 : 2
    }).format(value);
  } catch {
    fxResult.textContent = `${value.toFixed(2)} ${code}`;
  }
}

fxAmount?.addEventListener('input', updateConversion);
fxCurrency?.addEventListener('change', updateConversion);
loadRates();

/* ------------------------------ checkout ------------------------------ */

let cart = null;
let pendingItemId = null;

function makeOrderId() {
  const time = Date.now().toString(36).toUpperCase().slice(-6);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `KBD-${time}-${rand}`;
}

function renderPayMethods() {
  const host = document.getElementById('payMethods');
  if (!host) return;
  host.innerHTML = PAYMENTS.map(
    (method, index) => `
      <button type="button" class="pay-method${index === 0 ? ' is-active' : ''}" data-method="${method.id}">
        <i class="${method.icon}"></i>
        <span>${method.name}</span>
      </button>`
  ).join('');
}

function renderPayPanel(methodId) {
  const panel = document.getElementById('payPanel');
  if (!panel || !cart) return;

  const method = PAYMENTS.find((row) => row.id === methodId) || PAYMENTS[0];
  cart.method = method.id;

  const steps = [
    `Open ${method.name} and choose <b>${method.step}</b>`,
    `Send to <b>${method.number}</b>`,
    `Amount: <b>${formatBDT(cart.item.price)}</b>`,
    `Reference: <b>${cart.orderId}</b>`
  ];

  panel.innerHTML = `
    <div class="pay-panel">
      <div class="pay-panel__title"><i class="${method.icon}"></i> ${method.name} instructions</div>

      <div class="pay-amount">
        <span>Amount to send</span>
        <strong>${formatBDT(cart.item.price)}</strong>
      </div>

      <div class="pay-number">
        <code>${method.number}</code>
        <button type="button" class="btn btn-ghost btn-sm" data-copy="${method.number}">Copy</button>
      </div>

      <div class="pay-steps">
        ${steps
          .map(
            (step, index) =>
              `<p><span class="step-num">${index + 1}</span><span>${step}</span></p>`
          )
          .join('')}
      </div>

      <div class="order-id-row" style="margin-top:16px;">
        <span>Order ID</span>
        <code>${cart.orderId}</code>
        <button type="button" class="btn btn-ghost btn-sm" data-copy="${cart.orderId}">Copy</button>
      </div>

      <div class="order-actions">
        <button type="button" class="btn btn-gold btn-block" id="placeOrder">
          <span class="btn__label">I have sent the payment</span>
        </button>
      </div>

      <p class="pay-note">
        <i class="fa-solid fa-triangle-exclamation"></i>
        Only send money to the number shown above. Staff will never ask for your password or OTP.
      </p>
    </div>`;

  document.getElementById('placeOrder')?.addEventListener('click', placeOrder);
}

function openCheckout(itemId) {
  const item = itemById(itemId);
  if (!item) return;

  const user = getUser();
  if (!user) {
    pendingItemId = itemId;
    toast({
      title: 'Login required',
      message: 'Log in first so your order is attached to your account.',
      type: 'info'
    });
    openModal('authModal');
    return;
  }

  const profile = getProfileData() || {};

  if (!profile.ign) {
    toast({
      title: 'Add your Minecraft IGN',
      message: 'We need your in-game name to deliver the purchase. Set it on your account page.',
      type: 'warning',
      duration: 6200
    });
    setTimeout(() => {
      window.location.href = '../account/';
    }, 1600);
    return;
  }

  cart = {
    item,
    orderId: makeOrderId(),
    method: PAYMENTS[0].id
  };

  const nameNode = document.getElementById('coName');
  const priceNode = document.getElementById('coPrice');
  const ignNode = document.getElementById('coIgn');

  if (nameNode) nameNode.textContent = item.name;
  if (priceNode) priceNode.textContent = formatBDT(item.price);
  if (ignNode) ignNode.textContent = profile.ign;

  renderPayMethods();
  renderPayPanel(PAYMENTS[0].id);
  openModal('checkoutModal');
}

async function placeOrder(event) {
  const button = event.currentTarget;
  if (!cart || button.disabled) return;

  const user = getUser();
  if (!user) {
    toast({ title: 'Session expired', message: 'Please log in again.', type: 'error' });
    openModal('authModal');
    return;
  }

  const profile = getProfileData() || {};

  button.disabled = true;
  button.classList.add('is-busy');

  try {
    const record = {
      orderId: cart.orderId,
      uid: user.uid,
      email: user.email,
      username: profile.username || user.displayName || '',
      ign: profile.ign || '',
      itemId: cart.item.id,
      itemName: cart.item.name,
      category: cart.item.cat,
      amount: cart.item.price,
      currency: 'BDT',
      method: cart.method,
      status: 'pending'
    };

    await saveOrder(record);

    const setId = document.getElementById('cfId');
    const setItem = document.getElementById('cfItem');
    const setAmount = document.getElementById('cfAmount');

    if (setId) setId.textContent = record.orderId;
    if (setItem) setItem.textContent = record.itemName;
    if (setAmount) setAmount.textContent = formatBDT(record.amount);

    closeModal('checkoutModal');
    openModal('confirmModal');

    toast({
      title: 'Order placed',
      message: `Send your transaction ID on Discord with order ${record.orderId}.`,
      type: 'success',
      duration: 6500
    });
  } catch (error) {
    console.error('[TKBD] order failed', error);
    toast({
      title: 'Could not save order',
      message: 'Please try again or contact staff on Discord.',
      type: 'error'
    });
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
  }
}

document.addEventListener('click', (event) => {
  const buy = event.target.closest('[data-buy]');
  if (buy) {
    event.preventDefault();
    openCheckout(buy.dataset.buy);
    return;
  }

  const method = event.target.closest('[data-method]');
  if (method && cart) {
    document.querySelectorAll('.pay-method').forEach((node) => {
      node.classList.toggle('is-active', node === method);
    });
    renderPayPanel(method.dataset.method);
  }
});

/* Re-open checkout after a successful login */
onAuth(({ ready, user }) => {
  if (!ready) return;

  if (user && pendingItemId) {
    const itemId = pendingItemId;
    pendingItemId = null;
    setTimeout(() => openCheckout(itemId), 350);
  }
});
