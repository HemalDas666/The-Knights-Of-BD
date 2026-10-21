/* =========================================================================
   ADMIN DATA — verified-owner-only Firestore operations.
   -------------------------------------------------------------------------
   Every function here is a *server-verified* action: the client asks, the
   Firestore rules check that the caller is the verified owner, and the
   transaction moves the money. The console never fakes a success locally.
   ========================================================================= */

import { db } from './firebase.js';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

const MAX_ROWS = 300;

/* ----------------------------- watchers -------------------------------- */

function mapRows(snap) {
  return snap.docs.map((row) => ({ id: row.id, ...row.data() }));
}

function sortNewest(rows, field = 'createdAt') {
  return rows.sort((a, b) => (Number(b[field]) || 0) - (Number(a[field]) || 0));
}

export function watchAllTopups(callback, onError) {
  return onSnapshot(
    query(
      collection(db, 'topups'),
      orderBy('createdAt', 'desc'),
      limit(MAX_ROWS)
    ),
    (snap) => callback(sortNewest(mapRows(snap))),
    onError
  );
}

export function watchAllOrders(callback, onError) {
  return onSnapshot(
    query(
      collection(db, 'orders'),
      orderBy('createdAt', 'desc'),
      limit(MAX_ROWS)
    ),
    (snap) =>
      callback(
        sortNewest(
          mapRows(snap).map((row) => ({
            ...row,
            orderId: row.orderId || row.id
          }))
        )
      ),
    onError
  );
}

export function watchAllUsers(callback, onError) {
  return onSnapshot(
    query(collection(db, 'users'), limit(500)),
    (snap) =>
      callback(
        mapRows(snap).map((row) => ({
          ...row,
          uid: row.uid || row.id
        }))
      ),
    onError
  );
}

export function watchAllWallets(callback, onError) {
  return onSnapshot(
    query(collection(db, 'wallets'), limit(500)),
    (snap) =>
      callback(
        mapRows(snap).map((row) => ({
          ...row,
          uid: row.uid || row.id,
          balance: Math.max(0, Number(row.balance) || 0)
        }))
      ),
    onError
  );
}

export function watchAdminLogs(callback, onError) {
  return onSnapshot(
    query(
      collection(db, 'adminLogs'),
      orderBy('at', 'desc'),
      limit(80)
    ),
    (snap) => callback(sortNewest(mapRows(snap), 'at')),
    onError
  );
}

/* ------------------------------ helpers -------------------------------- */

function requirePending(snap, label) {
  if (!snap.exists()) throw new Error(`${label} no longer exists.`);
  if (snap.data().status !== 'pending') {
    throw new Error(`${label} has already been reviewed.`);
  }
}

function targetName(data) {
  return data.username || data.ign || data.email || 'Player';
}

function orderRefFor(order) {
  return doc(db, 'orders', order.orderId || order.id);
}

/* ------------------------------ top-ups -------------------------------- */

export async function approveTopup(topup, adminEmail) {
  const topupRef = doc(db, 'topups', topup.id);
  const walletRef = doc(db, 'wallets', topup.uid);
  const logRef = doc(collection(db, 'adminLogs'));

  return runTransaction(db, async (tx) => {
    const topupSnap = await tx.get(topupRef);
    requirePending(topupSnap, 'This top-up request');

    const data = topupSnap.data();
    const amount = Math.round(Number(data.amount) || 0);
    if (amount <= 0) throw new Error('This top-up has an invalid amount.');

    const walletSnap = await tx.get(walletRef);
    const current = walletSnap.exists()
      ? Math.max(0, Number(walletSnap.data().balance) || 0)
      : 0;

    tx.set(
      walletRef,
      {
        balance: current + amount,
        currency: 'BDT',
        updatedAt: Date.now(),
        updatedBy: adminEmail
      },
      { merge: true }
    );

    tx.update(topupRef, {
      status: 'approved',
      reviewedAt: Date.now(),
      reviewedBy: adminEmail,
      adminNote: ''
    });

    tx.set(logRef, {
      action: 'topup.approved',
      targetUid: data.uid,
      targetName: targetName(data),
      amount,
      requestId: topup.id,
      by: adminEmail,
      at: Date.now()
    });

    return { amount, balance: current + amount };
  });
}

