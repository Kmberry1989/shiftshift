/* Shift Shift Fill — field matching + fill logic.
   Pure module: given a form (any document-like root) and one event
   record, fill the form with the event. Facebook's event composer
   is the first target; Wix event forms are matched the same way,
   by their labels — best-effort.

   Facebook has NO native controls anywhere — no <select>, no
   date/time inputs. Every field is a custom role="combobox" whose
   options render in a portal AFTER the dialog in DOM order, so the
   fill does real clicks through the portals, with a wait-and-verify
   at each step — it never types a date, a time, or a timezone, and
   never trusts aria-expanded (the popup can close on its own while
   aria-expanded still says true; a portal actually present is the
   only signal a picker is open). The order matters:

     1. Expand "+ End date and time" FIRST — expanding auto-fills
        end defaults (end date = start date + 1 day, end time
        00:00, a second Time zone = EST), so the end values are
        set AFTER the expand, never before.
     2. In person / Virtual — a combobox whose two options render
        in a floating listbox outside the dialog. The location
        field only appears after "In person" is chosen.
     3. Location — a search combobox ("Add location") with an
        inner input. A place must be PICKED from the suggestions:
        typing the text alone never binds a place.
     4. Dates — a combobox opens a floating calendar dialog; set
        by CLICKING a gridcell ("Thursday 20 November 2026"),
        navigating months when the target is not in view. Past
        dates are disabled and are never clicked.
     5. Times — a combobox opens a listbox of 96 options
        (00:00–23:45 in 15-minute steps); set by clicking one.
     6. Time zone — a combobox opens a listbox of IANA options
        ("America/New_York Eastern Time (EST)"). There are TWO
        identically-named "Time zone" comboboxes (start row first,
        end row second) — identified by DOM order, never by name.
     7. Verify AFTER blur: a date combobox's visible text goes
        blank while focused even though its value is still set,
        so every value is read back only after blurring.

   Plain text fields (name, description, price, ticket link) are
   still set the React-safe way (native value setter + dispatched
   input/change events) by fillEventForm. Nothing here submits,
   creates, or publishes anything; it only fills fields the user
   asked it to fill, and the user reviews and submits the form.

   Works as a classic content script (window.ShiftShiftFill) and as
   a Node module (module.exports) for the unit tests. */

