/* =========================================================================
   Firebase bootstrap (shared by every page).
   The web API key is public by design — security lives in Firestore rules.
   ========================================================================= */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAIUFhLZC21fM4-ouKpMWF1ByBtD5ix8KU',
  authDomain: 'the-knights-acc.firebaseapp.com',
  projectId: 'the-knights-acc',
  storageBucket: 'the-knights-acc.firebasestorage.app',
  messagingSenderId: '223979026951',
  appId: '1:223979026951:web:9f0e31cf6805e7ada588a2',
  measurementId: 'G-ZK5RGP712N'
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const AUTH_SDK = 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
export const STORE_SDK = 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
