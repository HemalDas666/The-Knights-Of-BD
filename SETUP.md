# The Knights Of BD — Setup & Maintenance

A static website (plain HTML + CSS + JavaScript modules) with a private staff console.
There is **no build step** — the folder can be uploaded/deployed exactly as it is.

---

## 1. What is in the site

| Path | Page |
| --- | --- |
| `/` | Home — hero, live status, members, features |
| `/store/` | Store — ranks, coins, vouchers, BDT converter, bKash/Nagad/wallet checkout |
| `/account/` | Account — profile, email verification, wallet, top-up requests, order history |
| `/status/` | Live server status for both IPs + connection guide |
| `/rules/` | Server rules and punishments |
| `/admin/` | **Private staff console** — unlinked and `noindex,nofollow` |

Shared code lives in `js/` and `css/`. Each page folder contains its own `index.html`
(and `script.js` where needed), so every URL is clean and GitHub-Pages friendly.

### Files you will actually edit

| What | Where |
| --- | --- |
| Server IPs, ports, Java version text | `js/config.js` → `SERVER` |
| Discord invite | `js/config.js` → `SITE.discord` |
| Every store price, item name, rank perk | `js/config.js` → `ITEMS`, `CATEGORIES` |
| bKash / Nagad numbers | `js/config.js` → `PAYMENTS` |
| Top-up limits and quick amounts | `js/config.js` → `WALLET` |
| Admin account email | `js/config.js` → `ADMIN.email` **and** the Firestore rules |
| Converter fallback rates | `js/config.js` → `FX.fallback` |
| Site name, owner, support email | `js/config.js` → `SITE` |
| Rules text | `rules/index.html` |
| Staff / member cards | `index.html` → `#members` |
| Colours, fonts, spacing | `css/base.css` → `:root` |
| Logo / favicon | `assets/KnightLOGO11.png`, `assets/KnightLOGO9.png` |

> **Prices are defined once, in `js/config.js`.** The HTML contains no hard-coded prices.
> Edit a number there and the store, checkout, wallet approvals and order records all
> use the same value.

### Admin and wallet modules

| File | Responsibility |
| --- | --- |
| `admin/index.html` | Login / verification gates, dashboard, queues, player modal |
| `admin/script.js` | Auth gate, live data wiring, rendering, confirmations, actions |
| `css/admin.css` | Console design, animations, mobile bottom navigation |
| `js/admin-data.js` | Real-time watchers and all transactional admin operations |
| `js/wallet.js` | Wallet reads, top-up creation/validation, player-facing errors |

---

## 2. Preview locally

ES modules and Firebase do **not** work when a file is opened with `file://`. Use a small local server:

```powershell
cd "C:\Users\dashe\Desktop\The Knights Of BD"
npx serve .
```

Then open the printed URL (usually `http://localhost:3000`). Any static server works
(VS Code Live Server, Python `http.server`, etc.).

> `127.0.0.1` / `localhost` are already authorised in Firebase by default. No extra setup is needed for local testing.

---

## 3. Deploy to GitHub Pages

The repository is `HemalDas666/The-Knights-Of-BD`, deployed at
`https://hemaldas666.github.io/The-Knights-Of-BD/`.

1. Commit and push everything:
   ```powershell
   git add -A
   git commit -m "Add wallet, top-ups and private admin console"
   git push origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: **main**, folder: **/ (root)**
   - Save.
3. Wait for the green deployment check. The site will be at:
   `https://hemaldas666.github.io/The-Knights-Of-BD/`

The admin console is at `/admin/`. It is intentionally not linked from the public pages,
but **that is not what protects it** — Firebase Auth and the Firestore rules do.

If you use a custom domain, add it under **Settings → Pages → Custom domain** and follow
GitHub's DNS instructions. A custom domain also has to be added to Firebase (next section).

> After deploying, do a hard refresh (`Ctrl + F5`) once so browsers do not keep old cached CSS/JS.

---

