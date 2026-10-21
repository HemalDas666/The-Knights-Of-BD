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
  closeModal,
  escapeHTML
} from '../js/ui.js';
import { saveOrder } from '../js/data.js';
import { getWallet, watchWallet } from '../js/wallet.js';

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

/* ------------------------------ wallet -------------------------------- */

let walletState = { balance: 0, exists: false };
let walletKnown = false;
let walletError = null;
let walletUid = null;
let walletUnsubscribe = () => {};

function canPayWithWallet(price) {
  return (
    walletKnown &&
    !walletError &&
    Number(walletState.balance) >= Number(price)
  );
}

function walletAffordable() {
  return Boolean(cart) && canPayWithWallet(cart.item.price);
}

function startWalletWatch(user) {
  if (!user || walletUid === user.uid) return;

  stopWalletWatch();
  walletUid = user.uid;
  walletKnown = false;
  walletError = null;

  walletUnsubscribe = watchWallet(
    user.uid,
    (next) => {
      walletState = next;
      walletKnown = true;
      walletError = null;
      handleWalletUpdate();
    },
    (error) => {
      console.warn('[TKBD] Store wallet unavailable:', error?.code || error);
      walletKnown = true;
      walletError = error;
      handleWalletUpdate();
    }
  );
}

function stopWalletWatch() {
  try {
    walletUnsubscribe();
  } catch {
    /* ignore */
  }
  walletUnsubscribe = () => {};
  walletUid = null;
  walletKnown = false;
  walletError = null;
  walletState = { balance: 0, exists: false };
}

function handleWalletUpdate() {
  if (!cart) return;

  if (cart.method === 'wallet' && !walletAffordable()) {
    cart.method = PAYMENTS[0].id;
    toast({
      title: 'Wallet balance changed',
      message: 'Choose another payment method or top up your wallet.',
      type: 'warning'
    });
  }

  renderPayMethods();
  renderPayPanel(cart.method);
  renderCheckoutWallet();
}

async function ensureWallet() {
  const user = getUser();
  if (!user || walletUid !== user.uid || walletKnown) return;

  try {
    walletState = await getWallet(user.uid);
    walletKnown = true;
    walletError = null;
  } catch (error) {
    console.warn('[TKBD] Could not read wallet:', error?.code || error);
    walletKnown = true;
    walletError = error;
  }
}

function renderCheckoutWallet() {
  const host = document.getElementById('checkoutWallet');
  const balance = document.getElementById('coWalletBalance');
  const note = document.getElementById('coWalletNote');
  if (!host || !balance || !note || !cart) return;

  host.classList.toggle('is-error', Boolean(walletError));
  host.classList.toggle('is-ready', walletAffordable());

  if (walletError) {
    balance.textContent = '৳—';
    note.textContent = 'Wallet balance is unavailable right now. Pay with bKash or Nagad instead.';
    return;
  }

  if (!walletKnown) {
    balance.textContent = '৳—';
    note.textContent = 'Checking your wallet…';
    return;
  }

  balance.textContent = formatBDT(walletState.balance);

  if (walletAffordable()) {
    note.textContent = 'Enough for this item. Nothing is deducted until staff approve.';
  } else {
    const short = Math.max(0, Number(cart.item.price) - Number(walletState.balance));
    note.textContent = `You need ${formatBDT(short)} more to pay with wallet.`;
  }
}

function makeOrderId() {
  const time = Date.now().toString(36).toUpperCase().slice(-6);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `KBD-${time}-${rand}`;
}

function renderPayMethods() {
  const host = document.getElementById('payMethods');
  if (!host) return;

  const cash = PAYMENTS.map((method) => {
    const active = cart?.method === method.id;
    return `
      <button type="button" class="pay-method${active ? ' is-active' : ''}" data-method="${method.id}">
        <i class="${method.icon}"></i>
        <span>${method.name}</span>
      </button>`;
  }).join('');

  let walletHint = '…';
  let walletDisabled = true;
  let walletTitle = 'Checking your wallet balance';

  if (walletError) {
    walletHint = 'Unavailable';
    walletTitle = 'Wallet balance is unavailable right now';
  } else if (walletKnown) {
    walletHint = formatBDT(walletState.balance);
    walletDisabled = !walletAffordable();
    walletTitle = walletDisabled
      ? `Add ${formatBDT(Math.max(0, Number(cart?.item.price || 0) - Number(walletState.balance)))} more to use your wallet`
      : 'Pay from your store credit';
  }

  const walletActive = cart?.method === 'wallet' && !walletDisabled;

  host.innerHTML =
    cash +
    `
      <button type="button"
        class="pay-method pay-method--wallet${walletActive ? ' is-active' : ''}${walletDisabled ? ' is-disabled' : ''}"
        data-method="wallet"
        title="${walletTitle}"
        ${walletDisabled ? 'disabled aria-disabled="true"' : ''}>
        <i class="fa-solid fa-wallet"></i>
        <span>Wallet</span>
        <small>${walletHint}</small>
      </button>`;

  renderCheckoutWallet();
}

