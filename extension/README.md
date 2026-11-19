# Shift Shift Fill — companion browser extension

Fills an event form (Facebook event composer first, Wix event forms
best-effort) with one of Shift Shift's saved events. It never
submits, creates, or publishes anything — it only fills fields, and
you review and submit the form yourself.

## How it works

Shift Shift runs a loopback-only server on `127.0.0.1:53683` (sign-in
already uses 53682). The extension fetches the merged event list
from it — the same merge/dedup the bubble uses — and the content
script fills the active tab's form. A per-launch pairing code guards
the server: the extension sends it as the `X-Shift-Shift-Token`
header on every request. The server only listens on loopback, so
nothing outside this computer can reach it.

## Install (unpacked — no Web Store submission)

1. Open Shift Shift on the computer (the app must be running for
   the extension to reach it).
2. In Chrome or Edge, open `chrome://extensions` (or
   `edge://extensions`).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and pick this `extension/` folder.
5. Click the **Shift Shift Fill** icon in the toolbar. If it is not
   pinned, open the extensions menu (puzzle piece) and pin it.
6. Pair it once: in Shift Shift, go to **Settings → General →
   Browser extension → Show pairing code**. Paste the code into the
   extension popup and click **Save code**. The code is random per
   launch — if you quit and restart Shift Shift, show the new code
   and save it again.

## Use it

1. Open the Facebook event composer (or a Wix event form).
2. Click the Shift Shift Fill icon. The popup lists your saved
   events — name, date, time, price.
3. Click **Fill this form** on the event you want. The form's
   fields are filled: name, date, start/end time, location,
   description, price, and ticket/registration link, where the form
   has them.
4. Check the filled values, then submit the form yourself.

## What it fills, and what it does not

- Fields are matched by their label, aria-label, placeholder, name,
  or id — "Event name", "Start date", "Start time", "End time",
  "Location", "Description", "Price", "Ticket link", and the Wix
  equivalents. A field the form does not have is reported in the
  popup ("no field on this page for: …") and skipped.
- Values are set the React-safe way (native value setter plus
  input/change events), so Facebook's composer picks them up.
- Facebook's date/time pickers are text fields in the composer, so
  dates are filled as `M/D/YYYY` and times as `h:MM AM/PM`.
  Native `<input type="date">` / `<input type="time">` fields get
  ISO values instead.
- It does not fill: file uploads, ticket tiers, co-hosts, or
  anything behind a custom picker that is not a text field.
- It never submits or publishes. If the fill looks wrong, fix the
  field by hand — nothing was sent anywhere.

## Troubleshooting

- **"Shift Shift isn't running"** — start the Shift Shift app on
  this computer. The extension cannot reach the event list without
  it. Saved events are never stored in the extension itself.
- **"That pairing code was rejected"** — the code changes every
  time Shift Shift starts. Show the current code in Settings →
  General → Browser extension and save it again.
- **"Couldn't reach this page"** — reload the page and try again.
  The extension only runs on facebook.com and wix.com pages; it
  does nothing on other sites.
- **"No matching fields on this page"** — the form's fields do not
  carry labels the extension recognises. Fill them by hand, or
  tell the studio which form it was so the matcher can be taught.

## Files

- `manifest.json` — Manifest V3, Chrome + Edge.
- `popup.html` / `popup.js` — the popup: event list, pairing, fill.
- `content.js` — runs on Facebook/Wix pages, receives fill requests.
- `fill.js` — the field matching + fill logic (pure, unit-tested in
  `desktop/test/extension-fill.test.js`).
- `test-page.html` — a local form that mimics the Facebook composer
  labels, for verifying the fill without touching Facebook.
