/* Shift Shift Fill — content script.
   Runs on Facebook and Wix event pages. Listens for fill requests
   from the popup and fills the active form with the picked event.
   It never submits, creates, or publishes anything — it only fills
   fields, and the user reviews and submits the form themselves. */
(function () {
  "use strict";

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
        var result = fill.fillEventForm(document, message.event);
        sendResponse({ ok: true, filled: result.filled, missing: result.missing });
      } catch (e) {
        sendResponse({ ok: false, error: "fill-failed" });
      }
      return true;
    }
    return false;
  });
})();
