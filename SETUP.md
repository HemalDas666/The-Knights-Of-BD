# The Knights Of BD — Setup & Maintenance

A static website (plain HTML + CSS + JavaScript modules). There is **no build step** — the folder can be uploaded/deployed exactly as it is.

---

## 1. What is in the site

| Path | Page |
| --- | --- |
| `/` | Home — hero, live status, members, features |
| `/store/` | Store — coins, money vouchers, ranks, BDT→currency converter, checkout |
| `/account/` | Account — profile, Minecraft IGN, email verification, order history |
| `/status/` | Live server status for both IPs + connection guide |
| `/rules/` | Server rules and punishments |

Shared code lives in `js/` and `css/`. Each page folder contains its own `index.html` (and `script.js` where needed), so every URL is clean and GitHub-Pages friendly.

### Files you will actually edit

| What | Where |
| --- | --- |
| Server IPs, ports, Java version text | `js/config.js` → `SERVER` |
| Discord invite | `js/config.js` → `SITE.discord` |
| Every store price, item name, rank perk | `js/config.js` → `ITEMS`, `CATEGORIES` |
| bKash / Nagad numbers | `js/config.js` → `PAYMENTS` |
| Converter fallback rates | `js/config.js` → `FX.fallback` |
| Site name, owner, support email | `js/config.js` → `SITE` |
| Rules text | `rules/index.html` |
| Staff / member cards | `index.html` → `#members` |
| Colours, fonts, spacing | `css/base.css` → `:root` |
| Logo / favicon | `assets/KnightLOGO11.png`, `assets/KnightLOGO9.png` |

> **Prices are defined once, in `js/config.js`.** The HTML contains no hard-coded prices. Edit a number there and the store, checkout, order records and account page all update together.

---

## 2. Preview locally

ES modules and Firebase do **not** work when a file is opened with `file://`. Use a small local server:

```powershell
cd "C:\Users\dashe\Desktop\The Knights Of BD"
npx serve .
```

Then open the printed URL (usually `http://localhost:3000`). Any static server works (VS Code Live Server, Python `http.server`, etc.).

> `127.0.0.1` / `localhost` are already authorised in Firebase by default. No extra setup is needed for local testing.

---

## 3. Deploy to GitHub Pages

The repository is `HemalDas666/The-Knights-Of-BD`, deployed at
`https://hemaldas666.github.io/The-Knights-Of-BD/`.

1. Commit and push everything:
   ```powershell
   git add -A
   git commit -m "Rebuild site: auth, live status, store, new pages"
   git push origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: **main**, folder: **/ (root)**
   - Save.
3. Wait for the green deployment check. The site will be at:
   `https://hemaldas666.github.io/The-Knights-Of-BD/`

If you use a custom domain, add it under **Settings → Pages → Custom domain** and follow GitHub's DNS instructions. A custom domain also has to be added to Firebase (next section).

> The old `style.css`, `script.js` and `store/style.css` have been removed. After deploying, do a hard refresh (`Ctrl + F5`) once so browsers do not keep the old cached files.

---

## 4. Firebase setup (required for accounts + cloud orders)

The project is already connected: **`the-knights-acc`** (config in `js/firebase.js`). The web API key there is public by design — security is enforced by Firestore rules.

Accounts, email verification, password reset and order history **will not sync** until these console steps are done. Until then the site still works, but the account page shows **“Local mode”** and orders stay in that one browser only.

### 4.1 Enable Email/Password sign-in

1. Firebase Console → **Authentication → Sign-in method**
2. Enable **Email/Password** (not “Email link”).
3. Save.

### 4.2 Create Firestore and publish rules

1. Firebase Console → **Build → Firestore Database**. If a database already exists, skip to the **Rules** tab; otherwise choose **Create database**.
2. If creating: choose **Production mode**, then location **`asia-south1` (Mumbai)** — the closest region to Bangladesh. This cannot be changed later.
3. Open the **Rules** tab, paste the block below and press **Publish**:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Each user can read and write only their own profile.
    match /users/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow create, update: if request.auth != null && request.auth.uid == uid;
      allow delete: if false;
    }

    // Buyers can create a pending order for themselves and read their own
    // orders. Only staff (Firebase Console) can change paid / delivered.
    match /orders/{orderId} {
      allow create: if request.auth != null
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.status == 'pending'
        && request.resource.data.amount is number
        && request.resource.data.amount > 0;
      allow read: if request.auth != null
        && resource.data.uid == request.auth.uid;
      allow update, delete: if false;
    }
  }
}
```

Firestore Console writes bypass these rules, so staff can still update an order's status by hand. The website itself can never mark an order paid — that is intentional.

5. Reload the site's account page while logged in. The note at the bottom of the order list should now say **“Cloud sync active”**.

### 4.3 Authorise the live domain

Firebase Console → **Authentication → Settings → Authorized domains → Add domain**:

- `hemaldas666.github.io` (just the hostname — no `https://`, no path)
- your custom domain, if you add one later

Without this, sign-in and email actions can fail with `auth/unauthorized-domain`.

### 4.4 Email verification and password reset

