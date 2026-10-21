/* =========================================================================
   Authentication — one module for the whole site.
   Handles register, login, logout, password reset, email verification,
   the nav user menu, and the auth dialogs (injected once per page).
   ========================================================================= */

import { auth } from './firebase.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  reload
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';

import { getProfile, saveProfile } from './data.js';
import { toast, openModal, closeModal, initModals, initPasswordToggles } from './ui.js';

/* ------------------------------- state -------------------------------- */

const state = {
  ready: false,
  user: null,
  profile: null
};

const listeners = new Set();
let initialized = false;
let pendingRegistration = null;

const FALLBACK_AVATAR =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="12" fill="#151a30"/>' +
      '<circle cx="32" cy="25" r="11" fill="#3a4166"/>' +
      '<path d="M12 60c2-13 10-19 20-19s18 6 20 19" fill="#3a4166"/>' +
    '</svg>'
  );

const AUTH_ERRORS = {
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/invalid-login-credentials': 'Email or password is incorrect.',
  'auth/wrong-password': 'Incorrect password.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/email-already-in-use': 'That email is already registered. Try logging in instead.',
  'auth/weak-password': 'Please choose a stronger password (8+ characters).',
  'auth/missing-password': 'Please enter your password.',
  'auth/too-many-requests': 'Too many attempts. Please wait a minute and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/operation-not-allowed': 'Email sign-in is disabled in the Firebase Console.',
  'auth/account-exists-with-different-credential':
    'This email already uses a different sign-in method.',
  'auth/requires-recent-login': 'Please log in again to continue.'
};

function friendlyError(error) {
  return AUTH_ERRORS[error?.code] || 'Something went wrong. Please try again.';
}

function displayNameFor(user, profile) {
  return (
    profile?.username ||
    user?.displayName ||
    (user?.email ? user.email.split('@')[0] : 'Knight')
  );
}

/* ------------------------- public accessors --------------------------- */

export function getUser() {
  return state.user;
}

export function getProfileData() {
  return state.profile;
}

export function publicAuthState() {
  return {
    ready: state.ready,
    user: state.user,
    profile: state.profile
  };
}

export function onAuth(callback) {
  listeners.add(callback);
  if (state.ready) callback(publicAuthState());
  return () => listeners.delete(callback);
}

export function waitForAuth() {
  if (state.ready) return Promise.resolve(publicAuthState());
  return new Promise((resolve) => {
    const handler = (snapshot) => {
      if (!snapshot.ready) return;
      listeners.delete(handler);
      resolve(snapshot);
    };
    listeners.add(handler);
  });
}

function emit() {
  const snapshot = publicAuthState();
  listeners.forEach((callback) => {
    try {
      callback(snapshot);
    } catch (error) {
      console.error('[TKBD] auth listener failed', error);
    }
  });
  window.dispatchEvent(new CustomEvent('kbd:auth', { detail: snapshot }));
}

/* ----------------------------- avatar --------------------------------- */

