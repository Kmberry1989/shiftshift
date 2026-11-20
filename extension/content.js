/* Shift Shift Fill — content script.
   Runs on Facebook and Wix event pages. Listens for fill requests
   from the popup and fills the active form with the picked event.

   Facebook has no native controls: every field is a custom
   role="combobox" whose options render in a portal after the
   dialog. The fill (extension/fill.js, fillFacebookForm) does real
   clicks through those portals — expand first, then the
   in-person/virtual choice, then the location suggestion pick,
   then calendar gridcells, time options, and timezone options —
   verifying each value stuck after a blur. It never submits,
   creates, or publishes anything — it only fills fields, and the
   user reviews and submits the form themselves.

   The driver retries the whole pass (up to 3) while a portal kind
   — location, a date, a time, a timezone — is still missing, since
   live portals render late and popups can close on their own. */
(function () {
  "use strict";

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || message.type === "shift-shift-ping") {
      sendResponse({ ok: true, app: "Shift Shift Fill" });
      return true;
    }
    if (message.type === "shift-shift-fill" && message.event) {
      (async function () {
        var fill = window.ShiftShiftFill;
        if (!fill || typeof fill.fillFacebookForm !== "function") {
          sendResponse({ ok: false, error: "fill-unavailable" });
          return;
        }
        var event = message.event;
        var result = null;
        var attempts = 0;
        var MAX_ATTEMPTS = 3;
        /* The kinds that only appear once optional sections open or
           portals render: a retry is only worth it while one of
           these is missing. */
        function stillMissing(res) {
          var missing = res.missing || [];
          for (var i = 0; i < missing.length; i++) {
            if (missing[i] === "location" || missing[i] === "endDate" ||
                missing[i] === "endTime" || missing[i] === "startDate" ||
                missing[i] === "startTime" || missing[i] === "timezone") return true;
          }
          return false;
        }
        try {
          while (attempts < MAX_ATTEMPTS) {
            attempts++;
            try {
              result = await fill.fillFacebookForm(document, event);
            } catch (e) {
              result = null;
            }
            if (!result) break;
            if (!stillMissing(result)) break;
            await sleep(500);
          }
        } catch (e) {
          result = null;
        }
        if (!result) {
          sendResponse({ ok: false, error: "fill-failed" });
          return;
        }
        sendResponse({ ok: true, filled: result.filled, missing: result.missing, attempts: attempts });
      })();
      return true;
    }
    return false;
  });
})();