## 4. Firebase setup (required for accounts, wallet and the admin console)

The project is already connected: **`the-knights-acc`** (config in `js/firebase.js`).
The web API key there is public by design — security is enforced by Firestore rules.

### 4.1 Enable Email/Password sign-in

1. Firebase Console → **Authentication → Sign-in method**
2. Enable **Email/Password** (not “Email link”).
3. Save.

### 4.2 Create the admin account

The only admin email is **`dashemal08@gmail.com`**, set in two places:

- `js/config.js` → `ADMIN.email`
- the `isAdmin()` function in the Firestore rules below

Create the account **with that exact email**:

1. On the live site, open **Login → Create account** and register `dashemal08@gmail.com`
   with a strong, unique password. (Or add the user in Firebase Console; the email must
   still be verified.)
2. Open the verification email from Firebase and click the link.
3. Sign out and back in, then open `/admin/`.

The admin gate requires **both** the matching email **and** `emailVerified == true`.
An unverified account stays on the “verify your email” screen. If you verified while the
tab was open, use the reload button on that screen or sign out/in so Firebase refreshes
the token.

> Only change the admin email if you also update the email inside the published rules.
> If the two do not match, `/admin/` shows **Access denied** and all admin reads fail.

### 4.3 Publish the Firestore rules

1. Firebase Console → **Build → Firestore Database**. If a database already exists,
   skip to the **Rules** tab; otherwise choose **Create database**.
2. If creating: choose **Production mode**, then location **`asia-south1` (Mumbai)** —
   the closest region to Bangladesh. This cannot be changed later.
3. Open the **Rules** tab, replace everything with the block below, and press **Publish**:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null;
    }

    function isOwner(uid) {
      return signedIn() && request.auth.uid == uid;
    }

    // Only the verified admin email may touch money, orders or audit logs.
    function isAdmin() {
      return signedIn()
        && request.auth.token.email == 'dashemal08@gmail.com'
        && request.auth.token.email_verified == true;
    }

    // Profiles: a player owns their document. Staff can read every profile.
    match /users/{uid} {
      allow read: if isOwner(uid) || isAdmin();
      allow create, update: if isOwner(uid);
      allow delete: if false;
    }

    // Players may create their own pending order. Only staff may change it.
    // The admin UI re-checks the catalog price before moving any money, so a
    // tampered `amount` is flagged rather than trusted.
    match /orders/{orderId} {
      allow create: if signedIn()
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.orderId == orderId
        && request.resource.data.status == 'pending'
        && request.resource.data.currency == 'BDT'
        && request.resource.data.method in ['bkash', 'nagad', 'wallet']
        && request.resource.data.amount is number
        && request.resource.data.amount > 0
        && request.resource.data.createdAt is number;

      allow read: if isAdmin()
        || (signedIn() && resource.data.uid == request.auth.uid);

      allow update: if isAdmin();
      allow delete: if false;
    }

    // Wallet balances are read by their owner and written only by staff
    // through the transactional admin console.
    match /wallets/{uid} {
      allow read: if isOwner(uid) || isAdmin();

      allow create, update: if isAdmin()
        && request.resource.data.balance is number
        && request.resource.data.balance >= 0;

      allow delete: if false;
    }

    // Players submit a pending top-up request with the sender number and
    // transaction ID. Staff verify the payment, then approve or reject it.
    match /topups/{topupId} {
      allow read: if isAdmin()
        || (signedIn() && resource.data.uid == request.auth.uid);

      allow create: if signedIn()
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.requestId == topupId
        && request.resource.data.status == 'pending'
        && request.resource.data.currency == 'BDT'
        && request.resource.data.method in ['bkash', 'nagad']
        && request.resource.data.amount is int
        && request.resource.data.amount >= 10
        && request.resource.data.amount <= 50000
        && request.resource.data.senderNumber is string
        && request.resource.data.senderNumber.matches('^01[3-9][0-9]{8}$')
        && request.resource.data.txnId is string
        && request.resource.data.txnId.matches('^[A-Za-z0-9._-]{6,40}$')
        && request.resource.data.createdAt is number;

      allow update, delete: if isAdmin();
    }

    // Append-only audit trail. The admin console writes one entry per action.
    match /adminLogs/{logId} {
      allow read: if isAdmin();

      allow create: if isAdmin()
        && request.resource.data.by == request.auth.token.email;

      allow update, delete: if false;
    }
  }
}
```

Firestore Console writes bypass these rules, so you can always repair data by hand.
The website itself can never mark an order paid, move wallet money, or approve a top-up.

### 4.4 Authorise the live domain

Firebase Console → **Authentication → Settings → Authorized domains → Add domain**:

- `hemaldas666.github.io` (just the hostname — no `https://`, no path)
- your custom domain, if you add one later