export function avatarUrlFor(ign) {
  const name = String(ign || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return FALLBACK_AVATAR;
  return `https://mc-heads.net/avatar/${encodeURIComponent(name)}/64`;
}

function applyAvatar(img, ign) {
  if (!img) return;
  img.onerror = () => {
    img.onerror = null;
    img.src = FALLBACK_AVATAR;
  };
  img.src = avatarUrlFor(ign);
}

/* --------------------------- nav rendering ---------------------------- */

function applyUserToDOM() {
  const user = state.user;
  const profile = state.profile;

  document.documentElement.dataset.authState = user ? 'user' : 'guest';

  document.querySelectorAll('[data-auth="guest"]').forEach((node) => {
    node.hidden = Boolean(user);
  });
  document.querySelectorAll('[data-auth="user"]').forEach((node) => {
    node.hidden = !user;
  });

  if (!user) return;

  const name = displayNameFor(user, profile);
  document.querySelectorAll('[data-user-name]').forEach((node) => {
    node.textContent = name;
  });
  document.querySelectorAll('[data-user-email]').forEach((node) => {
    node.textContent = user.email || '';
  });
  document.querySelectorAll('[data-user-avatar]').forEach((img) => {
    applyAvatar(img, profile?.ign);
  });

  document.querySelectorAll('[data-user-verified]').forEach((node) => {
    node.hidden = Boolean(user.emailVerified);
  });
}

/* --------------------------- auth dialogs ----------------------------- */

function injectAuthUI() {
  if (document.getElementById('authModal')) return;

  const modal = document.createElement('div');
  modal.id = 'authModal';
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'authTitle');
  modal.tabIndex = -1;

  modal.innerHTML = `
    <div class="modal__card modal__card--auth">
      <button type="button" class="modal__close" data-close-modal aria-label="Close">&times;</button>

      <header class="auth__head">
        <span class="auth__crest"><i class="fa-solid fa-shield-halved"></i></span>
        <h2 id="authTitle">Welcome, Knight</h2>
        <p>Log in to sync your profile, track orders and receive purchases.</p>
      </header>

      <div class="tabs" role="tablist" aria-label="Account access">
        <button type="button" class="tab is-active" role="tab" aria-selected="true" data-auth-tab="login">Login</button>
        <button type="button" class="tab" role="tab" aria-selected="false" data-auth-tab="register">Register</button>
      </div>

      <form class="auth__form is-active" data-auth-form="login" novalidate>
        <label class="field">
          <span class="field__label">Email address</span>
          <input type="email" name="email" autocomplete="email" placeholder="you@example.com" required>
        </label>
        <label class="field">
          <span class="field__label">Password</span>
          <span class="input-group">
            <input type="password" name="password" autocomplete="current-password" placeholder="Your password" required>
            <button type="button" class="input-group__btn" data-toggle-password aria-label="Show password"><i class="fa-solid fa-eye"></i></button>
          </span>
        </label>
        <p class="form-error" data-auth-error role="alert" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">
          <span class="btn__label">Login</span>
          <span class="btn__spinner" aria-hidden="true"></span>
        </button>
        <button type="button" class="link-btn" data-auth-jump="forgot">Forgot your password?</button>
      </form>

      <form class="auth__form" data-auth-form="register" novalidate>
        <div class="field-row">
          <label class="field">
            <span class="field__label">Username</span>
            <input type="text" name="username" autocomplete="username" placeholder="Slighter" maxlength="16" required>
          </label>
          <label class="field">
            <span class="field__label">Minecraft IGN</span>
            <input type="text" name="ign" autocomplete="off" placeholder="Slighter" maxlength="16" required>
          </label>
        </div>
        <label class="field">
          <span class="field__label">Email address</span>
          <input type="email" name="email" autocomplete="email" placeholder="you@example.com" required>
        </label>
        <div class="field-row">
          <label class="field">
            <span class="field__label">Password</span>
            <span class="input-group">
              <input type="password" name="password" autocomplete="new-password" placeholder="8+ characters" minlength="8" required>
              <button type="button" class="input-group__btn" data-toggle-password aria-label="Show password"><i class="fa-solid fa-eye"></i></button>
            </span>
          </label>
          <label class="field">
            <span class="field__label">Confirm password</span>
            <input type="password" name="confirm" autocomplete="new-password" placeholder="Repeat it" required>
          </label>
        </div>
        <p class="form-error" data-auth-error role="alert" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">
          <span class="btn__label">Create account</span>
          <span class="btn__spinner" aria-hidden="true"></span>
        </button>
        <p class="auth__legal">Your IGN is where purchases are delivered. Double-check it — staff cannot refund a rank sent to the wrong player.</p>
      </form>

      <form class="auth__form" data-auth-form="forgot" novalidate>
        <p class="auth__hint">Enter the email you registered with and we will send a reset link.</p>
        <label class="field">
          <span class="field__label">Email address</span>
          <input type="email" name="email" autocomplete="email" placeholder="you@example.com" required>
        </label>
        <p class="form-error" data-auth-error role="alert" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">
          <span class="btn__label">Send reset link</span>
          <span class="btn__spinner" aria-hidden="true"></span>
        </button>
        <button type="button" class="link-btn" data-auth-jump="login">Back to login</button>
      </form>
    </div>
  `;

  const logoutModal = document.createElement('div');
  logoutModal.id = 'logoutModal';
  logoutModal.className = 'modal';
  logoutModal.setAttribute('role', 'dialog');
  logoutModal.setAttribute('aria-modal', 'true');
  logoutModal.setAttribute('aria-labelledby', 'logoutTitle');
  logoutModal.tabIndex = -1;
  logoutModal.innerHTML = `
    <div class="modal__card modal__card--small">
      <button type="button" class="modal__close" data-close-modal aria-label="Close">&times;</button>
      <h2 id="logoutTitle" class="confirm__title">Log out?</h2>
      <p class="confirm__text">You will need to log in again to view orders and buy from the store.</p>
      <div class="confirm__actions">
        <button type="button" class="btn btn-ghost" data-close-modal>Stay logged in</button>
        <button type="button" class="btn btn-danger" id="confirmLogout">
          <span class="btn__label">Log out</span>
          <span class="btn__spinner" aria-hidden="true"></span>
        </button>
      </div>
    </div>
  `;

  document.body.append(modal, logoutModal);
}