- The register form sends a verification email automatically. The account page has **Resend** and **I've verified** buttons.
- “Forgot your password?” in the login modal sends a reset link.
- Optional: **Authentication → Templates** lets you rename the sender, change the reply-to, and set a custom action URL (for example `https://hemaldas666.github.io/The-Knights-Of-BD/account/`).
- With the default Firebase mailer, the sender is `noreply@the-knights-acc.firebaseapp.com`. For a small server this is fine, but tell players to check **spam**. A custom SMTP domain requires the Blaze plan.

---

## 5. How the store and order fulfilment work

### Buyer flow

1. Buyer opens the store and clicks **Buy now** on an item.
2. If logged out, the login/register modal opens. After a successful login the checkout re-opens automatically.
3. If the account has no **Minecraft IGN**, the store sends the buyer to the account page to set it. Purchases cannot be delivered without an exact Java username.
4. Checkout shows the item, the exact **BDT** amount, the bKash/Nagad number, and a unique order ID (format `KBD-XXXXXX-XXXX`).
5. The buyer sends the money with **Send Money**, then clicks **“I have sent the payment”**. At that moment the order is saved with `status: "pending"`.
6. The confirmation dialog reminds them to send the **transaction ID + order ID** to staff on Discord.

The currency converter is display-only. It converts the BDT price for reference; **the amount charged is always the BDT price**.

### Staff flow (manual, via Firebase Console)

1. Open **Firestore Database → Data → orders**.
2. Find the order by its `orderId` (the document ID is the same).
3. Check the bKash/Nagad statement for the exact amount and the buyer's reference.
4. Change `status` from `pending` to **`paid`**.
5. Deliver the item in-game to the saved `ign`.
6. Change `status` to **`delivered`**.

The buyer sees the new badge on `/account/` after refreshing. The three statuses the UI understands are `pending`, `paid`, `delivered`; anything else is displayed as pending.

Useful order fields:

```
orderId, uid, email, username, ign, itemId, itemName, category,
amount, currency: "BDT", method, status, createdAt
```

> **Important:** if Firestore is not enabled (section 4.2), orders exist only in the buyer's browser and **staff will never see them**. Check that the account page says “Cloud sync active” before announcing the store.

### Refunds / cancellations

There is no customer-facing cancel button. Handle refunds manually, then set the order status back to `pending` or delete the document in the Console. If you later want buyers to cancel their own pending orders, add a narrow rule allowing `update` only from `pending` to `cancelled` — do not allow general order updates.

---

## 6. Live server status

- Both addresses (`synapse.veltrionhost.com:25568` and `knightsbd.mine.bz:25568`) point at the same world.
- Data comes from `api.mcstatus.io`, with `api.mcsrvstat.us` as a fallback. No API key is needed.
- The widget caches for 45 seconds, refreshes every 60 seconds, and pauses while the tab is hidden.
- Static details on `/status/` — “Paper 1.21.11”, “50 slots”, “Java Edition” — are written into `status/index.html`. The live version/player count comes from the API.
- If players show online but the site says offline, the host may be blocking the public query port; test the API URL directly in a browser. The server itself can still be joinable.

---

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Blank page / modules do not load | Serve over HTTP, not `file://`. |
| Login button stays as a grey skeleton | Firebase SDK blocked by an ad-blocker/network, or `js/firebase.js` failed to load. Check the browser console. |
| `auth/unauthorized-domain` | Add the live hostname in **Authentication → Settings → Authorized domains**. |
| `auth/operation-not-allowed` | Enable **Email/Password** in Authentication → Sign-in method. |
| Account page says **Local mode** | Firestore database not created, rules not published, or `permission-denied`. Check the browser console and the Firestore rules. |
| Orders never appear for staff | The buyer placed the order while in local mode, or the order failed the rules (wrong `uid`/`status`/`amount`). |
| Status card stuck on “Checking…” | API blocked or offline; the fallback should take over in a few seconds. Test `api.mcstatus.io` manually. |
| Verification/reset email never arrives | Check spam; confirm the sender/template in Firebase; remember default mail quotas. |
| Old design appears after deploy | Hard refresh (`Ctrl + F5`); GitHub Pages and the browser cache CSS/JS. |
| Mobile layout looks cropped | Test in a real browser with device emulation — old headless Chrome screenshots can crop at small widths. |

---

## 8. Go-live checklist

- [ ] Firestore database created and the rules above published
- [ ] Email/Password provider enabled
- [ ] `hemaldas666.github.io` (and any custom domain) added to Firebase authorised domains
- [ ] Prices, rank perks and payment numbers checked in `js/config.js`
- [ ] Supported client versions confirmed — `1.8 – 1.21.x` only works on Paper 1.21.11 if ViaVersion is installed; otherwise change it to `1.21.x` in `js/config.js` and `status/index.html`
- [ ] Both server IPs tested in Minecraft
- [ ] Discord invite `https://discord.gg/GU9426EpBM` opens correctly
- [ ] Rules page text reviewed by staff
- [ ] A real test purchase made: order appears in Firestore, then marked `paid` → `delivered`
- [ ] Verification email and password reset tested with a real inbox
- [ ] Site checked on a phone (390 px wide) and desktop
- [ ] Old bookmarks to `style.css` / old pages no longer needed

---

*Last rebuilt: October 2026. No frameworks, no build step, no npm dependencies at runtime.*
