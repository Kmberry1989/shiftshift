/* Shift Shift Fill — popup.
   Lists the events from the Shift Shift app (loopback server on
   127.0.0.1:53683) and asks the content script to fill the active
   tab's form with the picked one. The app must be running; if it
   is not, the popup says so instead of failing. The pairing code is
   stored in chrome.storage.local and sent as a header. */
(function () {
  "use strict";

  var BASE = "http://127.0.0.1:53683";
  var TOKEN_KEY = "shiftShiftPairingToken";

  var statusEl = document.getElementById("status");
  var pairingEl = document.getElementById("pairing");
  var pairingInput = document.getElementById("pairingCode");
  var savePairingBtn = document.getElementById("savePairingBtn");
  var eventsEl = document.getElementById("events");
  var resultEl = document.getElementById("result");

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle("err", !!isError);
    statusEl.hidden = false;
  }

  function showPairing(message) {
    pairingEl.hidden = false;
    if (message) setStatus(message, true);
  }

  function getToken() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(TOKEN_KEY, function (items) {
        resolve(items[TOKEN_KEY] || "");
      });
    });
  }

  function loadEvents(token) {
    setStatus("Connecting to Shift Shift…");
    eventsEl.innerHTML = "";
    resultEl.hidden = true;
    return fetch(BASE + "/events", {
      headers: { "X-Shift-Shift-Token": token },
    }).then(function (res) {
      if (res.status === 401) {
        statusEl.hidden = true;
        showPairing("That pairing code was rejected. Check the code in Shift Shift: Settings → General → Browser extension.");
        return null;
      }
      if (!res.ok) throw new Error("http-" + res.status);
      return res.json();
    }).then(function (data) {
      if (!data) return;
      pairingEl.hidden = true;
      if (data.cached) setStatus("Showing cached events — Shift Shift has no live list right now.");
      else statusEl.hidden = true;
      renderEvents(data.events || []);
    }).catch(function () {
      statusEl.hidden = true;
      showPairing("");
      setStatus("Shift Shift isn't running. Open Shift Shift on this computer, then try again.", true);
    });
  }

  function eventWhen(ev) {
    var parts = [];
    if (ev.date) parts.push(ev.date);
    if (ev.startTime) parts.push(ev.startTime + (ev.endTime ? "–" + ev.endTime : ""));
    if (ev.price) parts.push(ev.price);
    return parts.join(" · ");
  }

  function renderEvents(events) {
    eventsEl.innerHTML = "";
    if (!events.length) {
      setStatus("No saved events yet. Save an event in Main Eventer first, then come back here.");
      return;
    }
    events.forEach(function (ev) {
      var row = document.createElement("div");
      row.className = "event";
      var info = document.createElement("div");
      info.className = "info";
      var name = document.createElement("div");
      name.className = "name";
      name.textContent = ev.title || "(No name)";
      var when = document.createElement("div");
      when.className = "when";
      when.textContent = eventWhen(ev);
      info.appendChild(name);
      info.appendChild(when);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Fill this form";
      btn.addEventListener("click", function () { fillForm(ev, btn); });
      row.appendChild(info);
      row.appendChild(btn);
      eventsEl.appendChild(row);
    });
  }

  function fillForm(ev, btn) {
    btn.disabled = true;
    resultEl.hidden = true;
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || typeof tab.id !== "number") {
        resultEl.textContent = "No active tab to fill.";
        resultEl.hidden = false;
        btn.disabled = false;
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "shift-shift-fill", event: ev }, function (res) {
        btn.disabled = false;
        if (chrome.runtime.lastError) {
          resultEl.textContent = "Couldn't reach this page. Reload it and try again.";
          resultEl.hidden = false;
          return;
        }
        if (!res || !res.ok) {
          resultEl.textContent = "Fill didn't work on this page.";
          resultEl.hidden = false;
          return;
        }
        var n = (res.filled || []).length;
        resultEl.textContent = n
          ? "Filled " + n + " field" + (n === 1 ? "" : "s") + (res.missing && res.missing.length ? " — no field on this page for: " + res.missing.join(", ") : "") + ". Check them, then submit the form yourself."
          : "No matching fields on this page.";
        resultEl.hidden = false;
      });
    });
  }

  savePairingBtn.addEventListener("click", function () {
    var code = (pairingInput.value || "").trim();
    if (!code) return;
    chrome.storage.local.set({ [TOKEN_KEY]: code }, function () {
      loadEvents(code);
    });
  });

  getToken().then(function (token) {
    if (!token) {
      statusEl.hidden = true;
      showPairing("");
      setStatus("Enter the pairing code from Shift Shift to connect.", false);
      return;
    }
    loadEvents(token);
  });
})();