Without this, sign-in and email actions can fail with `auth/unauthorized-domain`.

### 4.5 Email verification and password reset

- The register form sends a verification email automatically. The account page has
  **Resend** and **I've verified** buttons.
- “Forgot your password?” in the login modal sends a reset link.
- Optional: **Authentication → Templates** lets you rename the sender, change the reply-to,
  and set a custom action URL (for example
  `https://hemaldas666.github.io/The-Knights-Of-BD/account/`).
- With the default Firebase mailer, the sender is
  `noreply@the-knights-acc.firebaseapp.com`. For a small server this is fine, but tell
  players to check **spam**. A custom SMTP domain requires the Blaze plan.

---

## 5. Player wallet and top-ups

### 5.1 Top-up flow

1. The player opens **Account → Top up wallet** (or the store’s wallet box).
2. They choose **bKash** or **Nagad**, send money with **Send Money** to the number shown,
   and keep the transaction ID.
   - bKash: `01765980414`
   - Nagad: `01314726844`
   - Both numbers live in `js/config.js` → `PAYMENTS`.
3. In the top-up modal they enter the **amount**, the **sender number**, the **TrxID**
   and an optional note, then submit.
4. A `topups/{id}` document is created with `status: "pending"`. **No balance changes yet.**
5. Staff open `/admin/` → **Top-ups**, check the bKash/Nagad statement, and click
   **Approve**. This runs a Firestore transaction that:
   - increments `wallets/{uid}.balance` by the exact amount,
   - sets the request to `approved`,
   - writes an `adminLogs` entry.
6. If the payment cannot be verified, staff click **Reject**, optionally with a reason.
   The request becomes `rejected` and the player sees the reason in their history.

Limits: **৳10 minimum**, **৳50,000 maximum** per request. Quick amounts are
`100, 250, 500, 1000, 2500, 5000`; edit them in `js/config.js` → `WALLET`.

There is no automatic payment gateway. Every top-up is a manual, staff-verified request.
Never credit a wallet until the money is visible in the bKash/Nagad statement.

### 5.2 Wallet checkout

1. The store shows the player’s live balance.
2. If the balance covers the item, **Wallet** is selected by default. It can still be
   changed to bKash or Nagad.
3. Clicking **Confirm wallet order** creates a normal `orders/{id}` document with
   `method: "wallet"` and `status: "pending"`. **Nothing is deducted yet.**
4. Staff open **Orders → Pending**, check the player and item, and click **Deduct & pay**.
   The transaction checks the wallet balance, subtracts the **catalog price** from
   `js/config.js`, sets `status: "paid"`, records `walletCharged`, and writes an audit log.
5. Staff deliver in-game and click **Mark delivered**.

If the order’s `amount` does not match the catalog price, the admin console flags it.
The deduction always uses the catalog price, never the client-supplied number.

### 5.3 Cancellations and refunds

- **Pending wallet order** — cancel without a refund; no money has moved.
- **Paid wallet order** — use **Cancel / refund** with the refund option. The transaction
  returns `walletCharged` (or `amount`) to the wallet and marks the order `cancelled`.
