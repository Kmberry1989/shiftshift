/* Shift Shift Fill — content script.
   Runs on Facebook and Wix event pages. Listens for fill requests
   from the popup and fills the active form with the picked event.
   Before filling it reveals the form's optional fields itself:
   it clicks "End date and time" expanders when the event has an
   end date/time, and sets the in-person/virtual control to match
   the event — then waits for the revealed fields to appear and
   fills. It never submits, creates, or publishes anything — it
   only fills fields, and the user reviews and submits the form
   themselves. */
(function () {
  "use strict";

  /* Wait until newly revealed fields settle, then run fn. A
     MutationObserver fires the settle timer (150 ms after the last
     change); a hard cap (1000 ms) fills even if nothing mutates,
     so a slow reveal never hangs the fill. */
  function afterReveal(fn) {
    var done = false;
    var timer = null;
    function finish() {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      fn();
    }
    if (typeof MutationObserver === "undefined" || !document.body) {
      setTimeout(finish, 150);
      return;
    }
    var observer = new MutationObserver(function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        observer.disconnect();
        finish();
      }, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () {
      observer.disconnect();
      finish();
    }, 1000);
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || message.type === "shift-shift-ping") {
      sendResponse({ ok: true, app: "Shift Shift Fill" });
      return true;
    }
    if (message.type === "shift-shift-fill" && message.event) {
      try {
        var fill = window.ShiftShiftFill;
        if (!fill || typeof fill.fillEventForm !== "function") {
          sendResponse({ ok: false, error: "fill-unavailable" });
          return true;
        }
        /* Reveal optional fields first — expanders for the end
           date/time, the in-person/virtual control — clicking only
           what this event calls for. Reveal is best-effort: a
           failure there must never block the fill. */
        var revealed = { expanders: [], inPersonVirtual: null };
        try {
          if (typeof fill.revealOptionalFields === "function") {
            revealed = fill.revealOptionalFields(document, message.event) || revealed;
          }
        } catch (e) { /* fill anyway */ }
        var needsWait = revealed.expanders.length > 0;
        var runFill = function () {
          try {
            var result = fill.fillEventForm(document, message.event);
            sendResponse({ ok: true, filled: result.filled, missing: result.missing, revealed: revealed });
          } catch (e) {
            sendResponse({ ok: false, error: "fill-failed" });
          }
        };
        if (needsWait) afterReveal(runFill);
        else runFill();
      } catch (e) {
        sendResponse({ ok: false, error: "fill-failed" });
      }
      return true;
    }
    return false;
  });
})();
