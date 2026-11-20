"use strict";
/* Google OAuth authorization URL for the desktop sign-in flow:
   system browser + loopback redirect on 127.0.0.1:53682. Only this
   URL (which carries the public code_challenge) is ever opened in a
   browser or copied to the clipboard — the code_verifier never
   leaves the main process, so the user can finish sign-in in any
   browser and the loopback redirect still lands in the app. */
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_SCOPE = "openid email profile https://www.googleapis.com/auth/calendar.readonly";

function buildGoogleAuthUrl({ clientId, redirectUri, state, challenge }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    /* consent: re-consent so Google issues a fresh refresh token with
       the current scopes (the old one was just revoked).
       select_account: always show the account chooser — the account
       the user wants may live in another browser/profile, not the
       default browser's account. */
    prompt: "consent select_account",
  });
  return GOOGLE_AUTH_ENDPOINT + "?" + params.toString();
}

/* Holds the authorization URL generated for the current sign-in
   attempt, so the copy control can hand out exactly that URL. */
function createAuthUrlStore() {
  let url = null;
  return {
    set(u) { url = u || null; },
    get() { return url; },
    clear() { url = null; },
  };
}

/* Copy the current sign-in link. Returns { ok: true } only when a
   URL was actually copied. */
function copySignInLink(store, clipboard) {
  const url = store.get();
  if (!url) return { ok: false };
  clipboard.writeText(url);
  return { ok: true };
}

module.exports = {
  GOOGLE_AUTH_ENDPOINT,
  OAUTH_SCOPE,
  buildGoogleAuthUrl,
  createAuthUrlStore,
  copySignInLink,
};
