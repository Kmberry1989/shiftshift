"use strict";
/* Extension loopback server (desktop/extension-server.js): loopback
   only, pairing-token auth on /events, open /status, JSON shapes.
   Runs the real HTTP server on an ephemeral loopback port. */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { createExtensionServer, generatePairingToken, formatPairingToken, tokensEqual, EXTENSION_PORT } = require("../extension-server.js");

const TOKEN = "0123456789abcdef0123456789abcdef";
const EVENTS = [
  { id: "a", title: "Canvas Night", date: "2026-11-24", startTime: "5:30 PM", endTime: "7:30 PM", location: "111 W Sycamore St", price: 39 },
  { id: "b", title: "Moose Monday", date: "2026-12-01", startTime: "5:30 PM", endTime: "7:30 PM", location: "111 W Sycamore St", price: 39 },
];

function getEvents() {
  return { events: EVENTS, cached: false, updatedAt: 1763570000000 };
}

function req(port, pathName, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: pathName, headers: headers || {} }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    r.on("error", reject);
    r.end();
  });
}

test("token helpers: generation, formatting, constant-time compare", () => {
  const t = generatePairingToken();
  assert.equal(t.length, 32, "32 hex chars");
  assert.match(t, /^[0-9a-f]{32}$/, "hex only");
  assert.notEqual(generatePairingToken(), generatePairingToken(), "tokens are random per launch");
  assert.equal(formatPairingToken("0123456789abcdef0123456789abcdef"), "0123-4567-89ab-cdef-0123-4567-89ab-cdef");
  assert.ok(tokensEqual("0123-4567-89ab-cdef-0123-4567-89ab-cdef", TOKEN), "dashes ignored on compare");
  assert.ok(tokensEqual(" 0123456789abcdef0123456789abcdef ", TOKEN), "whitespace ignored on compare");
  assert.ok(!tokensEqual("0123456789abcdef0123456789abcde0", TOKEN), "wrong token rejected");
  assert.ok(!tokensEqual("", TOKEN), "empty token rejected");
  assert.equal(EXTENSION_PORT, 53683, "extension port 53683 (sign-in uses 53682)");
});

test("server binds loopback only; /status is open; /events needs the token", async (t) => {
  const { server, port } = await createExtensionServer({
    port: 0, token: TOKEN, getEvents,
    getStatus: () => ({ version: "0.1.13", events: EVENTS.length }),
  });
  t.after(() => new Promise((res) => server.close(res)));
  assert.equal(server.address().address, "127.0.0.1", "loopback only");

  const status = await req(port, "/status");
  assert.equal(status.status, 200);
  assert.deepEqual(JSON.parse(status.body), { ok: true, app: "Shift Shift", version: "0.1.13", events: 2 });

  const noToken = await req(port, "/events");
  assert.equal(noToken.status, 401, "no token → 401");
  assert.deepEqual(JSON.parse(noToken.body), { ok: false, error: "pairing-required" });

  const wrong = await req(port, "/events", { "X-Shift-Shift-Token": "00000000000000000000000000000000" });
  assert.equal(wrong.status, 401, "wrong token → 401");

  const good = await req(port, "/events", { "X-Shift-Shift-Token": TOKEN });
  assert.equal(good.status, 200);
  const body = JSON.parse(good.body);
  assert.equal(body.ok, true);
  assert.equal(body.events.length, 2);
  assert.equal(body.events[0].title, "Canvas Night");
  assert.equal(body.cached, false);
  assert.equal(body.updatedAt, 1763570000000);

  const dashed = await req(port, "/events", { "X-Shift-Shift-Token": formatPairingToken(TOKEN) });
  assert.equal(dashed.status, 200, "formatted (dashed) token accepted");

  const unknown = await req(port, "/nope");
  assert.equal(unknown.status, 404);
  assert.deepEqual(JSON.parse(unknown.body), { ok: false, error: "not-found" });
});
