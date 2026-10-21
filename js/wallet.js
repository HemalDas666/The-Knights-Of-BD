/* =========================================================================
   WALLET — player store credit and top-up requests.
   -------------------------------------------------------------------------
   A wallet is a Firestore document: wallets/{uid} { balance, updatedAt }.
   A top-up is a request: topups/{id} { status: 'pending' | ... }.

   Players may READ their own wallet and top-up requests. They may CREATE a
   pending top-up request. Only the verified admin account may move money.
   Firestore rules enforce every part of that.
   ========================================================================= */

import { db } from './firebase.js';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  setDoc,
  where
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { ADMIN, WALLET } from './config.js';

/* ----------------------------- identity -------------------------------- */

export function isAdminEmail(user) {
  return Boolean(
    user?.email &&
      String(user.email).toLowerCase() === ADMIN.email.toLowerCase()
  );
}

export function isAdminUser(user) {
  return isAdminEmail(user) && Boolean(user?.emailVerified);
}

/* ------------------------------ wallet --------------------------------- */

export function emptyWallet() {
  return { id: null, balance: 0, updatedAt: 0, exists: false };
}

function walletFromSnap(snap) {
  if (!snap.exists()) return emptyWallet();
  const data = snap.data() || {};
  return {
    id: snap.id,
    ...data,
    balance: Math.max(0, Number(data.balance) || 0),
    exists: true
  };
}

export async function getWallet(uid) {
  if (!uid) return emptyWallet();
  const snap = await getDoc(doc(db, 'wallets', uid));
  return walletFromSnap(snap);
}

export function watchWallet(uid, callback, onError) {
  if (!uid) {
    callback(emptyWallet());
    return () => {};
  }

  return onSnapshot(
    doc(db, 'wallets', uid),
    (snap) => callback(walletFromSnap(snap)),
    (error) => {
      console.warn('[TKBD] Wallet listener failed:', error?.code || error);
      onError?.(error);
    }
  );
}

/* ------------------------------ top-ups -------------------------------- */

export function makeTopupId() {
  const time = Date.now().toString(36).toUpperCase().slice(-7);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TOP-${time}-${rand}`;
}

export function validateTopup({ amount, method, senderNumber, txnId }) {
  const errors = {};
  const numeric = Number(amount);

  if (!Number.isInteger(numeric) || numeric < WALLET.minTopup) {
    errors.amount = `Minimum top-up is ৳${WALLET.minTopup}.`;
  } else if (numeric > WALLET.maxTopup) {
    errors.amount = `Maximum top-up is ৳${WALLET.maxTopup.toLocaleString('en-BD')}.`;
  }

  if (!['bkash', 'nagad'].includes(method)) {
    errors.method = 'Choose bKash or Nagad.';
  }

  const sender = String(senderNumber || '').replace(/[\s-]/g, '');
  if (!/^01[3-9]\d{8}$/.test(sender)) {
    errors.senderNumber = 'Enter the 11-digit Bangladeshi number you sent from.';
  }

  const txn = String(txnId || '').trim();
  if (txn.length < 6 || txn.length > 40 || !/^[A-Za-z0-9._-]+$/.test(txn)) {
    errors.txnId = 'Enter the transaction ID from your bKash/Nagad receipt.';
  }

  return { ok: Object.keys(errors).length === 0, errors, amount: numeric, sender, txn };
}

export async function createTopup({
  uid,
  email,
  username,
  ign,
  amount,
  method,
  senderNumber,
  txnId,
  note = ''
}) {
  if (!uid) throw new Error('You need to be logged in to top up.');

  const check = validateTopup({ amount, method, senderNumber, txnId });
  if (!check.ok) {
    const error = new Error('Please check the top-up details.');
    error.fieldErrors = check.errors;
    throw error;
  }

  const id = makeTopupId();
  const record = {
    requestId: id,
    uid,
    email: String(email || ''),
    username: String(username || ''),
    ign: String(ign || ''),
    amount: check.amount,
    currency: 'BDT',
    method,
    senderNumber: check.sender,
    txnId: check.txn,
    note: String(note || '').slice(0, 160),
    status: 'pending',
    createdAt: Date.now()
  };

  await setDoc(doc(db, 'topups', id), record);
  return { id, ...record };
}

export function watchTopups(uid, callback, onError) {
  if (!uid) {
    callback([]);
    return () => {};
  }

  const topupQuery = query(
    collection(db, 'topups'),
    where('uid', '==', uid),
    limit(60)
  );

  return onSnapshot(
    topupQuery,
    (snap) => {
      const rows = snap.docs
        .map((row) => ({ id: row.id, ...row.data() }))
        .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      callback(rows);
    },
    (error) => {
      console.warn('[TKBD] Top-up listener failed:', error?.code || error);
      onError?.(error);
    }
  );
}

/* ------------------------------ errors --------------------------------- */

export function walletErrorMessage(error) {
  switch (error?.code) {
    case 'permission-denied':
      return 'Top-ups are temporarily unavailable. Please try again later or ask staff on Discord.';
    case 'unavailable':
      return 'Network unavailable. Check your connection and try again.';
    case 'resource-exhausted':
      return 'Too many requests. Please wait a moment and try again.';
    case 'unauthenticated':
      return 'Your session expired. Log in again.';
    default:
      return error?.message || 'Something went wrong. Please try again.';
  }
}