export async function rejectTopup(topup, reason, adminEmail) {
  const topupRef = doc(db, 'topups', topup.id);
  const logRef = doc(collection(db, 'adminLogs'));

  return runTransaction(db, async (tx) => {
    const topupSnap = await tx.get(topupRef);
    requirePending(topupSnap, 'This top-up request');
    const data = topupSnap.data();

    tx.update(topupRef, {
      status: 'rejected',
      reviewedAt: Date.now(),
      reviewedBy: adminEmail,
      adminNote: String(reason || '').slice(0, 240)
    });

    tx.set(logRef, {
      action: 'topup.rejected',
      targetUid: data.uid,
      targetName: targetName(data),
      amount: Math.round(Number(data.amount) || 0),
      requestId: topup.id,
      reason: String(reason || '').slice(0, 240),
      by: adminEmail,
      at: Date.now()
    });
  });
}

/* ------------------------------- orders -------------------------------- */

export async function markOrderPaid(order, adminEmail) {
  const orderRef = orderRefFor(order);
  const logRef = doc(collection(db, 'adminLogs'));

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    requirePending(snap, 'This order');
    const data = snap.data();

    tx.update(orderRef, {
      status: 'paid',
      paidAt: Date.now(),
      reviewedBy: adminEmail
    });

    tx.set(logRef, {
      action: 'order.paid',
      targetUid: data.uid,
      targetName: targetName(data),
      amount: Math.round(Number(data.amount) || 0),
      itemName: data.itemName || '',
      orderId: order.orderId || order.id,
      method: data.method || '',
      by: adminEmail,
      at: Date.now()
    });
  });
}

export async function deductAndPayOrder(order, charge, adminEmail) {
  const orderRef = orderRefFor(order);
  const walletRef = doc(db, 'wallets', order.uid);
  const logRef = doc(collection(db, 'adminLogs'));
  const expected = Math.round(Number(charge) || 0);

  if (expected <= 0) throw new Error('This item does not have a valid price.');

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    requirePending(snap, 'This order');
    const data = snap.data();
    if (data.method !== 'wallet') {
      throw new Error('This order is not a wallet order.');
    }

    const walletSnap = await tx.get(walletRef);
    const balance = walletSnap.exists()
      ? Math.max(0, Number(walletSnap.data().balance) || 0)
      : 0;

    if (balance < expected) {
      throw new Error(
        `Player balance is too low. Wallet has ৳${balance.toLocaleString('en-BD')}, but this order needs ৳${expected.toLocaleString('en-BD')}.`
      );
    }

    tx.set(
      walletRef,
      {
        balance: balance - expected,
        currency: 'BDT',
        updatedAt: Date.now(),
        updatedBy: adminEmail
      },
      { merge: true }
    );

    tx.update(orderRef, {
      status: 'paid',
      amount: expected,
      walletCharged: expected,
      paidAt: Date.now(),
      reviewedBy: adminEmail
    });

    tx.set(logRef, {
      action: 'order.wallet_paid',
      targetUid: data.uid,
      targetName: targetName(data),
      amount: expected,
      itemName: data.itemName || '',
      orderId: order.orderId || order.id,
      by: adminEmail,
      at: Date.now()
    });

    return { charged: expected, balance: balance - expected };
  });
}

export async function markDelivered(order, adminEmail) {
  const orderRef = orderRefFor(order);
  const logRef = doc(collection(db, 'adminLogs'));

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('This order no longer exists.');
    const data = snap.data();
    if (data.status !== 'paid') {
      throw new Error('Only paid orders can be marked delivered.');
    }

    tx.update(orderRef, {
      status: 'delivered',
      deliveredAt: Date.now(),
      deliveredBy: adminEmail
    });

    tx.set(logRef, {
      action: 'order.delivered',
      targetUid: data.uid,
      targetName: targetName(data),
      amount: Math.round(Number(data.amount) || 0),
      itemName: data.itemName || '',
      orderId: order.orderId || order.id,
      by: adminEmail,
      at: Date.now()
    });
  });
}