(function (root) {
  "use strict";

  var FIELD_KINDS = ["name", "startDate", "endDate", "startTime", "endTime", "timezone", "location", "description", "price", "link"];
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  /* The event fields, as the form sees them. Times are formatted per
     input type: native date/time inputs take ISO ("2026-11-21",
     "17:30"); plain text inputs take the locale form Facebook's
     composer parses ("11/21/2026", "5:30 PM"). The timezone is the
     event's own tz when it carries one, else EST — the studio's
     zone (America/Indiana/Indianapolis). */
  function valueFor(kind, event, inputType) {
    var ev = event || {};
    switch (kind) {
      case "name": return ev.title || "";
      case "location": return ev.location || "";
      case "description": return ev.description || "";
      case "price": return ev.price || "";
      case "link": return ev.link || "";
      case "timezone": return ev.timezone || ev.tz || "EST";
      case "startDate": return formatDate(ev.date, inputType);
      case "endDate": return formatDate(ev.endDate || ev.date, inputType);
      case "startTime": return formatTime(ev.startTime, inputType);
      case "endTime": return formatTime(ev.endTime, inputType);
      default: return "";
    }
  }

  function formatDate(dateStr, inputType) {
    if (!dateStr) return "";
    if (inputType === "date") return dateStr; /* YYYY-MM-DD already */
    var p = String(dateStr).split("-");
    if (p.length !== 3) return dateStr;
    return (+p[1]) + "/" + (+p[2]) + "/" + p[0];
  }

  function formatTime(timeStr, inputType) {
    if (!timeStr) return "";
    if (inputType === "time") return timeStr; /* HH:MM already */
    var p = String(timeStr).split(":");
    if (p.length < 2) return timeStr;
    var h = +p[0], m = p[1];
    var ap = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return h + ":" + m + " " + ap;
  }

  /* "2026-11-24" -> { y: 2026, m: 11, d: 24 }. */
  function parseDateParts(dateStr) {
    var p = String(dateStr || "").split("-");
    return { y: +p[0], m: +p[1], d: +p[2] };
  }

  /* ---------- Small DOM helpers (real DOM and the test mock) ---------- */

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /* Poll fn until it returns a truthy value, or the timeout. The
     truthy value is returned, so waitFor doubles as "find it when
     it appears". */
  function waitFor(fn, timeoutMs, intervalMs) {
    var deadline = Date.now() + (timeoutMs || 2000);
    var interval = intervalMs || 60;
    function check() {
      var v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return Promise.resolve(v);
      if (Date.now() >= deadline) return Promise.resolve(null);
      return sleep(interval).then(check);
    }
    return check();
  }

  function q(rootNode, sel) {
    try {
      var found = rootNode.querySelectorAll ? rootNode.querySelectorAll(sel) : [];
      return Array.prototype.slice.call(found);
    } catch (e) { return []; }
  }

  function parentOf(el) {
    try { return el.parentElement || el.parentNode || el.parent || null; }
    catch (e) { return null; }
  }

  function getAttr(el, name) {
    try { return el.getAttribute ? el.getAttribute(name) : null; }
    catch (e) { return null; }
  }

  function elementText(el) {
    try { return (el.textContent || "").trim(); } catch (e) { return ""; }
  }

  /* What the control calls itself: aria-label first (Facebook's
     comboboxes carry their label there), then placeholder, then
     visible text. */
  function accessibleName(el) {
    var a = getAttr(el, "aria-label");
    if (a) return String(a).trim();
    var p = getAttr(el, "placeholder");
    if (p) return String(p).trim();
    return elementText(el);
  }

  function isInside(el, ancestor) {
    var cur = parentOf(el), depth = 0;
    while (cur && depth <= 10) {
      if (cur === ancestor) return true;
      cur = parentOf(cur);
      depth++;
    }
    return false;
  }

  function isAlreadyPicked(el) {
    try {
      if (el.checked) return true;
      var a = el.getAttribute ? el.getAttribute("aria-checked") : null;
      if (a === "true") return true;
      a = el.getAttribute ? el.getAttribute("aria-pressed") : null;
      if (a === "true") return true;
    } catch (e) { /* unreadable */ }
    return false;
  }

  function clickEl(el) {
    try {
      if (el.disabled) return false;
      if (typeof el.click === "function") el.click();
      return true;
    } catch (e) { return false; }
  }

  function blurEl(el) {
    try { if (el && typeof el.blur === "function") el.blur(); } catch (e) { /* no blur */ }
  }

  /* ---------- Plain text fields (fillEventForm) ---------- */

  /* What the field calls itself: aria-label, placeholder, name, id,
     and the text of any <label> for it. One string, lower-cased. */
  function fieldText(rootNode, field) {
    var parts = [];
    function attr(name) {
      try {
        var v = field.getAttribute ? field.getAttribute(name) : null;
        if (v) parts.push(v);
      } catch (e) { /* attribute unreadable */ }
    }
    attr("aria-label");
    attr("placeholder");
    attr("name");
    attr("id");
    if (field.labels) {
      for (var i = 0; i < field.labels.length; i++) {
        if (field.labels[i] && field.labels[i].textContent) parts.push(field.labels[i].textContent);
      }
    }
    try {
      var wrap = field.closest ? field.closest("label") : null;
      if (wrap && wrap.textContent) parts.push(wrap.textContent);
    } catch (e) { /* closest unsupported */ }
    try {
      if (field.id && rootNode && rootNode.querySelector) {
        var byFor = rootNode.querySelector('label[for="' + field.id + '"]');
        if (byFor && byFor.textContent) parts.push(byFor.textContent);
      }
    } catch (e) { /* selector unsupported */ }
    return parts.join(" ").toLowerCase();
  }

  /* Which event field this form field is, or null. Most specific
     first: "start date" before "date", "end time" before "time". */
  function matchFieldKind(rootNode, field) {
    var tag = (field.tagName || "").toLowerCase();
    var type = (field.type || "").toLowerCase();
    if (tag === "select") return null;
    if (type === "hidden" || type === "submit" || type === "button" ||
        type === "checkbox" || type === "radio" || type === "file" ||
        type === "password") return null;
    if (field.disabled) return null;
    var text = fieldText(rootNode, field);
    if (!text) {
      /* Unlabeled native pickers: a bare date/time input is still a
         date/time field — the caller claims first as start, second
         as end. */
      if (type === "date") return "date";
      if (type === "time") return "time";
      return null;
    }
    if (/\bevent\s*name\b|\bevent\s*title\b|^\s*name\s*$|\bname\s*of\s*event\b/.test(text)) return "name";
    if (/\bstart\s*date\b|\bfrom\s*date\b|\bbegin.*date\b|\bstart\s*day\b/.test(text)) return "startDate";
    if (/\bend\s*date\b|\bto\s*date\b|\buntil.*date\b|\bend\s*day\b/.test(text)) return "endDate";
    if (/\bevent\s*date\b|^\s*date\s*$/.test(text)) return "date";
    if (type === "date") return "date";
    /* Timezone FIRST, before every time rule: a field labeled
       "Time zone" is not a time — without this it hits the generic
       time rule, claims a time slot, and gets a time value (the
       Nov 19 mis-fill: "8:10 PM" in the Start row's Time zone). */
    if (/\btime\s*zone\b|\btimezone\b/.test(text)) return "timezone";
    if (/\bstart\s*time\b|\bfrom\s*time\b|\bbegin.*time\b|\bstart\s*at\b/.test(text)) return "startTime";
    if (/\bend\s*time\b|\bto\s*time\b|\buntil.*time\b|\bend\s*at\b/.test(text)) return "endTime";
    if (/\btime\b/.test(text) && !/\btime\s*zone\b|\btimezone\b/.test(text)) return "time";
    if (type === "time") return "time";
    if (/\blocation\b|\bvenue\b|\bwhere\b|\baddress\b/.test(text)) return "location";
    if (/\bdescription\b|\bdetails\b|\babout\b|\bevent\s*details\b/.test(text)) return "description";
    if (/\bprice\b|\bcost\b|\bticket\s*price\b|\badmission\b/.test(text)) return "price";
    if (/\bticket\b|\bregistration\b|\bsign.?up\b|\bwebsite\b|\burl\b|\blink\b/.test(text)) return "link";
    return null;
  }

  /* Set a value the way React (and other frameworks) notice: the
     native value setter, then bubbled input + change events. A plain
     el.value = x leaves React's tracked value stale and the form
     submits the old value. */
  function setFieldValue(el, value) {
    var win = null;
    try {
      win = el.ownerDocument && el.ownerDocument.defaultView;
    } catch (e) { win = null; }
    var tag = (el.tagName || "").toLowerCase();
    var proto = null;
    if (win) {
      if (tag === "textarea" && win.HTMLTextAreaElement) proto = win.HTMLTextAreaElement.prototype;
      else if (tag === "select" && win.HTMLSelectElement) proto = win.HTMLSelectElement.prototype;
      else if (win.HTMLInputElement) proto = win.HTMLInputElement.prototype;
    }
    var setter = null;
    if (proto) {
      var desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && typeof desc.set === "function") setter = desc.set;
    }
    if (setter) setter.call(el, value);
    else el.value = value;
    var EventCtor = (win && win.Event) || (typeof Event !== "undefined" ? Event : null);
    if (EventCtor && el.dispatchEvent) {
      el.dispatchEvent(new EventCtor("input", { bubbles: true }));
      el.dispatchEvent(new EventCtor("change", { bubbles: true }));
    }
  }

  /* Is this field a combobox (type-to-search, suggestions in a
     listbox) rather than a plain text field? Facebook's location
     field is one: setting its value alone opens the suggestions
     but never picks one, so the form keeps the typed text without
     a selected place. The caller resolves it after a settle via
     pickLocationSuggestion. */
  function isComboboxField(field) {
    try {
      var role = field.getAttribute ? field.getAttribute("role") : null;
      if (role === "combobox") return true;
      if (field.getAttribute && (field.getAttribute("aria-autocomplete") || field.getAttribute("aria-controls"))) return true;
    } catch (e) { /* unreadable */ }
    return false;
  }

  /* Is this field the inner input of a combobox container — e.g.
     Facebook's location search box inside the "Add location"
     combobox? Its value is owned by the combobox flow (type, then
     pick a suggestion); the plain fill must not claim it as a
     filled location just for holding typed text. */
  function isInsideCombobox(field) {
    var cur = parentOf(field), depth = 0;
    while (cur && depth <= 6) {
      if (getAttr(cur, "role") === "combobox") return true;
      cur = parentOf(cur);
      depth++;
    }
    return false;
  }

  /* Fill every plain field this form has for the event. Returns
     { filled: [{ kind, value }], missing: [kinds] } — filled kinds
     the form had a field for, missing kinds the event has but the
     form does not. "date"/"time" (a single field, or an unlabeled
     picker) claims start first, then end. Combobox fields are
     NOT filled here: a date/time/timezone combobox must be set by
     clicking its portal option, never by typing, and a location
     combobox only counts once a suggestion is picked — both are
     driven by fillFacebookForm. */
  function fillEventForm(rootNode, event) {
    var filled = [];
    var filledKinds = {};
    var combobox = null;
    var fields = q(rootNode, "input, textarea, select");
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      var kind = matchFieldKind(rootNode, field);
      if (!kind) continue;
      if (kind === "date") kind = filledKinds.startDate ? "endDate" : "startDate";
      if (kind === "time") kind = filledKinds.startTime ? "endTime" : "startTime";
      /* Timezone is the same value on every row (start row, end
         row) — it fills every timezone field, not just the first. */
      if (filledKinds[kind] && kind !== "timezone") continue;
      /* Never type into a combobox: dates, times, and timezones
         are set by clicking their portal options, and an inner
         input of a combobox belongs to that flow too. */
      if (isInsideCombobox(field)) continue;
      if (isComboboxField(field) && (kind === "startDate" || kind === "endDate" ||
          kind === "startTime" || kind === "endTime" || kind === "timezone")) continue;
      var value = valueFor(kind, event, (field.type || "").toLowerCase());
      if (!value) continue;
      setFieldValue(field, value);
      filledKinds[kind] = true;
      filled.push({ kind: kind, value: value });
      /* A combobox needs a second step (pick the suggestion) once
         it renders — record it so the caller can resolve it. */
      if (kind === "location" && !combobox && isComboboxField(field)) {
        combobox = { kind: "location", value: value };
      }
    }
    var missing = [];
    FIELD_KINDS.forEach(function (kind) {
      if (filledKinds[kind]) return;
      /* The "EST" timezone is a fill fallback, not event data —
         only report timezone missing when the event carries an
         explicit tz the form has nowhere to put. */
      if (kind === "timezone" && !(event.timezone || event.tz)) return;
      if (valueFor(kind, event, "")) missing.push(kind);
    });
    return { filled: filled, missing: missing, combobox: combobox };
  }

  /* ---------- Combobox portals (Facebook) ---------- */

  /* All comboboxes whose accessible name matches re, in document
     order. DOM order is the identity for duplicate names: the
     first "Time zone" combobox is the start row, the second is
     the end row. */
  function comboboxes(rootNode, re) {
    return q(rootNode, "[role='combobox']").filter(function (el) {
      return re.test(accessibleName(el));
    });
  }

  /* The portals currently open: listboxes, and the calendar dialog
     (a dialog holding gridcells — the form dialog itself holds
     none). */
  function listboxPortals(rootNode) {
    return q(rootNode, "[role='listbox']");
  }

  function calendarOpen(rootNode) {
    var cells = q(rootNode, "[role='gridcell']");
    if (!cells.length) return null;
    var dialog = null;
    var cur = parentOf(cells[0]), depth = 0;
    while (cur && depth <= 6) {
      if (getAttr(cur, "role") === "dialog") { dialog = cur; break; }
      cur = parentOf(cur);
      depth++;
    }
    return { dialog: dialog, cells: cells };
  }

  /* The option rows of the listbox currently open. When no listbox
     is open, fall back to every option in the document — a portal
     that renders its options without a listbox wrapper still gets
     picked. */
  function optionsInOpenListbox(rootNode) {
    var boxes = listboxPortals(rootNode);
    var all = q(rootNode, "[role='option'], [role='menuitemradio'], [role='menuitem']");
    if (!boxes.length) return all;
    var out = [];
    for (var i = 0; i < all.length; i++) {
      for (var j = 0; j < boxes.length; j++) {
        if (isInside(all[i], boxes[j])) { out.push(all[i]); break; }
      }
    }
    return out;
  }

  /* Click a combobox and wait for its portal (listbox or calendar)
     to actually appear. The popup can close on its own while
     aria-expanded still says true, so aria-expanded is never
     trusted — a portal present in the DOM is the only signal.
     A portal left open by a failed earlier pick belongs to another
     combobox, so it is never trusted either: this combo is always
     clicked, which closes the stale portal and opens the right
     one (that is how the live form behaves). Retries the click
     when nothing appears. Returns the portal kind
     ("listbox" | "calendar") or null. */
  function openCombobox(rootNode, combo, opts) {
    var attempts = 0;
    function once() {
      attempts++;
      clickEl(combo);
      return waitFor(function () {
        if (listboxPortals(rootNode).length) return "listbox";
        if (calendarOpen(rootNode)) return "calendar";
        return null;
      }, opts.portalTimeoutMs, 80).then(function (portal) {
        if (portal) return portal;
        if (attempts < 3) return once();
        return null;
      });
    }
    return once();
  }

  /* What a combobox currently shows: its own value when it is an
     input, else its inner input's value when it has one, else its
     visible text. Read only AFTER blur — a date combobox's text
     goes blank while focused even though its value is still set. */
  function innerInputOf(rootNode, combo) {
    var inputs = q(rootNode, "input, textarea");
    for (var i = 0; i < inputs.length; i++) {
      if (isInside(inputs[i], combo)) return inputs[i];
    }
    return null;
  }

  function displayedValue(rootNode, el) {
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return String(el.value || "").trim();
    var inner = innerInputOf(rootNode, el);
    if (inner && inner.value) return String(inner.value).trim();
    return elementText(el);
  }

  function verifyDateShown(rootNode, combo, dateStr) {
    var shown = displayedValue(rootNode, combo);
    var parts = parseDateParts(dateStr);
    return shown.indexOf(String(parts.d)) >= 0 &&
      shown.toLowerCase().indexOf(MONTH_NAMES[parts.m - 1].toLowerCase()) >= 0;
  }

  function verifyTimeShown(rootNode, combo, timeStr) {
    var shown = displayedValue(rootNode, combo).toLowerCase();
    return shown.indexOf(timeStr.toLowerCase()) >= 0 ||
      shown.indexOf(formatTime(timeStr, "text").toLowerCase()) >= 0;
  }

  /* How well an option's text matches the wanted timezone: an
     IANA id ("America/New_York") matching the option's start wins;
     an abbreviation ("EST") matches "(EST)" — preferring the
     New_York option, the canonical Eastern pick. */
  function timezoneScore(text, tz) {
    var t = String(text || "").toLowerCase();
    var z = String(tz || "").trim();
    if (!z) return 0;
    if (z.indexOf("/") >= 0) {
      if (t.indexOf(z.toLowerCase()) === 0) return 3;
      if (t.indexOf(z.toLowerCase()) >= 0) return 2;
      return 0;
    }
    if (t.indexOf("(" + z.toLowerCase() + ")") >= 0) {
      if (t.indexOf("new_york") >= 0) return 2;
      return 1;
    }
    return 0;
  }

  function verifyTimezoneShown(rootNode, combo, tz) {
    return timezoneScore(displayedValue(rootNode, combo), tz) > 0;
  }

  /* Pick a date by clicking its gridcell ("Thursday 20 November
     2026"). When the target month is not in view, click Previous /
     Next Month toward it (at most 12 steps). A disabled gridcell —
     a past date — is never clicked. Returns what was picked, or
     null when the day is not pickable. */
  function pickCalendarDay(rootNode, combo, dateStr, opts) {
    var parts = parseDateParts(dateStr);
    return openCombobox(rootNode, combo, opts).then(function (portal) {
      if (portal !== "calendar") return null;
      var nav = 0;
      function step() {
        var cal = calendarOpen(rootNode);
        if (!cal) return Promise.resolve(null);
        for (var i = 0; i < cal.cells.length; i++) {
          var cell = cal.cells[i];
          if (cell.disabled) continue;
          var name = accessibleName(cell);
          var re = new RegExp("\\b" + parts.d + "\\s+" + MONTH_NAMES[parts.m - 1] + "\\s+" + parts.y + "\\b", "i");
          if (re.test(name)) {
            if (!clickEl(cell)) return Promise.resolve(null);
            return Promise.resolve({ how: "gridcell", value: name });
          }
        }
        /* Same month in view but the day is not there (a past or
           missing day): there is nowhere to navigate to. */
        var shown = calendarMonth(cal.dialog);
        if (!shown) return Promise.resolve(null);
        var dir = (parts.y * 12 + parts.m) - (shown.y * 12 + shown.m);
        if (dir === 0 || nav >= 12) return Promise.resolve(null);
        var btn = findNavButton(rootNode, cal.dialog, dir > 0 ? "next" : "prev");
        if (!btn) return Promise.resolve(null);
        nav++;
        clickEl(btn);
        return sleep(opts.settleMs).then(step);
      }
      return step();
    });
  }

  /* "November 2026" from the calendar dialog's header text. */
  function calendarMonth(dialog) {
    if (!dialog) return null;
    var text = elementText(dialog);
    for (var i = 0; i < MONTH_NAMES.length; i++) {
      var m = text.match(new RegExp("\\b" + MONTH_NAMES[i] + "\\s+(\\d{4})\\b", "i"));
      if (m) return { y: +m[1], m: i + 1 };
    }
    return null;
  }

  function findNavButton(rootNode, dialog, dir) {
    var re = dir === "next" ? /next\s*month/i : /previous\s*month/i;
    var btns = q(rootNode, "button");
    for (var i = 0; i < btns.length; i++) {
      if (!re.test(accessibleName(btns[i]))) continue;
      if (!dialog || isInside(btns[i], dialog)) return btns[i];
    }
    return null;
  }

  /* Pick a time by clicking its listbox option. Options are
     "00:00"–"23:45" in 15-minute steps; a 12-hour rendering
     ("7:30 PM") matches too. */
  function pickTimeOption(rootNode, combo, timeStr, opts) {
    return openCombobox(rootNode, combo, opts).then(function (portal) {
      if (portal !== "listbox") return null;
      var options = optionsInOpenListbox(rootNode);
      var twelve = formatTime(timeStr, "text").toLowerCase();
      for (var i = 0; i < options.length; i++) {
        var text = accessibleName(options[i]).toLowerCase();
        if (text !== timeStr.toLowerCase() && text !== twelve) continue;
        if (options[i].disabled) continue;
        if (clickEl(options[i])) return { how: "option", value: timeStr };
      }
      return null;
    });
  }

  /* Pick a timezone by clicking its listbox option — the best
     IANA/abbreviation match, never a near miss. */
  function pickTimezoneOption(rootNode, combo, tz, opts) {
    return openCombobox(rootNode, combo, opts).then(function (portal) {
      if (portal !== "listbox") return null;
      var options = optionsInOpenListbox(rootNode);
      var best = null, bestScore = 0;
      for (var i = 0; i < options.length; i++) {
        if (options[i].disabled) continue;
        var score = timezoneScore(accessibleName(options[i]), tz);
        if (score > bestScore) { bestScore = score; best = options[i]; }
      }
      if (!best) return null;
      if (clickEl(best)) return { how: "option", value: accessibleName(best) };
      return null;
    });
  }

  /* Does the combobox show exactly this choice? An exact match —
     the combobox's initial text IS the question ("Is it in person
     or virtual?"), which contains "in person", so a substring
     check would report it already picked without any click. */
  function ipvShown(rootNode, combo, target) {
    return displayedValue(rootNode, combo).trim().toLowerCase() === target;
  }

  /* Pick the in-person/virtual option from the combobox's portal
     listbox. Verifies the combobox shows the choice afterwards;
     when the popup closed on its own without a pick, the open is
     retried (up to 3). Returns what was picked, or null. */
  function pickInPersonVirtualCombo(rootNode, combo, event, opts) {
    var target = isVirtualEvent(event) ? "virtual" : "in person";
    if (ipvShown(rootNode, combo, target)) {
      return Promise.resolve({ how: "portal", value: target, already: true });
    }
    var attempts = 0;
    function once() {
      attempts++;
      return openCombobox(rootNode, combo, opts).then(function (portal) {
        if (portal !== "listbox") return attempts < 3 ? once() : null;
        var options = optionsInOpenListbox(rootNode);
        for (var i = 0; i < options.length; i++) {
          if (accessibleName(options[i]).toLowerCase() !== target) continue;
          if (isAlreadyPicked(options[i])) return { how: "portal", value: target, already: true };
          if (!clickEl(options[i])) return null;
          return sleep(opts.settleMs).then(function () {
            if (ipvShown(rootNode, combo, target)) {
              return { how: "portal", value: target };
            }
            /* The popup closed without the pick sticking — open
               again and try once more. */
            return attempts < 3 ? once() : null;
          });
        }
        return attempts < 3 ? once() : null;
      });
    }
    return once();
  }

  /* Pick the location suggestion for a combobox field, after the
     value was typed and the suggestions rendered (usually a
     listbox in a portal). The suggestion is longer than the typed
     text (it adds the zip / country), so match on the typed
     location's first segment — the street part — not on equality.
     Only real suggestion rows ([role=option]/[role=menuitem]) are
     considered, never an arbitrary button. Returns what was
     clicked, or null. Never submits. */
  function pickLocationSuggestion(rootNode, event) {
    var loc = String((event && event.location) || "").trim();
    if (!loc) return null;
    var first = loc.split(",")[0].trim().toLowerCase();
    var options = q(rootNode, "[role='option'], [role='menuitem']");
    var best = null, bestScore = 0;
    for (var i = 0; i < options.length; i++) {
      var el = options[i];
      var text = elementText(el).toLowerCase();
      if (!text) continue;
      var score = 0;
      if (text === loc.toLowerCase()) score = 4;
      else if (text.indexOf(loc.toLowerCase()) === 0) score = 3;
      else if (loc.toLowerCase().indexOf(text) === 0 && text.length >= 4) score = 2;
      else if (first.length >= 4 && text.indexOf(first) >= 0) score = 1;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    if (!best) return null;
    if (isAlreadyPicked(best)) return { how: "suggestion", value: elementText(best), already: true };
    if (clickEl(best)) return { how: "suggestion", value: elementText(best) };
    return null;
  }

  /* Did the place actually bind? The combobox's text holds the
     picked place; failing that, the displayed value must be longer
     than the typed text — a bound suggestion adds city/zip/country,
     while typed text alone is exactly what was typed. */
  function locationStuck(rootNode, combo, loc) {
    var first = loc.split(",")[0].trim().toLowerCase();
    if (elementText(combo).toLowerCase().indexOf(first) >= 0) return true;
    var shown = displayedValue(rootNode, combo);
    return shown.toLowerCase().indexOf(first) >= 0 && shown.length > loc.length;
  }

  /* The location flow: click the "Add location" combobox, type the
     address into its inner input, wait for the suggestions, pick
     the best text match, and verify it stuck — the combobox must
     show the place, not just the typed text. Returns what was
     picked, or null when no suggestion bound the place. */
  function fillLocationCombo(rootNode, combo, event, opts) {
    var loc = String((event && event.location) || "").trim();
    if (!loc) return Promise.resolve(null);
    clickEl(combo);
    return sleep(opts.settleMs).then(function () {
      var input = innerInputOf(rootNode, combo);
      if (input) setFieldValue(input, loc);
      else if ((combo.tagName || "").toLowerCase() === "input") setFieldValue(combo, loc);
      return waitFor(function () {
        var options = optionsInOpenListbox(rootNode);
        return options.length ? options : null;
      }, opts.portalTimeoutMs, 80);
    }).then(function (options) {
      if (!options) return null;
      var picked = pickLocationSuggestion(rootNode, event);
      if (!picked) return null;
      return sleep(opts.settleMs).then(function () {
        if (locationStuck(rootNode, combo, loc)) return { how: "suggestion", value: displayedValue(rootNode, combo) };
        return null;
      });
    });
  }

  /* ---------- Optional fields: revealers + in-person/virtual ---------- */

  /* Expanders that reveal hidden end-date/time fields, e.g.
     Facebook's "+ End date and time" button (accessible name
     "Add end date and time"). Only the expanders whose text matches
     one of these — never a field itself. */
  var END_EXPANDER_RE = /add\s+(an?\s+)?end(\s+date|\s+time)?|end\s+date\s+and\s*time|show\s+end(\s+date|\s+time)?|set\s+end(\s+date|\s+time)?/i;
  var IN_PERSON_VIRTUAL_RE = /in\s+person\s+or\s+virtual/i;

  /* Is this event virtual/online? An explicit flag wins; else the
     location says so (a URL, or online/virtual/Zoom/Meet wording).
     Anything else — a street address, a venue name — is in-person. */
  function isVirtualEvent(event) {
    var ev = event || {};
    if (ev.virtual === true || ev.isVirtual === true) return true;
    var fmt = String(ev.format || ev.eventFormat || "").toLowerCase();
    if (/\bvirtual\b|\bonline\b/.test(fmt)) return true;
    var loc = String(ev.location || "").toLowerCase();
    if (/^https?:\/\//.test(loc)) return true;
    if (/\bvirtual\b|\bonline\b|\bzoom\b|\bgoogle\s*meet\b|\bms\s*teams\b|\bteams\s*meeting\b/.test(loc)) return true;
    return false;
  }

  /* Does this element (or an ancestor, up to 3 levels) sit inside a
     group labeled with the given pattern — e.g. the "Is it in person
     or virtual?" question wrapping its two options. */
  function inLabeledGroup(el, re) {
    var cur = el, depth = 0;
    while (cur && depth <= 3) {
      var text = "";
      try { text = cur.textContent || ""; } catch (e) { text = ""; }
      if (re.test(text)) return true;
      cur = cur.parentNode || cur.parent || null;
      depth++;
    }
    return false;
  }

  /* Set the in-person/virtual control to match the event, and
     return { how, value } — or null when the form has no such
     control. Handles a <select> with both options, and clickable
     options ("In person" / "Virtual" buttons or radios) inside the
     "Is it in person or virtual?" group. Never clicks anything
     outside that group. The combobox case is handled by
     pickInPersonVirtualCombo (the Facebook flow); this is the
     fallback for forms with native controls. */
  function setInPersonVirtual(rootNode, event) {
    var target = isVirtualEvent(event) ? "virtual" : "in person";
    /* 1) A <select> whose options include both choices. */
    var selects = q(rootNode, "select");
    for (var i = 0; i < selects.length; i++) {
      var sel = selects[i];
      var opts = sel.options || [];
      var match = null, hasOther = false;
      for (var j = 0; j < opts.length; j++) {
        var t = String((opts[j].text || opts[j].textContent || "")).trim().toLowerCase();
        if (t === target) match = opts[j];
        if (t === "in person" || t === "virtual") hasOther = true;
      }
      if (!match || !hasOther) continue;
      var labelled = false;
      try {
        var a = sel.getAttribute ? (sel.getAttribute("aria-label") || sel.getAttribute("name") || sel.getAttribute("id") || "") : "";
        labelled = /in\s*person|virtual|format|event\s*type/i.test(a);
      } catch (e) { labelled = false; }
      if (!labelled && !inLabeledGroup(sel, IN_PERSON_VIRTUAL_RE)) continue;
      if (sel.value === match.value) return { how: "select", value: target, already: true };
      setFieldValue(sel, match.value);
      return { how: "select", value: target };
    }
    /* 2) Clickable options inside the labeled group. */
    var clickables = q(rootNode, "button, [role='radio'], [role='button'], label");
    for (var k = 0; k < clickables.length; k++) {
      var el = clickables[k];
      if (elementText(el).toLowerCase() !== target) continue;
      if (!inLabeledGroup(el, IN_PERSON_VIRTUAL_RE)) continue;
      if (isAlreadyPicked(el)) return { how: "click", value: target, already: true };
      if (clickEl(el)) return { how: "click", value: target };
    }
    /* 3) Portal options: Facebook renders the choices in a React
       portal elsewhere in the DOM, outside the question's group —
       so the in-group search above finds nothing. Open the trigger
       first (the button/combobox carrying the question itself);
       the caller then picks the option document-wide once it
       renders (pickPortalOption). */
    var triggers = q(rootNode, "button, [role='button'], [role='combobox'], [role='listbox'], div, span");
    for (var m = 0; m < triggers.length; m++) {
      var tr = triggers[m];
      var tt = elementText(tr);
      if (!IN_PERSON_VIRTUAL_RE.test(tt)) continue;
      if (tt.length > 80) continue; /* a big container merely containing the question */
      if (clickEl(tr)) return { how: "open-trigger", value: target, pending: true };
    }
    return null;
  }

  /* Pick the in-person/virtual option from a portal listbox, after
     the trigger was opened and the options rendered document-wide.
     Exact text only — never a near match. Returns what was picked,
     or null when no such option exists yet. */
  function pickPortalOption(rootNode, event) {
    var target = isVirtualEvent(event) ? "virtual" : "in person";
    var clicked = [];
    var options = q(rootNode, "[role='option'], [role='menuitemradio'], [role='menuitem'], button, label");
    for (var i = 0; i < options.length; i++) {
      var el = options[i];
      if (elementText(el).toLowerCase() !== target) continue;
      /* Skip an option nested inside one already clicked (an inner
         span and its button would otherwise double-click). */
      var nested = false;
      for (var j = 0; j < clicked.length; j++) {
        var cur = el.parentNode || el.parent || null, depth = 0;
        while (cur && depth <= 4) {
          if (cur === clicked[j]) { nested = true; break; }
          cur = cur.parentNode || cur.parent || null;
          depth++;
        }
        if (nested) break;
      }
      if (nested) continue;
      if (isAlreadyPicked(el)) return { how: "portal", value: target, already: true };
      if (clickEl(el)) { clicked.push(el); return { how: "portal", value: target }; }
    }
    return null;
  }

  /* Was this element already clicked (or is it inside one that
     was)? A button and its inner span both match the expander
     text — clicking both would toggle the section open then shut
     again. Only the outermost match gets the click. */
  function isInsideClicked(el, clicked) {
    for (var j = 0; j < clicked.length; j++) {
      var cur = el.parentNode || el.parent || null, depth = 0;
      while (cur && depth <= 4) {
        if (cur === clicked[j]) return true;
        cur = cur.parentNode || cur.parent || null;
        depth++;
      }
    }
    return false;
  }

  /* Click the end-date/time expanders only — the part of the
     reveal that must run FIRST, before any end value is set,
     because expanding auto-fills the end defaults. */
  function clickEndExpanders(rootNode, event) {
    var ev = event || {};
    var out = [];
    if (!(ev.endTime || ev.endDate)) return out;
    var clickables = q(rootNode, "button, a, [role='button'], [tabindex], div, span");
    /* querySelectorAll returns document order (parents first), so
       the outermost match is clicked and its inner spans are
       skipped by isInsideClicked below. */
    var clicked = [];
    for (var i = 0; i < clickables.length; i++) {
      var el = clickables[i];
      var text = elementText(el);
      /* Short text only: a big container whose textContent merely
         contains "End date and time" somewhere inside is not the
         expander. */
      if (text.length > 80) continue;
      if (!END_EXPANDER_RE.test(text)) continue;
      if (isInsideClicked(el, clicked)) continue;
      if (clickEl(el)) { clicked.push(el); out.push(text); }
    }
    return out;
  }

  /* Reveal the form's optional fields before filling, clicking only
     what the event data calls for — and nothing else. An end-date
     expander is clicked only when the event has an end date/time;
     the in-person/virtual control is set to match the event.
     Returns { expanders: [clicked texts], inPersonVirtual }.
     The caller waits for the revealed fields to appear (the
     content script watches for DOM changes) and then fills. */
  function revealOptionalFields(rootNode, event) {
    var ev = event || {};
    var out = { expanders: [], inPersonVirtual: null };
    out.expanders = clickEndExpanders(rootNode, ev);
    try { out.inPersonVirtual = setInPersonVirtual(rootNode, ev); } catch (e) { out.inPersonVirtual = null; }
    return out;
  }

  /* ---------- The Facebook driver ---------- */

  /* Fill the live Facebook Create event form (and degrade to the
     plain-field + native-control paths on other forms). Runs the
     steps in the order the form demands — expand first, then the
     in-person/virtual choice (the location field only appears
     after "In person"), then location, dates, times, timezones —
     clicking each portal option and verifying the value stuck
     after a blur. Returns a Promise of
     { filled: [{ kind, value }], missing: [kinds] }. Never
     submits. */
  function fillFacebookForm(rootNode, event, opts) {
    var o = opts || {};
    var options = {
      settleMs: o.settleMs != null ? o.settleMs : 150,
      portalTimeoutMs: o.portalTimeoutMs != null ? o.portalTimeoutMs : 2500,
    };
    var ev = event || {};
    var filled = [];
    var filledKinds = {};
    function mark(kind, value) {
      if (filledKinds[kind]) return;
      filledKinds[kind] = true;
      filled.push({ kind: kind, value: value });
    }
    var virtual = isVirtualEvent(ev);
    var hasEnd = !!(ev.endTime || ev.endDate);
    var chain = Promise.resolve();

    /* 0) Plain text fields (name, description, price, link, and
       any native inputs the form still has). */
    try {
      var plain = fillEventForm(rootNode, ev);
      plain.filled.forEach(function (f) { mark(f.kind, f.value); });
    } catch (e) { /* the combobox steps below still run */ }

    /* 1) Expand the end section FIRST — the end defaults are
       auto-filled on expand, so every end value is set after. */
    chain = chain.then(function () {
      if (!hasEnd) return false;
      var expanders = clickEndExpanders(rootNode, ev);
      if (expanders.length) {
        return waitFor(function () {
          return comboboxes(rootNode, /end\s*date/i).length ? true : null;
        }, options.portalTimeoutMs, 80).then(function () { return true; });
      }
      return comboboxes(rootNode, /end\s*date/i).length > 0;
    });

    /* 2) In person / Virtual. The combobox flow first; the
       native-control fallback (select / in-group buttons / portal
       trigger) only when the form has no such combobox. */
    var expanded = false;
    chain = chain.then(function (wasExpanded) {
      expanded = wasExpanded;
      var combo = comboboxes(rootNode, /in\s*person\s+or\s*virtual/i)[0] || null;
      if (combo) return pickInPersonVirtualCombo(rootNode, combo, ev, options);
      var res = null;
      try { res = setInPersonVirtual(rootNode, ev); } catch (e) { res = null; }
      if (res && res.pending) {
        return sleep(options.settleMs).then(function () {
          try { pickPortalOption(rootNode, ev); } catch (e) { /* best effort */ }
          return res;
        });
      }
      return res;
    });

    /* 3) Location — only for in-person events, only after the
       choice above made the field appear. */
    chain = chain.then(function () {
      if (virtual || !ev.location) return;
      return waitFor(function () {
        var c = comboboxes(rootNode, /add\s*location|location/i);
        return c.length ? c[0] : null;
      }, options.portalTimeoutMs, 80).then(function (combo) {
        if (!combo) return;
        return fillLocationCombo(rootNode, combo, ev, options).then(function (res) {
          if (res) mark("location", res.value);
        });
      });
    });

    /* 4) Dates — start, then end (only when the end section was
       expanded). Set by clicking gridcells, never by typing. */
    function fillDate(kind, dateStr) {
      if (filledKinds[kind]) return Promise.resolve();
      var re = kind === "startDate" ? /start\s*date/i : /end\s*date/i;
      var combo = comboboxes(rootNode, re)[0] || null;
      if (!combo && kind === "startDate") {
        combo = comboboxes(rootNode, /date/i)[0] || null;
      }
      if (!combo) return Promise.resolve();
      return pickCalendarDay(rootNode, combo, dateStr, options).then(function (picked) {
        if (!picked) return;
        blurEl(combo);
        return sleep(options.settleMs).then(function () {
          if (verifyDateShown(rootNode, combo, dateStr)) mark(kind, dateStr);
        });
      });
    }
    chain = chain.then(function () {
      return fillDate("startDate", ev.date);
    });
    chain = chain.then(function () {
      if (!hasEnd || !expanded) return;
      return fillDate("endDate", ev.endDate || ev.date);
    });

    /* 5) Times — start, then end. Set by clicking a listbox
       option, never by typing. */
    function fillTime(kind, timeStr) {
      if (!timeStr || filledKinds[kind]) return Promise.resolve();
      var re = kind === "startTime" ? /start\s*time/i : /end\s*time/i;
      var combo = comboboxes(rootNode, re)[0] || null;
      if (!combo && kind === "startTime") {
        combo = comboboxes(rootNode, /time/i).filter(function (c) {
          return !/time\s*zone/i.test(accessibleName(c));
        })[0] || null;
      }
      if (!combo) return Promise.resolve();
      return pickTimeOption(rootNode, combo, timeStr, options).then(function (picked) {
        if (!picked) return;
        blurEl(combo);
        return sleep(options.settleMs).then(function () {
          if (verifyTimeShown(rootNode, combo, timeStr)) mark(kind, timeStr);
        });
      });
    }
    chain = chain.then(function () {
      return fillTime("startTime", ev.startTime);
    });
    chain = chain.then(function () {
      if (!hasEnd || !expanded) return;
      return fillTime("endTime", ev.endTime);
    });

    /* 6) Time zones — DOM order: the first "Time zone" combobox
       is the start row, the second is the end row. */
    chain = chain.then(function () {
      var tz = valueFor("timezone", ev, "text");
      var combos = comboboxes(rootNode, /time\s*zone/i);
      var step = Promise.resolve();
      if (combos[0] && !filledKinds.timezone) {
        step = step.then(function () {
          return pickTimezoneOption(rootNode, combos[0], tz, options).then(function (picked) {
            if (!picked) return;
            blurEl(combos[0]);
            return sleep(options.settleMs).then(function () {
              if (verifyTimezoneShown(rootNode, combos[0], tz)) mark("timezone", tz);
            });
          });
        });
      }
      if (combos[1] && hasEnd && expanded) {
        step = step.then(function () {
          return pickTimezoneOption(rootNode, combos[1], tz, options).then(function (picked) {
            if (!picked) return;
            blurEl(combos[1]);
            return sleep(options.settleMs).then(function () {
              /* The end row shares the event timezone; it only
                 needs the same value, so a verified pick there
                 does not add a second filled kind. */
              verifyTimezoneShown(rootNode, combos[1], tz);
            });
          });
        });
      }
      return step;
    });

    /* 7) Missing: every kind the event carries that did not get
       verified. A virtual event never needs a location field. */
    return chain.then(function () {
      var missing = [];
      FIELD_KINDS.forEach(function (kind) {
        if (filledKinds[kind]) return;
        if (kind === "timezone" && !(ev.timezone || ev.tz)) return;
        if (kind === "location" && virtual) return;
        if (valueFor(kind, ev, "")) missing.push(kind);
      });
      return { filled: filled, missing: missing };
    });
  }

  var api = {
    FIELD_KINDS: FIELD_KINDS,
    valueFor: valueFor,
    formatDate: formatDate,
    formatTime: formatTime,
    fieldText: fieldText,
    matchFieldKind: matchFieldKind,
    setFieldValue: setFieldValue,
    fillEventForm: fillEventForm,
    fillFacebookForm: fillFacebookForm,
    isVirtualEvent: isVirtualEvent,
    setInPersonVirtual: setInPersonVirtual,
    pickPortalOption: pickPortalOption,
    pickLocationSuggestion: pickLocationSuggestion,
    revealOptionalFields: revealOptionalFields,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ShiftShiftFill = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
