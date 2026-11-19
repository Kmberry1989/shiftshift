"use strict";
/* Shift Shift browser-extension local server.
   Loopback-only HTTP server on 127.0.0.1:53683 (sign-in already uses
   53682 — never collide). It serves the merged event list to the
   companion browser extension, so the extension can fill event
   forms from the same bank the bubble shows.
   Guarded by a per-launch pairing token: the extension sends it as
   the X-Shift-Shift-Token header on every request; anything else
   gets 401. Loopback-only, token required, never exposed externally.
   The token is random per launch (see generatePairingToken) and is
   shown in Settings → General under "Browser extension"; the user
   pastes it once into the extension popup, which stores it. */
const http = require("http");
const crypto = require("crypto");

const EXTENSION_PORT = 53683;
const TOKEN_HEADER = "x-shift-shift-token";

/* 32 hex chars of randomness. Displayed grouped (see
   formatPairingToken); the server accepts it with or without dashes. */
function generatePairingToken() {
  return crypto.randomBytes(16).toString("hex");
}

function formatPairingToken(token) {
  const t = String(token || "").replace(/-/g, "");
  const groups = [];
  for (let i = 0; i < t.length; i += 4) groups.push(t.slice(i, i + 4));
  return groups.join("-");
}

function normalizeToken(token) {
  return String(token || "").replace(/-/g, "").replace(/\s+/g, "").toLowerCase();
}

/* Constant-time comparison on the normalized tokens, so a wrong
   guess costs the same as a right one. */
function tokensEqual(a, b) {
  const x = Buffer.from(normalizeToken(a), "utf8");
  const y = Buffer.from(normalizeToken(b), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/* getEvents: () => ({ events: [...], cached: bool, updatedAt: ms }).
   getStatus: () => ({ version, events: n }) — for /status.
   Returns { server, port } once listening, or throws on bind error
   (e.g. the port is already taken). */
function createExtensionServer({ port, token, getEvents, getStatus }) {
  const listenPort = port || EXTENSION_PORT;
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1:" + listenPort);
      if (req.method === "GET" && url.pathname === "/status") {
        const status = (typeof getStatus === "function" ? getStatus() : {}) || {};
        sendJson(res, 200, { ok: true, app: "Shift Shift", version: status.version || "", events: status.events || 0 });
        return;
      }
      if (req.method === "GET" && url.pathname === "/events") {
        if (!tokensEqual(req.headers[TOKEN_HEADER], token)) {
          sendJson(res, 401, { ok: false, error: "pairing-required" });
          return;
        }
        const data = (typeof getEvents === "function" ? getEvents() : {}) || {};
        sendJson(res, 200, {
          ok: true,
          cached: !!data.cached,
          updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
          events: Array.isArray(data.events) ? data.events : [],
        });
        return;
      }
      sendJson(res, 404, { ok: false, error: "not-found" });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: "server-error" });
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "x-shift-shift-token, content-type",
  });
  res.end(body);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createExtensionServer, generatePairingToken, formatPairingToken,
    normalizeToken, tokensEqual, EXTENSION_PORT, TOKEN_HEADER,
  };
}
