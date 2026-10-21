/* =========================================================================
   Data layer — profiles and orders.
   Tries Firestore first, always mirrors to localStorage so the UI is instant
   and still works if Firestore is not enabled or the network is down.
   ========================================================================= */

import { db } from './firebase.js';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

const profileKey = (uid) => `kbd:profile:${uid}`;
const ordersKey = (uid) => `kbd:orders:${uid}`;

let cloudOk = true;

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / private mode — ignore */
  }
}

export function isCloudAvailable() {
  return cloudOk;
}

export function cloudStatusLabel() {
  return cloudOk ? 'Cloud sync active' : 'Local mode';
}

/* ------------------------------ profiles ------------------------------ */

export async function saveProfile(uid, patch) {
  const merged = {
    ...readLocal(profileKey(uid), {}),
    ...patch,
    updatedAt: Date.now()
  };
  writeLocal(profileKey(uid), merged);

  try {
    await setDoc(
      doc(db, 'users', uid),
      { ...patch, updatedAt: Date.now() },
      { merge: true }
    );
    cloudOk = true;
  } catch (error) {
    cloudOk = false;
    console.warn('[TKBD] Profile saved locally — Firestore unavailable:', error?.code || error);
  }

  return merged;
}

export async function getProfile(uid) {
  const local = readLocal(profileKey(uid), {});

  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      const merged = { ...local, ...snap.data() };
      writeLocal(profileKey(uid), merged);
      cloudOk = true;
      return merged;
    }
    cloudOk = true;
  } catch (error) {
    cloudOk = false;
    console.warn('[TKBD] Profile read fell back to local:', error?.code || error);
  }

  return local;
}

/* ------------------------------- orders ------------------------------- */

export async function saveOrder(order) {
  const record = { ...order, createdAt: order.createdAt || Date.now() };

  const local = readLocal(ordersKey(order.uid), []);
  const next = [record, ...local.filter((row) => row.orderId !== record.orderId)];
  writeLocal(ordersKey(order.uid), next);

  try {
    await setDoc(doc(db, 'orders', order.orderId), record);
    cloudOk = true;
  } catch (error) {
    cloudOk = false;
    console.warn('[TKBD] Order saved locally — Firestore unavailable:', error?.code || error);
  }

  return record;
}

export async function getOrders(uid) {
  const local = readLocal(ordersKey(uid), []);

  try {
    const snap = await getDocs(
      query(collection(db, 'orders'), where('uid', '==', uid))
    );

    const merged = new Map();
    local.forEach((row) => merged.set(row.orderId, row));
    snap.docs.forEach((row) => merged.set(row.id, { ...row.data(), orderId: row.data().orderId || row.id }));

    const sorted = [...merged.values()].sort(
      (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
    );

    writeLocal(ordersKey(uid), sorted);
    cloudOk = true;
    return sorted;
  } catch (error) {
    cloudOk = false;
    console.warn('[TKBD] Orders read fell back to local:', error?.code || error);
  }

  return local.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
