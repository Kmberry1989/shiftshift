/* Shift Shift Fill — field matching + fill logic.
   Pure module: given a form (any document-like root) and one event
   record, find the form's fields by label / aria-label / placeholder
   / name / id, and set them the React-safe way (native value setter
   + dispatched input/change events) so frameworks pick them up.
   Facebook's event composer is the first target; Wix event forms
   are matched the same way, by their labels — best-effort.
   Nothing here submits, creates, or publishes anything; it only
   fills fields the user asked it to fill.

   Works as a classic content script (window.ShiftShiftFill) and as a
   Node module (module.exports) for the unit tests. */

(function (root) {
  "use strict";

  var FIELD_KINDS = ["name", "startDate", "endDate", "startTime", "endTime", "timezone", "location", "description", "price", "link"];

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
      case "endDate": return formatDate(ev.date, inputType);
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

  /* Fill every field this form has for the event. Returns
     { filled: [{ kind, value }], missing: [kinds] } — filled kinds
     the form had a field for, missing kinds the event has but the
     form does not. "date"/"time" (a single field, or an unlabeled
     picker) claims start first, then end. */
  function fillEventForm(rootNode, event) {
    var filled = [];
    var filledKinds = {};
    var fields = [];
    try {
      fields = rootNode.querySelectorAll ? rootNode.querySelectorAll("input, textarea, select") : [];
    } catch (e) { fields = []; }
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      var kind = matchFieldKind(rootNode, field);
      if (!kind) continue;
      if (kind === "date") kind = filledKinds.startDate ? "endDate" : "startDate";
      if (kind === "time") kind = filledKinds.startTime ? "endTime" : "startTime";
      /* Timezone is the same value on every row (start row, end
         row) — it fills every timezone field, not just the first. */
      if (filledKinds[kind] && kind !== "timezone") continue;
      var value = valueFor(kind, event, (field.type || "").toLowerCase());
      if (!value) continue;
      setFieldValue(field, value);
      filledKinds[kind] = true;
      filled.push({ kind: kind, value: value });
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
    return { filled: filled, missing: missing };
  }

  /* ---------- Optional fields: revealers + in-person/virtual ---------- */

  /* Expanders that reveal hidden end-date/time fields, e.g.
     Facebook's "End date and time" button. Only the expanders whose
     text matches one of these — never a field itself. */
  var END_EXPANDER_RE = /add\s+end\s+date|add\s+end\s*time|end\s+date\s+and\s*time|show\s+end\s+date|show\s+end\s*time/i;
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

  function elementText(el) {
    try { return (el.textContent || "").trim(); } catch (e) { return ""; }
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

  /* Set the in-person/virtual control to match the event, and
     return { how, value } — or null when the form has no such
     control. Handles a <select> with both options, and clickable
     options ("In person" / "Virtual" buttons or radios) inside the
     "Is it in person or virtual?" group. Never clicks anything
     outside that group. */
  function setInPersonVirtual(rootNode, event) {
    var target = isVirtualEvent(event) ? "virtual" : "in person";
    var q = function (sel) {
      try { return rootNode.querySelectorAll ? rootNode.querySelectorAll(sel) : []; }
      catch (e) { return []; }
    };
    /* 1) A <select> whose options include both choices. */
    var selects = q("select");
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
    var clickables = q("button, [role='radio'], [role='button'], label");
    for (var k = 0; k < clickables.length; k++) {
      var el = clickables[k];
      if (elementText(el).toLowerCase() !== target) continue;
      if (!inLabeledGroup(el, IN_PERSON_VIRTUAL_RE)) continue;
      if (isAlreadyPicked(el)) return { how: "click", value: target, already: true };
      if (clickEl(el)) return { how: "click", value: target };
    }
    return null;
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
    if (ev.endTime || ev.endDate) {
      var clickables = [];
      try { clickables = rootNode.querySelectorAll ? rootNode.querySelectorAll("button, a, [role='button']") : []; }
      catch (e) { clickables = []; }
      for (var i = 0; i < clickables.length; i++) {
        var el = clickables[i];
        var text = elementText(el);
        if (!END_EXPANDER_RE.test(text)) continue;
        if (clickEl(el)) out.expanders.push(text);
      }
    }
    try { out.inPersonVirtual = setInPersonVirtual(rootNode, ev); } catch (e) { out.inPersonVirtual = null; }
    return out;
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
    isVirtualEvent: isVirtualEvent,
    setInPersonVirtual: setInPersonVirtual,
    revealOptionalFields: revealOptionalFields,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ShiftShiftFill = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
