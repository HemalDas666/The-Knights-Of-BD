/* =========================================================================
   THE KNIGHTS OF BD — SINGLE SOURCE OF TRUTH
   -------------------------------------------------------------------------
   Change server IPs, prices, Discord, payment numbers and FX fallbacks HERE.
   Every page reads from this file. No prices are hard-coded in the HTML.
   ========================================================================= */

export const SITE = {
  name: 'The Knights Of BD',
  short: 'TKBD',
  tagline: 'Claim glory. Steal hearts. Survive the void.',
  year: 2026,
  owner: 'Hemal Das',
  discord: 'https://discord.gg/GU9426EpBM',

  /* Put a support address here if you want one shown in the footer. */
  supportEmail: ''
};

/* ============================== ADMIN =================================
   The only account allowed into the private console. Access is enforced
   by Firebase Auth + Firestore rules — not by hiding the URL.
   ====================================================================== */

export const ADMIN = {
  email: 'dashemal08@gmail.com',
  label: 'Owner'
};

/* ============================== WALLET ================================
   Store credit is denominated in BDT, like every other price on the site.
   Players request a top-up; staff verify and credit it manually.
   ====================================================================== */

export const WALLET = {
  minTopup: 10,
  maxTopup: 50000,
  presets: [100, 250, 500, 1000, 2500, 5000]
};

export const SERVER = {
  primary: {
    label: 'Primary Address',
    host: 'synapse.veltrionhost.com',
    port: 25568,
    ip: 'synapse.veltrionhost.com:25568'
  },
  alternate: {
    label: 'Alternate Address',
    host: 'knightsbd.mine.bz',
    port: 25568,
    ip: 'knightsbd.mine.bz:25568'
  },
  edition: 'Java Edition',
  versions: '1.8 – 1.21.x',
  region: 'Asia',
  statusRefreshMs: 60000,
  statusCacheMs: 45000
};

/* =========================== STORE CATALOG ==============================
   All prices are BDT (৳) and are the only prices charged.
   Edit a number here and it updates the store, checkout and orders.
   ======================================================================= */

export const CATEGORIES = [
  {
    id: 'coins',
    title: 'Server Coins',
    icon: 'fa-solid fa-coins',
    blurb: 'Top up your balance and spend it in-game on kits, keys and perks.'
  },
  {
    id: 'vouchers',
    title: 'Money Vouchers',
    icon: 'fa-solid fa-money-bill-wave',
    blurb: 'Instant in-game cash, delivered by staff after payment.'
  },
  {
    id: 'ranks',
    title: 'Server Ranks',
    icon: 'fa-solid fa-crown',
    blurb: 'Permanent upgrades with commands, kits, cosmetics and priority queue.'
  }
];