/* ------------------------------ helpers ------------------------------- */

function setBusy(form, busy) {
  form.dataset.busy = busy ? 'true' : 'false';
  const button = form.querySelector('[type="submit"]');
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
}

function showError(form, message) {
  const box = form.querySelector('[data-auth-error]');
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

function clearError(form) {
  const box = form.querySelector('[data-auth-error]');
  if (!box) return;
  box.textContent = '';
  box.hidden = true;
}

function switchTab(name) {
  document.querySelectorAll('[data-auth-tab]').forEach((tab) => {
    const active = tab.dataset.authTab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-auth-form]').forEach((form) => {
    form.classList.toggle('is-active', form.dataset.authForm === name);
  });
  const activeForm = document.querySelector(`[data-auth-form="${name}"]`);
  if (activeForm) {
    activeForm.querySelectorAll('.form-error').forEach((box) => {
      box.hidden = true;
    });
  }
}

function validMinecraftName(value) {
  return /^[A-Za-z0-9_]{3,16}$/.test(value);
}

/* ------------------------------ actions ------------------------------- */

export async function logout() {
  const button = document.getElementById('confirmLogout');
  if (button) {
    button.disabled = true;
    button.classList.add('is-busy');
  }
  try {
    await signOut(auth);
    closeModal('logoutModal');
    toast({ title: 'Logged out', message: 'See you on the server, Knight.', type: 'info' });
  } catch (error) {
    toast({ title: 'Could not log out', message: friendlyError(error), type: 'error' });
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('is-busy');
    }
  }
}

export async function resendVerification() {
  if (!auth.currentUser) return false;
  try {
    await sendEmailVerification(auth.currentUser);
    toast({ title: 'Verification sent', message: `Check ${auth.currentUser.email}.`, type: 'success' });
    return true;
  } catch (error) {
    toast({ title: 'Could not send email', message: friendlyError(error), type: 'error' });
    return false;
  }
}

export async function refreshVerification() {
  if (!auth.currentUser) return false;
  await reload(auth.currentUser);
  state.user = auth.currentUser;
  applyUserToDOM();
  emit();
  return auth.currentUser.emailVerified;
}

export async function sendPasswordResetToCurrent() {
  const email = auth.currentUser?.email;
  if (!email) throw new Error('Not signed in');
  await sendPasswordResetEmail(auth, email);
  return true;
}

export async function updateUsername(username) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const clean = String(username || '').trim();
  if (!/^[A-Za-z0-9_ ]{3,20}$/.test(clean)) {
    throw new Error('Username must be 3–20 characters (letters, numbers, spaces, underscore).');
  }
  await updateProfile(user, { displayName: clean });
  state.profile = await saveProfile(user.uid, { username: clean });
  applyUserToDOM();
  emit();
  return state.profile;
}

export async function updateIgn(ign) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const clean = String(ign || '').trim();
  if (!validMinecraftName(clean)) {
    throw new Error('That is not a valid Minecraft username (3–16 letters, numbers or underscore).');
  }
  state.profile = await saveProfile(user.uid, { ign: clean });
  applyUserToDOM();
  emit();
  return state.profile;
}

/* ------------------------------- wiring ------------------------------- */

function bindTabs() {
  document.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-auth-tab]');
    if (tab) {
      switchTab(tab.dataset.authTab);
      return;
    }
    const jump = event.target.closest('[data-auth-jump]');
    if (jump) {
      switchTab(jump.dataset.authJump);
    }
  });
}

