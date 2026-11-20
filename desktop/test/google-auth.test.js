"use strict";
/* Google OAuth authorization URL (desktop sign-in): the account
   chooser is always shown, and the copy control hands out exactly
   the URL the app generated — never the PKCE verifier. These tests
   run against the pure module, no Electron. */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildGoogleAuthUrl,
  createAuthUrlStore,
  copySignInLink,
} = require("../google-auth.js");

const CLIENT_ID = "369187068047-test.apps.googleusercontent.com";
const REDIRECT_URI = "http://127.0.0.1:53682/callback";
const STATE = "state-abc123";
const VERIFIER = "verifier-that-must-never-leave-the-app";
const CHALLENGE = "challenge-xyz789";

function authUrl() {
  return buildGoogleAuthUrl({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    state: STATE,
    challenge: CHALLENGE,
  });
}

test("the auth URL forces the account chooser and keeps re-consent", () => {
  const url = new URL(authUrl());
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  /* Space-separated per OIDC: consent so Google issues a fresh
     refresh token with the current scopes, select_account so the
     chooser always appears. */
  assert.equal(url.searchParams.get("prompt"), "consent select_account");
  assert.ok(url.searchParams.get("prompt").split(" ").includes("select_account"));
  assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(url.searchParams.get("redirect_uri"), REDIRECT_URI);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), STATE);
  assert.equal(url.searchParams.get("code_challenge"), CHALLENGE);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("access_type"), "offline");
});

test("the auth URL never carries the PKCE verifier", () => {
  const url = authUrl();
  assert.ok(!url.includes(VERIFIER), "the verifier must not appear in the URL");
  assert.ok(url.includes(CHALLENGE), "only the public challenge goes in the URL");
});

test("copy copies exactly the URL that was generated", () => {
  const store = createAuthUrlStore();
  const generated = authUrl();
  store.set(generated);
  let copied = null;
  const clipboard = { writeText: (t) => { copied = t; } };
  assert.deepEqual(copySignInLink(store, clipboard), { ok: true });
  assert.equal(copied, generated, "the copied link must equal the generated URL");
});

test("copy does nothing when no sign-in attempt is active", () => {
  const store = createAuthUrlStore();
  let copied = null;
  const clipboard = { writeText: (t) => { copied = t; } };
  assert.deepEqual(copySignInLink(store, clipboard), { ok: false });
  assert.equal(copied, null);
});

test("the stored URL clears when the attempt ends", () => {
  const store = createAuthUrlStore();
  store.set(authUrl());
  assert.ok(store.get());
  store.clear();
  assert.equal(store.get(), null);
  let copied = null;
  const clipboard = { writeText: (t) => { copied = t; } };
  assert.deepEqual(copySignInLink(store, clipboard), { ok: false });
  assert.equal(copied, null);
});