- **Delivered order** — cannot be cancelled from the console. Handle exceptional cases
  manually in Firestore and add an audit note.
- **Cash orders** — cancel with a reason; if money was already received, refund it
  through bKash/Nagad outside the site.

### 5.4 Manual balance adjustments

Open **Players**, search by username, IGN, email or UID, open the player, and use the
wallet editor. Enter a positive amount to add credit or a negative amount to remove it,
plus a short reason. The transaction refuses to take a balance below zero and writes an
audit log. Use this for corrections, compensation, or manual refunds.

---

## 6. The private admin console

### Access

- URL: `https://hemaldas666.github.io/The-Knights-Of-BD/admin/`
- Sign in with `dashemal08@gmail.com`.
- The gate checks the email and `emailVerified`; Firestore rules independently enforce
  the same checks on every read and write.
- The page is `noindex,nofollow` and is not in the public navigation. Because the repo is
  public, the URL is still discoverable — **the security is the verified account + rules**,
  not the hidden path.

### Screens

| Screen | What it does |
| --- | --- |
| **Overview** | Live counts, wallet liability, pending action queue, recent audit activity |
| **Top-ups** | Pending / approved / rejected requests; approve, reject with reason |
| **Orders** | Pending / paid / delivered / cancelled; cash mark-paid, wallet deduct & pay, deliver, cancel/refund |
| **Players** | Search every profile; live wallet balance; add/remove credit with reason |
| **Activity** | Latest `adminLogs` entries |

All lists update in real time through Firestore listeners. Confirmations are required
before money moves. The layout switches to a bottom navigation bar on phones.

### First-run order of operations

1. Publish the rules in section 4.3.
2. Register and verify the admin account in section 4.2.
3. Sign in at `/admin/`.
4. If the console shows a **Setup required** banner, the rules are missing or the email
   differs. Open the Firebase Console link in the banner, publish, then reload.
5. Create a test player, submit a small top-up, approve it, then place and approve a
   wallet order. This proves the full loop before announcing the wallet.

---

## 7. Data model

All amounts are **numbers in BDT**; all timestamps are **numbers (Unix milliseconds)**.

### `users/{uid}`

```
username, ign, email, createdAt, updatedAt
```

### `orders/{orderId}`

```
orderId, uid, email, username, ign,
itemId, itemName, category,
amount, currency: "BDT",
method: "bkash" | "nagad" | "wallet",
status: "pending" | "paid" | "delivered" | "cancelled",
createdAt,
paidAt?, deliveredAt?, cancelledAt?, cancelReason?,
walletCharged?, reviewedBy?, refundedAt?
```

The document ID is the same as `orderId` (format `KBD-XXXXXX-XXXX`).

### `wallets/{uid}`

```
balance, currency: "BDT", updatedAt, updatedBy
```

The UID is the player’s Firebase Auth UID. A missing wallet means a balance of `৳0`
until staff create it by approving a top-up or adjusting the balance.

### `topups/{topupId}`

```
requestId, uid, email, username, ign,
amount, currency: "BDT",
method: "bkash" | "nagad",
senderNumber, txnId, note,
status: "pending" | "approved" | "rejected",
createdAt,
reviewedAt?, reviewedBy?, adminNote?
```

The document ID is the same as `requestId` (format `TOP-XXXXXXX-XXXX`).

### `adminLogs/{logId}`

```
action, targetUid, targetName, amount, delta?, requestId?, reason?,
by, at
```

Actions include `topup.approved`, `topup.rejected`, `order.paid`,
`order.wallet_paid`, `order.delivered`, `order.cancelled`, `wallet.adjust`.

---

## 8. Live server status

- Both addresses (`synapse.veltrionhost.com:25568` and `knightsbd.mine.bz:25568`) point
  at the same world.