function bindForms() {
  const loginForm = document.querySelector('[data-auth-form="login"]');
  const registerForm = document.querySelector('[data-auth-form="register"]');
  const forgotForm = document.querySelector('[data-auth-form="forgot"]');

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (loginForm.dataset.busy === 'true') return;
    clearError(loginForm);

    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;

    if (!email || !password) {
      showError(loginForm, 'Enter your email and password.');
      return;
    }

    setBusy(loginForm, true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      loginForm.reset();
      closeModal('authModal');
      toast({ title: 'Welcome back', message: 'You are logged in.', type: 'success' });
    } catch (error) {
      showError(loginForm, friendlyError(error));
    } finally {
      setBusy(loginForm, false);
    }
  });

  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (registerForm.dataset.busy === 'true') return;
    clearError(registerForm);

    const username = registerForm.username.value.trim();
    const ign = registerForm.ign.value.trim();
    const email = registerForm.email.value.trim();
    const password = registerForm.password.value;
    const confirm = registerForm.confirm.value;

    if (!username || !ign || !email || !password) {
      showError(registerForm, 'Please fill in every field.');
      return;
    }
    if (!/^[A-Za-z0-9_ ]{3,20}$/.test(username)) {
      showError(registerForm, 'Username must be 3–20 characters (letters, numbers, spaces, underscore).');
      return;
    }
    if (!validMinecraftName(ign)) {
      showError(registerForm, 'IGN must be 3–16 characters — letters, numbers or underscore only.');
      return;
    }
    if (password.length < 8) {
      showError(registerForm, 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      showError(registerForm, 'Passwords do not match.');
      return;
    }

    setBusy(registerForm, true);
    pendingRegistration = { email };

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: username });

      const profile = await saveProfile(credential.user.uid, {
        username,
        ign,
        email,
        createdAt: Date.now()
      });

      state.user = credential.user;
      state.profile = profile;
      state.ready = true;
      applyUserToDOM();
      emit();

      sendEmailVerification(credential.user).catch(() => {});

      registerForm.reset();
      closeModal('authModal');
      toast({
        title: 'Account created',
        message: `Welcome, ${username}! We sent a verification link to ${email}.`,
        type: 'success',
        duration: 6000
      });
    } catch (error) {
      showError(registerForm, friendlyError(error));
    } finally {
      pendingRegistration = null;
      setBusy(registerForm, false);
    }
  });

  forgotForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (forgotForm.dataset.busy === 'true') return;
    clearError(forgotForm);

    const email = forgotForm.email.value.trim();
    if (!email) {
      showError(forgotForm, 'Enter the email you registered with.');
      return;
    }

    setBusy(forgotForm, true);
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') {
        showError(forgotForm, friendlyError(error));
        setBusy(forgotForm, false);
        return;
      }
    }
    setBusy(forgotForm, false);
    forgotForm.reset();
    closeModal('authModal');
    toast({
      title: 'Reset link sent',
      message: `If ${email} has an account, a reset link is on its way.`,
      type: 'success',
      duration: 6000
    });
  });
}

function bindNav() {
  document.addEventListener('click', (event) => {
    const chip = event.target.closest('#userChip');
    const menu = document.querySelector('.user-menu');

    if (chip && menu) {
      const open = menu.classList.toggle('is-open');
      chip.setAttribute('aria-expanded', String(open));
      return;
    }

    if (menu && !event.target.closest('.user-menu')) {
      menu.classList.remove('is-open');
      document.getElementById('userChip')?.setAttribute('aria-expanded', 'false');
    }

    if (event.target.closest('[data-logout]')) {
      menu?.classList.remove('is-open');
      openModal('logoutModal');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelector('.user-menu')?.classList.remove('is-open');
  });

  document.getElementById('confirmLogout')?.addEventListener('click', logout);
}

function listen() {
  onAuthStateChanged(auth, async (user) => {
    if (user && pendingRegistration && user.email === pendingRegistration.email) {
      /* Registration flow applies state itself once the profile is written. */
      return;
    }

    if (!user) {
      state.user = null;
      state.profile = null;
      state.ready = true;
      applyUserToDOM();
      emit();
      return;
    }

    const profile = await getProfile(user.uid);
    if (!state.user || state.user.uid !== user.uid) {
      state.user = user;
    }
    state.profile = profile;
    state.ready = true;
    applyUserToDOM();
    emit();
  });
}

/* ------------------------------ bootstrap ----------------------------- */

export function initAuth() {
  if (initialized) return;
  initialized = true;

  initModals();
  initPasswordToggles();
  injectAuthUI();
  bindTabs();
  bindForms();
  bindNav();
  listen();
}