export async function cancelOrder(order, adminEmail, { reason = '', refund = false } = {}) {
  const orderRef = orderRefFor(order);
  const walletRef = doc(db, 'wallets', order.uid);
  const logRef = doc(collection(db, 'adminLogs'));

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('This order no longer exists.');
    const data = snap.data();
    if (data.status === 'delivered') {
      throw new Error('Delivered orders cannot be cancelled.');
    }
    if (data.status === 'cancelled') {
      throw new Error('This order is already cancelled.');
    }

    const shouldRefund =
      Boolean(refund) && data.method === 'wallet' && data.status === 'paid';
    const refundAmount = Math.round(
      Number(data.walletCharged ?? data.amount) || 0
    );

    if (shouldRefund && refundAmount > 0) {
      const walletSnap = await tx.get(walletRef);
      const balance = walletSnap.exists()
        ? Math.max(0, Number(walletSnap.data().balance) || 0)
        : 0;

      tx.set(
        walletRef,
        {
          balance: balance + refundAmount,
          currency: 'BDT',
          updatedAt: Date.now(),
          updatedBy: adminEmail
        },
        { merge: true }
      );
    }

    tx.update(orderRef, {
      status: 'cancelled',
      cancelReason: String(reason || '').slice(0, 240),
      cancelledAt: Date.now(),
      reviewedBy: adminEmail,
      ...(shouldRefund ? { refundedAt: Date.now() } : {})
    });

    tx.set(logRef, {
      action: shouldRefund ? 'order.refunded' : 'order.cancelled',
      targetUid: data.uid,
      targetName: targetName(data),
      amount: shouldRefund ? refundAmount : Math.round(Number(data.amount) || 0),
      itemName: data.itemName || '',
      orderId: order.orderId || order.id,
      reason: String(reason || '').slice(0, 240),
      by: adminEmail,
      at: Date.now()
    });

    return { refunded: shouldRefund, amount: refundAmount };
  });
}

/* ----------------------------- balance --------------------------------- */

export async function adjustBalance(
  { uid, delta, reason = '', name = 'Player' },
  adminEmail
) {
  const walletRef = doc(db, 'wallets', uid);
  const logRef = doc(collection(db, 'adminLogs'));
  const change = Math.round(Number(delta) || 0);

  if (!uid) throw new Error('Missing player account.');
  if (!change) throw new Error('Enter an amount to add or remove.');

  return runTransaction(db, async (tx) => {
    const walletSnap = await tx.get(walletRef);
    const current = walletSnap.exists()
      ? Math.max(0, Number(walletSnap.data().balance) || 0)
      : 0;
    const next = current + change;

    if (next < 0) {
      throw new Error(
        `Cannot remove ৳${Math.abs(change).toLocaleString('en-BD')} — the player only has ৳${current.toLocaleString('en-BD')}.`
      );
    }

    tx.set(
      walletRef,
      {
        balance: next,
        currency: 'BDT',
        updatedAt: Date.now(),
        updatedBy: adminEmail
      },
      { merge: true }
    );

    tx.set(logRef, {
      action: 'wallet.adjust',
      targetUid: uid,
      targetName: name,
      delta: change,
      amount: Math.abs(change),
      reason: String(reason || '').slice(0, 240),
      by: adminEmail,
      at: Date.now()
    });

    return { balance: next };
  });
}

/* ------------------------------ errors --------------------------------- */

export function adminErrorMessage(error) {
  switch (error?.code) {
    case 'permission-denied':
      return 'Firestore denied the action. Publish the updated rules and make sure this admin email is verified.';
    case 'unauthenticated':
      return 'Your session expired. Sign in again.';
    case 'unavailable':
      return 'Network unavailable. Try again in a moment.';
    default:
      return error?.message || 'The action could not be completed.';
  }
}
