# Running this with a Wix website

dajicricket.com is a Wix domain and the public website is built in Wix. **Wix cannot run the Node server** in this project, so the system is split in two:

```
 Visitors ──► https://dajicricket.com            (Wix: home, grounds, gallery, contact — native Wix pages, indexed by Google)
                   │  booking / account / accounting screens are Wix "custom elements"
                   │  (<daji-booking>, <daji-account>, <daji-accounting>) loaded from:
                   ▼
              https://api.dajicricket.com        (this server: JSON API + /embed/daji-widgets.js)
                   ▲                ▲
   Expo app (iOS/Android)      Razorpay webhooks  →  https://api.dajicricket.com/api/webhooks/razorpay
```

Keep marketing pages as normal Wix pages (Wix handles their SEO). Only the interactive flow — pick a slot, hold, pay, cancel, owner accounts — is the widget.

## What Wix requires (from Wix's own documentation)

| Need | Detail |
|---|---|
| Plan | Custom elements on a **live** site need a **Premium plan, a connected custom domain, and no Wix ads**. |
| HTTPS | Externally hosted custom elements need HTTPS (the script and the API). |
| Where it runs | In the editor and preview, custom elements render inside an iframe, so they can look different from the live site. Check both. |
| SEO | Content inside a custom element is only seen by crawlers that run JavaScript unless you set `seoMarkup` from page code. Keep the real text on native Wix elements. |
| DNS | Wix Domains → Manage DNS Records → add a record. Host `api`, pointing at wherever the server runs (A record to an IP, or CNAME to a hostname). The domain must be managed in the same Wix account. Changes can take up to 48 hours. |

## What this server does for Wix

| Setting | Value for dajicricket.com | Why |
|---|---|---|
| `PUBLIC_URL` | `https://dajicricket.com` | The website, used in links in messages. |
| `API_URL` | `https://api.dajicricket.com` (this is also the default) | Where the API lives. Shown in setup warnings; use it for the Razorpay webhook. |
| `CORS_ORIGINS` | `https://dajicricket.com,https://www.dajicricket.com` (default) plus the Wix editor/preview address, see below | Browsers only let a page call the API if its address is listed. Patterns such as `https://*.wixsite.com` are accepted. |
| `FRAME_ANCESTORS` | `https://dajicricket.com,https://www.dajicricket.com` (default) | Only if you embed the full web app in an HTML iframe instead of using custom elements. The API itself can never be framed. |
| `JWT_SECRET`, `TRUST_PROXY=1`, `DEMO_MODE` off | as in the README | Normal production settings. |

`/embed/*` files are served with `Access-Control-Allow-Origin: *` so Wix can load the widget script from another address. Nothing else is open.

### The Wix editor and preview

The widget runs from a different address inside the Wix editor and preview than on the live site. I could not open a Wix editor from here, so I do not know those addresses for certain. If the widget works on the live site but shows no data in the editor, look at the server log: the first blocked address is logged once as

`CORS: blocked origin https://… If this is your own site (e.g. the Wix editor or preview), add it to CORS_ORIGINS.`

Add exactly that address (or a `*.` pattern for its domain) to `CORS_ORIGINS`.

## Set-up checklist

1. Run the API somewhere with HTTPS (any small server; stage 5 provides Docker + Caddy). Set the variables above.
2. In Wix Domains → Manage DNS Records, add `api` → your server. Wait until `https://api.dajicricket.com/api/health` answers.
3. Upgrade the Wix site to a Premium plan and connect the domain (needed for custom elements on the live site).
4. In the Wix editor: Add → Embed code → Custom element → "Choose source" → Server URL `https://api.dajicricket.com/embed/daji-widgets.js`, tag name `daji-booking`. Repeat with `daji-account` and `daji-accounting` on their own pages. Available tags: `daji-booking`, `daji-account` (My dashboard), `daji-accounting` (owner desk), `daji-scores`, `daji-grounds`, `daji-gallery`, `daji-academy`, `daji-contact`, `daji-platform`. Each is a frame onto the real site, so booking rules, payment and sign-in are identical. The frame resizes itself to its content.
5. Email goes out through Gmail (dajicricket@gmail.com): create a Google App Password and put it in `GMAIL_APP_PASSWORD`.
5. Razorpay dashboard → webhook URL `https://api.dajicricket.com/api/webhooks/razorpay`, with the secret in `RAZORPAY_WEBHOOK_SECRET`.
6. Apply the brand colours and fonts in Wix (see `brand/tokens.css`: background `#0a0c0b`, text `#f3eee3`, gold `#c9a96b`). Whether Wix's font library has Kaushan Script and Barlow Semi Condensed, or you need to upload font files, I have not checked.

## Why not rebuild the backend inside Wix (Velo)?

Velo backend code has a 14-second execution limit and request-rate quotas, which is fine. The real problem is the booking guarantee: the database must refuse two bookings for the same ground and slot even if application code is wrong, and the accounting stage needs parsing of uploaded bank files and Yodlee calls. I found nothing in Wix's documentation confirming a composite uniqueness rule or multi-record transactions in Wix Data, so I kept the Node API, which has both and is covered by 142 automated tests.

## Not verified

- Nothing has been run on a real Wix site (no Wix account here).
- The exact editor/preview origins (see above).
- Wix's font library.
- The widgets were tested inside a plain test page on another address, not inside Wix. Razorpay's pay window opens inside the frame; on a short frame it could be cramped, so check a real test payment on a phone.
- Safari may keep the sign-in inside the frame separate from the rest of the Wix site; people may need to sign in once in the widget.