- Data comes from `api.mcstatus.io`, with `api.mcsrvstat.us` as a fallback. No API key is needed.
- The widget caches for 45 seconds, refreshes every 60 seconds, and pauses while the tab is hidden.
- Static details on `/status/` — “Paper 1.21.11”, “50 slots”, “Java Edition” — are written
  into `status/index.html`. The live version/player count comes from the API.
- If players show online but the site says offline, the host may be blocking the public
  query port; test the API URL directly in a browser. The server itself can still be joinable.

---

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Blank page / modules do not load | Serve over HTTP, not `file://`. |
| Login button stays as a grey skeleton | Firebase SDK blocked by an ad-blocker/network, or `js/firebase.js` failed to load. Check the browser console. |
| `auth/unauthorized-domain` | Add the live hostname in **Authentication → Settings → Authorized domains**. |
| `auth/operation-not-allowed` | Enable **Email/Password** in Authentication → Sign-in method. |
| Account page says **Local mode** | Firestore database not created, rules not published, or `permission-denied`. Check the browser console and the Firestore rules. |
| Wallet balance shows **৳—** | The `wallets` read was denied. Publish the rules in 4.3; confirm the signed-in UID matches the wallet document. |
| Top-up submit fails | Rules not published, `amount` outside 10–50,000, invalid sender number/TrxID, or network. The form shows the field error. |
| Top-up never appears in `/admin/` | The request was denied by rules or created in another project. Check the console; confirm the document exists in `topups`. |
| Admin page says **Access denied** | Wrong account, unverified email, or `ADMIN.email` differs from the rules. Verify, sign out/in, and re-check both emails. |
| Admin page says **Setup required / permission denied** | The rules are not published, or you are signed in with a non-admin account. Publish section 4.3 and reload. |
| Admin actions fail with “insufficient balance” | The wallet is lower than the catalog price, or the order was already processed. Refresh the queue. |
| Wallet order stays pending | Staff must click **Deduct & pay**. This is intentional — players cannot spend money without approval. |
| Cash order missing from staff queue | The order was saved while in local mode, or failed the order-create rule. Check the browser console and Firestore. |
| Status card stuck on “Checking…” | API blocked or offline; the fallback should take over in a few seconds. Test `api.mcstatus.io` manually. |
| Verification/reset email never arrives | Check spam; confirm the sender/template in Firebase; remember default mail quotas. |
| Old design appears after deploy | Hard refresh (`Ctrl + F5`); GitHub Pages and the browser cache CSS/JS. |
| Mobile layout looks cropped | Test in a real browser with device emulation — old headless Chrome screenshots can crop at small widths. |

---

## 10. Go-live checklist

- [ ] Firestore database created and the rules in section 4.3 published
- [ ] Email/Password provider enabled
- [ ] Admin account `dashemal08@gmail.com` registered **and email-verified**
- [ ] `ADMIN.email` in `js/config.js` matches the rules
- [ ] `hemaldas666.github.io` (and any custom domain) added to Firebase authorised domains
- [ ] Prices, rank perks and payment numbers checked in `js/config.js`
- [ ] Supported client versions confirmed — `1.8 – 1.21.x` only works on Paper 1.21.11 if ViaVersion is installed; otherwise change it to `1.21.x` in `js/config.js` and `status/index.html`
- [ ] Both server IPs tested in Minecraft
- [ ] Discord invite `https://discord.gg/GU9426EpBM` opens correctly
- [ ] Rules page text reviewed by staff
- [ ] Top-up test: submit a small request, approve it, see the wallet credited
- [ ] Wallet order test: place an order, deduct & pay, mark delivered
- [ ] Refund test: cancel a paid wallet order with refund, see the balance return
- [ ] Manual balance adjustment test: add and remove credit, see the audit log
- [ ] Verification email and password reset tested with a real inbox
- [ ] Site and `/admin/` checked on a phone (390 px wide) and desktop
- [ ] Old bookmarks to `style.css` / old pages no longer needed

---

*Last rebuilt: October 2026. No frameworks, no build step, no npm dependencies at runtime.*