function renderPayPanel(methodId) {
  const panel = document.getElementById('payPanel');
  if (!panel || !cart) return;

  if (methodId === 'wallet') {
    if (!walletAffordable()) {
      cart.method = PAYMENTS[0].id;
      renderPayMethods();
      renderPayPanel(cart.method);
      return;
    }

    cart.method = 'wallet';
    const price = Number(cart.item.price);
    const remaining = Math.max(0, Number(walletState.balance) - price);

    panel.innerHTML = `
      <div class="pay-panel pay-panel--wallet">
        <div class="pay-panel__title"><i class="fa-solid fa-wallet"></i> Pay from your wallet</div>

        <div class="pay-split">
          <div>
            <span>Item price</span>
            <strong>${formatBDT(price)}</strong>
          </div>
          <div>
            <span>Balance after approval</span>
            <strong>${formatBDT(remaining)}</strong>
          </div>
        </div>

        <div class="pay-steps">
          <p><span class="step-num">1</span><span>Place the request now. <b>No money leaves your wallet yet.</b></span></p>
          <p><span class="step-num">2</span><span>Staff approve the order and deduct the exact item price.</span></p>
          <p><span class="step-num">3</span><span>Your purchase is delivered in-game to <b>${escapeHTML(
            cart.ign || ''
          )}</b>.</span></p>
        </div>

        <div class="order-id-row" style="margin-top:16px;">
          <span>Order ID</span>
          <code>${cart.orderId}</code>
          <button type="button" class="btn btn-ghost btn-sm" data-copy="${cart.orderId}">Copy</button>
        </div>

        <div class="order-actions">
          <button type="button" class="btn btn-gold btn-block" id="placeOrder">
            <span class="btn__label"><i class="fa-solid fa-wallet"></i> Confirm wallet order</span>
          </button>
          <a class="btn btn-ghost btn-block" href="../account/?topup=1#wallet">
            <i class="fa-solid fa-plus"></i> Add more credit
          </a>
        </div>

        <p class="pay-note">
          <i class="fa-solid fa-shield-halved"></i>
          Nothing is deducted until staff approve. If the order is cancelled, your balance stays untouched.
        </p>
      </div>`;

    document.getElementById('placeOrder')?.addEventListener('click', placeOrder);
    return;
  }

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

async function openCheckout(itemId) {
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

  await ensureWallet();

  const method = canPayWithWallet(item.price) ? 'wallet' : PAYMENTS[0].id;

  cart = {
    item,
    orderId: makeOrderId(),
    method,
    ign: profile.ign
  };

  const nameNode = document.getElementById('coName');
  const priceNode = document.getElementById('coPrice');
  const ignNode = document.getElementById('coIgn');

  if (nameNode) nameNode.textContent = item.name;
  if (priceNode) priceNode.textContent = formatBDT(item.price);
  if (ignNode) ignNode.textContent = profile.ign;

  renderPayMethods();
  renderPayPanel(method);
  openModal('checkoutModal');
}

function setConfirmation(record, usingWallet) {
  const title = document.getElementById('confirmTitle');
  const sub = document.getElementById('confirmSub');
  const status = document.getElementById('cfStatus');
  const discord = document.getElementById('cfDiscord');
  const walletLink = document.getElementById('cfWalletLink');

  const setId = document.getElementById('cfId');
  const setItem = document.getElementById('cfItem');
  const setAmount = document.getElementById('cfAmount');

  if (setId) setId.textContent = record.orderId;
  if (setItem) setItem.textContent = record.itemName;
  if (setAmount) setAmount.textContent = formatBDT(record.amount);

  if (title) title.textContent = usingWallet ? 'Wallet order requested' : 'Order placed';
  if (sub) {
    sub.textContent = usingWallet
      ? 'Staff will verify your balance and approve the purchase. Nothing is deducted until they do.'
      : 'Send the transaction ID on Discord and staff will deliver your purchase in-game.';
  }
  if (status) status.textContent = usingWallet ? 'Pending review' : 'Pending';
  if (discord) discord.hidden = usingWallet;
  if (walletLink) walletLink.hidden = !usingWallet;
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

  const usingWallet = cart.method === 'wallet';

  if (usingWallet && !canPayWithWallet(cart.item.price)) {
    toast({
      title: 'Wallet balance too low',
      message: 'Top up your wallet or choose bKash / Nagad to continue.',
      type: 'warning'
    });
    renderPayMethods();
    renderPayPanel(PAYMENTS[0].id);
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
      ign: profile.ign || cart.ign || '',
      itemId: cart.item.id,
      itemName: cart.item.name,
      category: cart.item.cat,
      amount: cart.item.price,
      currency: 'BDT',
      method: cart.method,
      status: 'pending'
    };

    await saveOrder(record, { requireCloud: usingWallet });
    cart = null;

    setConfirmation(record, usingWallet);
    closeModal('checkoutModal');
    openModal('confirmModal');

    toast({
      title: usingWallet ? 'Wallet order submitted' : 'Order placed',
      message: usingWallet
        ? `Order ${record.orderId} is waiting for staff approval. Nothing was deducted yet.`
        : `Send your transaction ID on Discord with order ${record.orderId}.`,
      type: 'success',
      duration: 6500
    });
  } catch (error) {
    console.error('[TKBD] order failed', error);
    toast({
      title: usingWallet ? 'Could not submit wallet order' : 'Could not save order',
      message: usingWallet
        ? 'Nothing was deducted. Check your connection and try again.'
        : 'Please try again or contact staff on Discord.',
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
    openCheckout(buy.dataset.buy).catch((error) => {
      console.error('[TKBD] Could not open checkout:', error);
      toast({
        title: 'Could not open checkout',
        message: 'Please try again in a moment.',
        type: 'error'
      });
    });
    return;
  }

  const method = event.target.closest('[data-method]');
  if (method && cart && !method.disabled) {
    document.querySelectorAll('.pay-method').forEach((node) => {
      node.classList.toggle('is-active', node === method);
    });
    renderPayPanel(method.dataset.method);
  }
});

/* Re-open checkout after a successful login */
onAuth(({ ready, user }) => {
  if (!ready) return;

  if (user) startWalletWatch(user);
  else stopWalletWatch();

  if (user && pendingItemId) {
    const itemId = pendingItemId;
    pendingItemId = null;
    setTimeout(() => {
      openCheckout(itemId).catch((error) => {
        console.error('[TKBD] Could not reopen checkout:', error);
      });
    }, 350);
  }
});