export const ITEMS = [
  /* ---------------- Coins ---------------- */
  { id: 'coins-50',   cat: 'coins', kind: 'coins', name: '50 Coins',   price: 20,  big: '50',   unit: 'Coins' },
  { id: 'coins-100',  cat: 'coins', kind: 'coins', name: '100 Coins',  price: 35,  big: '100',  unit: 'Coins', badge: 'Best Seller' },
  { id: 'coins-200',  cat: 'coins', kind: 'coins', name: '200 Coins',  price: 65,  big: '200',  unit: 'Coins' },
  { id: 'coins-300',  cat: 'coins', kind: 'coins', name: '300 Coins',  price: 90,  big: '300',  unit: 'Coins' },
  { id: 'coins-500',  cat: 'coins', kind: 'coins', name: '500 Coins',  price: 140, big: '500',  unit: 'Coins' },
  { id: 'coins-1000', cat: 'coins', kind: 'coins', name: '1000 Coins', price: 250, big: '1000', unit: 'Coins', badge: 'Best Value' },

  /* -------------- Money Vouchers ---------- */
  { id: 'money-10k',   cat: 'vouchers', kind: 'voucher', name: '10K Money',   price: 25,   big: '10K',   unit: 'Money' },
  { id: 'money-50k',   cat: 'vouchers', kind: 'voucher', name: '50K Money',   price: 70,   big: '50K',   unit: 'Money' },
  { id: 'money-100k',  cat: 'vouchers', kind: 'voucher', name: '100K Money',  price: 120,  big: '100K',  unit: 'Money', badge: 'Popular' },
  { id: 'money-200k',  cat: 'vouchers', kind: 'voucher', name: '200K Money',  price: 200,  big: '200K',  unit: 'Money' },
  { id: 'money-500k',  cat: 'vouchers', kind: 'voucher', name: '500K Money',  price: 420,  big: '500K',  unit: 'Money' },
  { id: 'money-1m',    cat: 'vouchers', kind: 'voucher', name: '1M Money',    price: 700,  big: '1M',    unit: 'Money' },
  { id: 'money-10m',   cat: 'vouchers', kind: 'voucher', name: '10M Money',   price: 2500, big: '10M',   unit: 'Money' },
  { id: 'money-100m',  cat: 'vouchers', kind: 'voucher', name: '100M Money',  price: 8000, big: '100M',  unit: 'Money' },

  /* ---------------- Ranks ----------------- */
  { id: 'rank-baron',  cat: 'ranks', kind: 'rank', name: 'Baron Rank',  price: 150,  tier: 'baron',  icon: 'fa-solid fa-chess-rook',
    perks: ['Coloured chat name', '2 extra homes', '/nick access'] },
  { id: 'rank-duke',   cat: 'ranks', kind: 'rank', name: 'Duke Rank',   price: 250,  tier: 'duke',   icon: 'fa-solid fa-chess-queen',
    perks: ['Everything in Baron', '4 extra homes', 'Weekly kit'] },
  { id: 'rank-lord',   cat: 'ranks', kind: 'rank', name: 'Lord Rank',   price: 450,  tier: 'lord',   icon: 'fa-solid fa-crown',
    perks: ['Everything in Duke', '6 extra homes', '/fly in lobby'] },
  { id: 'rank-prince', cat: 'ranks', kind: 'rank', name: 'Prince Rank', price: 650,  tier: 'prince', icon: 'fa-solid fa-gem',
    perks: ['Everything in Lord', '8 extra homes', 'Priority queue'] },
  { id: 'rank-king',   cat: 'ranks', kind: 'rank', name: 'King Rank',   price: 1000, tier: 'king',   icon: 'fa-solid fa-crown',
    perks: ['Everything in Prince', '10 extra homes', 'Custom prefix'] },
  { id: 'rank-knight', cat: 'ranks', kind: 'rank', name: 'Knight Rank', price: 1500, tier: 'knight', icon: 'fa-solid fa-shield-halved',
    badge: 'Top Tier', perks: ['Every perk we offer', 'Unlimited homes', 'Direct staff line'] }
];

export const PAYMENTS = [
  {
    id: 'bkash',
    name: 'bKash',
    number: '01765980414',
    icon: 'fa-solid fa-mobile-screen-button',
    step: 'Send Money'
  },
  {
    id: 'nagad',
    name: 'Nagad',
    number: '01314726844',
    icon: 'fa-solid fa-mobile-screen-button',
    step: 'Send Money'
  }
];

/* ======================= CURRENCY CONVERTER ============================
   Live rates come from open.er-api.com (free, no key).
   The fallback values are used if that request fails.
   ====================================================================== */

export const FX = {
  endpoint: 'https://open.er-api.com/v6/latest/BDT',
  ttlMs: 6 * 60 * 60 * 1000,
  cacheKey: 'kbd:fx:v1',
  currencies: [
    { code: 'USD', label: 'US Dollar', symbol: '$' },
    { code: 'INR', label: 'Indian Rupee', symbol: '₹' },
    { code: 'EUR', label: 'Euro', symbol: '€' },
    { code: 'GBP', label: 'British Pound', symbol: '£' },
    { code: 'MYR', label: 'Malaysian Ringgit', symbol: 'RM' },
    { code: 'SAR', label: 'Saudi Riyal', symbol: 'SAR' },
    { code: 'AED', label: 'UAE Dirham', symbol: 'AED' }
  ],
  fallback: {
    USD: 0.0082,
    INR: 0.699,
    EUR: 0.0075,
    GBP: 0.0064,
    MYR: 0.036,
    SAR: 0.031,
    AED: 0.030
  }
};

/* ============================ HELPERS ================================= */

export function itemById(id) {
  return ITEMS.find((item) => item.id === id) || null;
}

export function itemsByCategory(cat) {
  return ITEMS.filter((item) => item.cat === cat);
}

export function formatBDT(value) {
  const n = Number(value) || 0;
  return '৳' + n.toLocaleString('en-BD', { maximumFractionDigits: 0 });
}

export function getIP(address = SERVER.primary) {
  return address.ip || `${address.host}:${address.port}`;
}
