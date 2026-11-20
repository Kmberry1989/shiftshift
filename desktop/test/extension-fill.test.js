"use strict";
/* Extension fill logic (extension/fill.js): field matching,
   formatters, React-safe value setting, whole-form fill. Uses a
   minimal fake DOM — no browser needed. Event records use the
   app's own shape: date "YYYY-MM-DD", startTime/endTime "HH:MM".
   The Facebook section at the bottom builds a faithful mock of
   the real Create event form (live diagnostic, Nov 19, 2026):
   no native controls, every field a role="combobox" whose options
   render in a portal after the dialog, duplicate Time zone
   comboboxes, end defaults auto-filled on expand, and a location
   that only binds when a suggestion is picked. */
const test = require("node:test");
const assert = require("node:assert/strict");

const { matchFieldKind, valueFor, formatDate, formatTime, setFieldValue, fillEventForm, fillFacebookForm, isVirtualEvent, setInPersonVirtual, pickPortalOption, pickLocationSuggestion, revealOptionalFields } = require("../../extension/fill.js");

class FakeEl {
  constructor({ tag = "INPUT", type = "text", attrs = {}, labelText = "", text = "", parent = null, onClick = null, options = null }) {
    this.tagName = tag;
    this.type = type;
    this._value = "";
    this.disabled = false;
    this._attrs = attrs;
    this.labels = labelText ? [{ textContent: labelText }] : [];
    /* textContent is a getter: a date combobox's visible text goes
       blank while focused (the live focus quirk) even though its
       value is still set — the mock reproduces it when
       _quirkBlank is set, so the fill must blur before verifying. */
    this._text = text;
    this._focused = false;
    this._quirkBlank = false;
    this.blurred = false;
    Object.defineProperty(this, "textContent", {
      get() { return this._focused && this._quirkBlank ? "" : this._text; },
      set(v) { this._text = String(v); },
      configurable: true,
    });
    this.parentNode = parent;
    this.parent = parent;
    this._onClick = onClick;
    this.clicked = false;
    this.options = options;
    this.events = [];
    /* Real DOM inputs coerce the assigned value to a string. */
    Object.defineProperty(this, "value", {
      get() { return this._value; },
      set(v) { this._value = String(v); },
      configurable: true,
    });
  }
  getAttribute(name) { return this._attrs[name] || null; }
  setAttribute(name, value) { this._attrs[name] = String(value); }
  closest() { return null; }
  focus() { this._focused = true; }
  blur() { this._focused = false; this.blurred = true; }
  click() {
    this.clicked = true;
    if (this._onClick) this._onClick();
  }
  dispatchEvent(e) { this.events.push(e.type); return true; }
}

function matchesPart(el, part) {
  part = part.trim();
  if (!part) return false;
  var m = part.match(/^([a-z]*)\[role='([^']+)'\]$/i);
  if (m) {
    var tagOk = !m[1] || el.tagName.toLowerCase() === m[1].toLowerCase();
    var role = el.getAttribute ? el.getAttribute("role") : null;
    return tagOk && role === m[2];
  }
  if (part.indexOf("[") >= 0) return false;
  return el.tagName.toLowerCase() === part.toLowerCase();
}

class FakeRoot {
  constructor(fields) { this._fields = fields; }
  querySelectorAll(selector) {
    var parts = String(selector).split(",");
    return this._fields.filter((el) => parts.some((p) => matchesPart(el, p)));
  }
  querySelector(selector) {
    var found = this.querySelectorAll(selector);
    return found.length ? found[0] : null;
  }
}

function el(opts) { return new FakeEl(opts); }
const kinds = (res) => res.filled.map((f) => f.kind);

const EVENT = {
  title: "Canvas Night",
  date: "2026-11-24",
  startTime: "17:30",
  endTime: "19:30",
  location: "111 W Sycamore St",
  description: "Paint a canvas with us.",
  price: 39,
  link: "https://www.firedartsstudio.com/event-details/canvas",
};

test("matchFieldKind: Facebook-style labels claim the right kinds", () => {
  assert.equal(matchFieldKind(null, el({ attrs: { placeholder: "Event name" } })), "name");
  assert.equal(matchFieldKind(null, el({ attrs: { "aria-label": "Start date" } })), "startDate");
  assert.equal(matchFieldKind(null, el({ attrs: { "aria-label": "End date" } })), "endDate");
  assert.equal(matchFieldKind(null, el({ attrs: { "aria-label": "Start time" } })), "startTime");
  assert.equal(matchFieldKind(null, el({ attrs: { "aria-label": "End time" } })), "endTime");
  assert.equal(matchFieldKind(null, el({ attrs: { "aria-label": "Location" } })), "location");
  assert.equal(matchFieldKind(null, el({ tag: "TEXTAREA", attrs: { "aria-label": "Description" } })), "description");
  assert.equal(matchFieldKind(null, el({ attrs: { placeholder: "Price" } })), "price");
  assert.equal(matchFieldKind(null, el({ attrs: { placeholder: "Ticket link" } })), "link");
  assert.equal(matchFieldKind(null, el({ type: "date" })), "date");
  assert.equal(matchFieldKind(null, el({ type: "time" })), "time");
});

test("matchFieldKind: start wins over plain date/time; submit/hidden never claim", () => {
  assert.equal(matchFieldKind(null, el({ attrs: { placeholder: "Date" } })), "date");
  assert.equal(matchFieldKind(null, el({ attrs: { placeholder: "Start date" } })), "startDate");
  assert.equal(matchFieldKind(null, el({ attrs: { placeholder: "Time" } })), "time");
  assert.equal(matchFieldKind(null, el({ attrs: { placeholder: "Start time" } })), "startTime");
  assert.equal(matchFieldKind(null, el({ type: "submit" })), null);
  assert.equal(matchFieldKind(null, el({ type: "hidden" })), null);
  const disabled = el({ attrs: { placeholder: "Event name" } });
  disabled.disabled = true;
  assert.equal(matchFieldKind(null, disabled), null);
  assert.equal(matchFieldKind(null, el({ attrs: { placeholder: "Your name" } })), null);
});

test("formatters: native inputs get ISO, text inputs get locale", () => {
  assert.equal(formatDate("2026-11-24", "date"), "2026-11-24");
  assert.equal(formatDate("2026-11-24", "text"), "11/24/2026");
  assert.equal(formatTime("17:30", "time"), "17:30");
  assert.equal(formatTime("17:30", "text"), "5:30 PM");
  assert.equal(formatTime("09:05", "text"), "9:05 AM");
  assert.equal(valueFor("startTime", EVENT, "time"), "17:30");
  assert.equal(valueFor("startTime", EVENT, "text"), "5:30 PM");
  assert.equal(valueFor("startDate", EVENT, "text"), "11/24/2026");
  assert.equal(valueFor("name", EVENT, "text"), "Canvas Night");
  assert.equal(valueFor("price", EVENT, "text"), 39);
  assert.equal(valueFor("price", { ...EVENT, price: 0 }, "text"), "");
  assert.equal(valueFor("price", { ...EVENT, price: null }, "text"), "");
});

test("setFieldValue sets the value and dispatches input + change (React-safe)", () => {
  const input = el({ attrs: { placeholder: "Event name" } });
  setFieldValue(input, "Canvas Night");
  assert.equal(input.value, "Canvas Night");
  assert.deepEqual(input.events, ["input", "change"]);
});

test("fillEventForm fills a Facebook-style form and reports nothing missing", () => {
  const fields = [
    el({ attrs: { placeholder: "Event name" } }),
    el({ attrs: { "aria-label": "Start date" } }),
    el({ attrs: { "aria-label": "Start time" } }),
    el({ attrs: { "aria-label": "End date" } }),
    el({ attrs: { "aria-label": "End time" } }),
    el({ attrs: { "aria-label": "Location" } }),
    el({ tag: "TEXTAREA", attrs: { "aria-label": "Description" } }),
    el({ attrs: { placeholder: "Price" } }),
    el({ attrs: { placeholder: "Ticket link" } }),
  ];
  const res = fillEventForm(new FakeRoot(fields), EVENT);
  assert.deepEqual(kinds(res).sort(), ["startDate", "description", "endTime", "endDate", "link", "location", "name", "price", "startTime"].sort());
  assert.deepEqual(res.missing, []);
  assert.equal(fields[0].value, "Canvas Night");
  assert.equal(fields[1].value, "11/24/2026", "text start date is locale format");
  assert.equal(fields[2].value, "5:30 PM", "text start time is locale format");
  assert.equal(fields[7].value, "39");
  assert.ok(fields.every((f) => f.events.indexOf("input") >= 0), "every filled field dispatched input");
});

test("fillEventForm: a form with no price field reports price missing and skips it", () => {
  const fields = [
    el({ attrs: { placeholder: "Event name" } }),
    el({ attrs: { "aria-label": "Start date" } }),
  ];
  const res = fillEventForm(new FakeRoot(fields), EVENT);
  assert.ok(kinds(res).indexOf("name") >= 0);
  assert.ok(res.missing.indexOf("price") >= 0, "price reported missing");
  assert.ok(res.missing.indexOf("location") >= 0, "location reported missing");
});

test("fillEventForm: one unlabeled date input is the start; two unlabeled dates are start then end", () => {
  const one = [el({ type: "date" }), el({ type: "time" })];
  const res1 = fillEventForm(new FakeRoot(one), EVENT);
  assert.ok(kinds(res1).indexOf("startDate") >= 0, "single date claims startDate");
  assert.ok(kinds(res1).indexOf("startTime") >= 0, "single time claims startTime");
  assert.equal(one[0].value, "2026-11-24", "native date input gets ISO");
  assert.equal(one[1].value, "17:30", "native time input gets ISO");

  const two = [el({ type: "date" }), el({ type: "date" }), el({ type: "time" }), el({ type: "time" })];
  const res2 = fillEventForm(new FakeRoot(two), EVENT);
  assert.ok(kinds(res2).indexOf("startDate") >= 0);
  assert.ok(kinds(res2).indexOf("endDate") >= 0);
  assert.ok(kinds(res2).indexOf("startTime") >= 0);
  assert.ok(kinds(res2).indexOf("endTime") >= 0);
  assert.equal(two[1].value, "2026-11-24", "second date input is the end date");
});

test("fillEventForm: an event with no price leaves the price field alone", () => {
  const priceField = el({ attrs: { placeholder: "Price" } });
  const res = fillEventForm(new FakeRoot([priceField]), { ...EVENT, price: null });
  assert.equal(priceField.value, "", "price field untouched when the event has no price");
  assert.ok(kinds(res).indexOf("price") < 0, "price not filled");
  assert.ok(res.missing.indexOf("price") < 0, "price not reported missing — the event has none");
});

/* ---------- Timezone (Nov 19 mis-fill) ---------- */

test("matchFieldKind: a 'Time zone' field is timezone, never a time", () => {
  assert.equal(matchFieldKind(null, el({ attrs: { "aria-label": "Time zone" } })), "timezone");
  assert.equal(matchFieldKind(null, el({ attrs: { "aria-label": "Start time zone" } })), "timezone");
  assert.equal(matchFieldKind(null, el({ attrs: { placeholder: "Timezone" } })), "timezone");
  assert.equal(matchFieldKind(null, el({ attrs: { "aria-label": "Event time zone" } })), "timezone");
  /* The generic time rule can no longer steal it. */
  assert.equal(matchFieldKind(null, el({ attrs: { placeholder: "Time" } })), "time");
  assert.equal(matchFieldKind(null, el({ attrs: { "aria-label": "Start time" } })), "startTime");
  assert.equal(matchFieldKind(null, el({ attrs: { "aria-label": "End time" } })), "endTime");
  assert.equal(valueFor("timezone", EVENT, "text"), "EST", "no tz on the event — the studio fallback");
  assert.equal(valueFor("timezone", { ...EVENT, timezone: "America/New_York" }, "text"), "America/New_York");
  assert.equal(valueFor("timezone", { ...EVENT, tz: "EDT" }, "text"), "EDT");
});

test("fillEventForm: Facebook-like rows with a Time zone field per row", () => {
  const startTz = el({ attrs: { "aria-label": "Time zone" } });
  const endTz = el({ attrs: { "aria-label": "Time zone" } });
  const startTime = el({ attrs: { "aria-label": "Start time" } });
  const endTime = el({ attrs: { "aria-label": "End time" } });
  const fields = [
    el({ attrs: { "aria-label": "Start date" } }),
    startTime,
    startTz,
    el({ attrs: { "aria-label": "End date" } }),
    endTime,
    endTz,
  ];
  const res = fillEventForm(new FakeRoot(fields), EVENT);
  assert.equal(startTime.value, "5:30 PM", "start time stays a time");
  assert.equal(endTime.value, "7:30 PM", "end time stays a time");
  assert.equal(startTz.value, "EST", "start row timezone gets the tz, not a time");
  assert.equal(endTz.value, "EST", "end row timezone gets the tz too");
  assert.ok(!fields.some((f) => f.value === "8:10 PM"), "no time value ever lands in a timezone field");
  assert.ok(kinds(res).indexOf("timezone") >= 0);
  assert.ok(res.missing.indexOf("timezone") < 0, "fallback tz is not event data, so it is never reported missing");
});

test("fillEventForm: an explicit event tz is reported missing when the form has no timezone field", () => {
  const res = fillEventForm(new FakeRoot([el({ attrs: { placeholder: "Event name" } })]), { ...EVENT, timezone: "EST" });
  assert.ok(res.missing.indexOf("timezone") >= 0, "explicit tz with nowhere to go is missing");
});

/* ---------- Revealers + in-person/virtual ---------- */

test("isVirtualEvent: a URL or online wording is virtual, a street address is not", () => {
  assert.equal(isVirtualEvent({ ...EVENT, location: "https://zoom.us/j/123" }), true);
  assert.equal(isVirtualEvent({ ...EVENT, location: "Online" }), true);
  assert.equal(isVirtualEvent({ ...EVENT, location: "Virtual event" }), true);
  assert.equal(isVirtualEvent({ ...EVENT, virtual: true }), true);
  assert.equal(isVirtualEvent({ ...EVENT, format: "online" }), true);
  assert.equal(isVirtualEvent(EVENT), false);
  assert.equal(isVirtualEvent({ ...EVENT, location: "111 W Sycamore St" }), false);
  assert.equal(isVirtualEvent({ ...EVENT, location: "" }), false);
});

test("revealOptionalFields: clicks 'End date and time' only when the event has an end time", () => {
  /* The revealed end fields are comboboxes on the real form, so
     the Facebook driver (not the plain fill) picks them — covered
     by the happy-path test below. This test pins the reveal. */
  const root = new FakeRoot([]);
  const expander = el({ tag: "BUTTON", text: "End date and time", onClick: () => { root._fields.push(el({ attrs: { "aria-label": "End date" } })); } });
  root._fields = [
    el({ attrs: { "aria-label": "Start date" } }),
    el({ attrs: { "aria-label": "Start time" } }),
    expander,
  ];
  const revealed = revealOptionalFields(root, EVENT);
  assert.deepEqual(revealed.expanders, ["End date and time"]);
  assert.equal(expander.clicked, true);

  const root2 = new FakeRoot([]);
  const expander2 = el({ tag: "BUTTON", text: "End date and time", onClick: () => { root2._fields.push(el({ attrs: { "aria-label": "End date" } })); } });
  root2._fields = [expander2];
  revealOptionalFields(root2, { ...EVENT, endTime: "" });
  assert.equal(expander2.clicked, false, "no end time — the expander is left alone");
});

test("setInPersonVirtual: clicks the matching option inside the 'Is it in person or virtual?' group", () => {
  function group() {
    const container = el({ tag: "DIV", text: "Is it in person or virtual? In person Virtual" });
    const inPerson = el({ tag: "BUTTON", text: "In person", parent: container });
    const virtual = el({ tag: "BUTTON", text: "Virtual", parent: container });
    const root = new FakeRoot([inPerson, virtual]);
    return { root, inPerson, virtual };
  }
  const g1 = group();
  const r1 = setInPersonVirtual(g1.root, EVENT);
  assert.deepEqual(r1, { how: "click", value: "in person" });
  assert.equal(g1.inPerson.clicked, true);
  assert.equal(g1.virtual.clicked, false);

  const g2 = group();
  const r2 = setInPersonVirtual(g2.root, { ...EVENT, location: "https://zoom.us/j/123" });
  assert.deepEqual(r2, { how: "click", value: "virtual" });
  assert.equal(g2.virtual.clicked, true);
  assert.equal(g2.inPerson.clicked, false);

  /* A same-named button OUTSIDE the group is never touched. */
  const stray = el({ tag: "BUTTON", text: "In person" });
  assert.equal(setInPersonVirtual(new FakeRoot([stray]), EVENT), null);
  assert.equal(stray.clicked, false);
});

test("setInPersonVirtual: a select with both options gets its value set", () => {
  const container = el({ tag: "DIV", text: "Is it in person or virtual?" });
  const sel = el({
    tag: "SELECT",
    parent: container,
    options: [
      { value: "in_person", text: "In person" },
      { value: "virtual", text: "Virtual" },
    ],
  });
  sel._value = "in_person";
  const root = new FakeRoot([sel]);
  const r = setInPersonVirtual(root, { ...EVENT, location: "Online" });
  assert.deepEqual(r, { how: "select", value: "virtual" });
  assert.equal(sel.value, "virtual");
});

test("revealOptionalFields: expander text variants and non-button expanders", () => {
  /* Facebook's expander is not always a button with the exact words
     "End date and time": "Add end date", "Add an end date", and
     "Show end date" must all open the section, and a div/span
     carrying the label counts too. */
  for (const label of ["Add end date", "Add an end date", "Show end date", "Add end time"]) {
    const root = new FakeRoot([]);
    const exp = el({ tag: "DIV", text: label, onClick: () => { root._fields.push(el({ attrs: { "aria-label": "End date" } })); } });
    root._fields = [exp];
    const revealed = revealOptionalFields(root, EVENT);
    assert.ok(revealed.expanders.indexOf(label) >= 0, label + " must be clicked");
    assert.equal(exp.clicked, true);
  }
  /* A big container whose text merely contains the phrase is not
     the expander — clicking it would be a wild click. */
  const longText = "Create event — fill in the details. End date and time is optional; add it below if the event runs over more than one day. " + "x".repeat(40);
  const container = el({ tag: "DIV", text: longText });
  const root2 = new FakeRoot([container]);
  assert.deepEqual(revealOptionalFields(root2, EVENT).expanders, []);
  assert.equal(container.clicked, false);
  /* A button and its inner span both match: only the outermost
     gets the click, or the section opens then shuts again. */
  const btn = el({ tag: "BUTTON", text: "End date and time" });
  const span = el({ tag: "SPAN", text: "End date and time", parent: btn });
  const root3 = new FakeRoot([btn, span]);
  const revealed3 = revealOptionalFields(root3, EVENT);
  assert.equal(revealed3.expanders.length, 1);
  assert.equal(btn.clicked, true);
  assert.equal(span.clicked, false);
});

test("setInPersonVirtual: portal options — opens the trigger, then the document-wide option is picked", () => {
  /* Facebook renders the choices in a React portal outside the
     question's group, so the in-group search finds nothing. The
     trigger (the button carrying the question) opens the menu;
     pickPortalOption then clicks the option wherever it rendered. */
  const trigger = el({ tag: "BUTTON", text: "Is it in person or virtual?" });
  const option = el({ tag: "DIV", attrs: { role: "option" }, text: "In person" });
  const root = new FakeRoot([trigger, option]);
  const r = setInPersonVirtual(root, EVENT);
  assert.deepEqual(r, { how: "open-trigger", value: "in person", pending: true });
  assert.equal(trigger.clicked, true);
  assert.equal(option.clicked, false, "the option is picked in a second step, not by the reveal");
  const picked = pickPortalOption(root, EVENT);
  assert.deepEqual(picked, { how: "portal", value: "in person" });
  assert.equal(option.clicked, true);
  /* A virtual event opens the same trigger and picks Virtual. */
  const trigger2 = el({ tag: "BUTTON", text: "Is it in person or virtual?" });
  const option2 = el({ tag: "DIV", attrs: { role: "option" }, text: "Virtual" });
  const root2 = new FakeRoot([trigger2, option2]);
  assert.deepEqual(setInPersonVirtual(root2, { ...EVENT, location: "https://zoom.us/j/123" }), { how: "open-trigger", value: "virtual", pending: true });
  assert.deepEqual(pickPortalOption(root2, { ...EVENT, location: "https://zoom.us/j/123" }), { how: "portal", value: "virtual" });
  /* No portal option rendered yet: nothing to pick. */
  assert.equal(pickPortalOption(new FakeRoot([trigger]), EVENT), null);
});

test("pickLocationSuggestion: only real suggestion rows are picked, on the typed street part", () => {
  /* Facebook's location field is a combobox: typing the value
     opens suggestions but never selects one, so the form keeps
     typed text with no place attached. The suggestion is longer
     than the typed text (it adds the zip / country) — match on
     the typed street part. Only [role=option]/[role=menuitem]
     rows count: an arbitrary button with matching text must
     never be clicked. */
  const suggestion = el({ tag: "DIV", attrs: { role: "option" }, text: "111 W Sycamore St, Kokomo, IN 46902, USA" });
  const root2 = new FakeRoot([suggestion]);
  const picked = pickLocationSuggestion(root2, EVENT);
  assert.equal(picked.how, "suggestion");
  assert.equal(suggestion.clicked, true);
  /* A button with the same text is not a suggestion row. */
  const btn = el({ tag: "BUTTON", text: "111 W Sycamore St, Kokomo, IN 46902, USA" });
  assert.equal(pickLocationSuggestion(new FakeRoot([btn]), EVENT), null);
  assert.equal(btn.clicked, false);
  /* No matching suggestion: nothing is clicked. */
  const other = el({ tag: "DIV", attrs: { role: "option" }, text: "Somewhere Else, Nowhere" });
  assert.equal(pickLocationSuggestion(new FakeRoot([other]), EVENT), null);
  assert.equal(other.clicked, false);
  /* A plain text location field is not a combobox: no second step. */
  const plain = el({ attrs: { "aria-label": "Location" } });
  const res2 = fillEventForm(new FakeRoot([plain]), EVENT);
  assert.equal(res2.combobox, null);
});

/* ---------- The real Facebook form (live diagnostic, Nov 19, 2026) ----------
   No native controls anywhere: every field is a role="combobox"
   whose options render in a portal AFTER the dialog in DOM order.
   Expanding "+ End date and time" auto-fills end defaults (end
   date = start + 1 day, end time 00:00, a second Time zone = EST).
   The location field appears only after "In person" is chosen and
   only binds when a suggestion is picked. Dates are gridcells in
   a floating calendar; times are 96 listbox options; timezones
   are IANA options, two identically-named comboboxes in DOM order. */

const FB_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FB_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const FB_TZ_OPTIONS = [
  "America/Detroit Detroit Time (EST)",
  "America/New_York Eastern Time (EST)",
  "America/Toronto Toronto Time (EST)",
  "America/Chicago Central Time (CST)",
  "America/Los_Angeles Pacific Time (PST)",
];
const FB_LOCATION_SUGGESTIONS = [
  "111 W Sycamore St, Kokomo, IN 46902, USA",
  "Fired Arts Studio, 111 W Sycamore St, Kokomo, IN",
  "Kokomo, IN, USA",
  "Kokomo High School, 2501 S Berkley Rd, Kokomo, IN",
  "Highland Park, Kokomo, IN",
  "Kokomo Mall, 1100 E Firmin St, Kokomo, IN",
  "The Venue, Kokomo, IN",
  "Downtown Kokomo, IN, USA",
];

function fbDateLabel(y, m, d) {
  return FB_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + " " + d + " " + FB_MONTHS[m - 1] + " " + y;
}

function fbAddDays(dateStr, n) {
  const p = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function fbTimeOptions() {
  const out = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      out.push(String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"));
    }
  }
  return out;
}

function buildFacebookForm(options) {
  options = options || {};
  const fields = [];
  const root = new FakeRoot(fields);
  const form = { fields, ipvOpens: 0, navClicks: 0, disabledClicks: 0, disabledCells: [], openedCalendar: null, openedListbox: null };
  function add(elm) { fields.push(elm); return elm; }
  function remove(elm) { const i = fields.indexOf(elm); if (i >= 0) fields.splice(i, 1); }
  function removeAll(list) { list.forEach(remove); }

  /* Opening a picker closes the current one — that is how the
     live form behaves, and a stale portal from a failed pick must
     never poison the next combobox. */
  function closePortals() {
    if (form.openedListbox) {
      removeAll([form.openedListbox.box, ...form.openedListbox.opts]);
      form.openedListbox = null;
    }
    if (form.openedCalendar) {
      removeAll([form.openedCalendar.dialog, form.openedCalendar.prev, form.openedCalendar.next, ...form.openedCalendar.cells]);
      form.openedCalendar = null;
    }
  }

  /* A floating listbox portal, appended AFTER the dialog fields
     (DOM order: portal after dialog). Picking an option closes it. */
  function openListbox(optionTexts, onPick) {
    closePortals();
    const box = el({ tag: "DIV", attrs: { role: "listbox" }, text: "" });
    const opts = optionTexts.map((t) => el({ tag: "DIV", attrs: { role: "option" }, text: t, parent: box }));
    opts.forEach((o) => {
      o._onClick = () => { removeAll([box, ...opts]); form.openedListbox = null; onPick(o); };
    });
    add(box);
    opts.forEach(add);
    form.openedListbox = { box, opts };
    return form.openedListbox;
  }

  /* A floating calendar dialog portal. Gridcells close it on pick
     and leave the combobox focused with blank visible text (the
     live focus quirk) until it is blurred. */
  function openCalendar(combo) {
    closePortals();
    let month = options.openMonth || 11;
    let year = options.openYear || 2026;
    const dialog = el({ tag: "DIV", attrs: { role: "dialog" }, text: FB_MONTHS[month - 1] + " " + year });
    const prev = el({ tag: "BUTTON", attrs: { "aria-label": "Previous Month" }, text: "Previous Month", parent: dialog });
    const next = el({ tag: "BUTTON", attrs: { "aria-label": "Next Month" }, text: "Next Month", parent: dialog });
    let cells = [];
    function close() {
      removeAll([dialog, prev, next, ...cells]);
      form.openedCalendar = null;
    }
    function renderMonth(m, y) {
      removeAll(cells);
      cells = [];
      dialog.textContent = FB_MONTHS[m - 1] + " " + y;
      const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (let d = 1; d <= days; d++) {
        const cell = el({ tag: "BUTTON", attrs: { role: "gridcell" }, text: fbDateLabel(y, m, d), parent: dialog });
        if ((options.disabledDays || []).indexOf(y + "-" + m + "-" + d) >= 0) {
          cell.disabled = true;
          form.disabledCells.push(cell);
        }
        cell._onClick = () => {
          if (cell.disabled) form.disabledClicks++;
          combo._text = fbDateLabel(y, m, d);
          combo._quirkBlank = true;
          combo.focus();
          close();
        };
        cells.push(cell);
        add(cell);
      }
      if (form.openedCalendar) form.openedCalendar.cells = cells;
    }
    prev._onClick = () => {
      form.navClicks++;
      if (month === 1) { month = 12; year--; } else month--;
      renderMonth(month, year);
    };
    next._onClick = () => {
      form.navClicks++;
      if (month === 12) { month = 1; year++; } else month++;
      renderMonth(month, year);
    };
    add(dialog);
    add(prev);
    add(next);
    renderMonth(month, year);
    form.openedCalendar = { dialog, cells, prev, next };
    return form.openedCalendar;
  }

  function dateCombo(label, initialText) {
    const combo = el({ tag: "DIV", attrs: { role: "combobox", "aria-label": label }, text: initialText });
    combo._quirkBlank = true;
    combo._onClick = () => { openCalendar(combo); };
    return combo;
  }
  function timeCombo(label, initialText) {
    const combo = el({ tag: "DIV", attrs: { role: "combobox", "aria-label": label }, text: initialText });
    combo._onClick = () => {
      openListbox(fbTimeOptions(), (picked) => { combo._text = picked.textContent; });
    };
    return combo;
  }
  function tzCombo(initialText) {
    const combo = el({ tag: "DIV", attrs: { role: "combobox", "aria-label": "Time zone" }, text: initialText });
    combo._onClick = () => {
      openListbox(FB_TZ_OPTIONS, (picked) => { combo._text = picked.textContent; });
    };
    return combo;
  }

  /* The dialog's own fields, in DOM order — portals render after. */
  form.name = add(el({ attrs: { "aria-label": "Event name" } }));
  form.description = add(el({ tag: "TEXTAREA", attrs: { "aria-label": "Description" } }));
  form.price = add(el({ attrs: { placeholder: "Price" } }));
  form.link = add(el({ attrs: { placeholder: "Ticket link" } }));
  form.ipv = add(el({ tag: "DIV", attrs: { role: "combobox", "aria-label": "Is it in person or virtual?" }, text: "Is it in person or virtual?" }));
  form.ipv._onClick = () => {
    form.ipvOpens++;
    const portal = openListbox(["In person", "Virtual"], (picked) => {
      form.ipv._text = picked.textContent;
      if (picked.textContent === "In person") revealLocation();
    });
    /* Flaky popup: the first open closes on its own while
       aria-expanded still says true — the fill must re-open. */
    if (options.flakyIpv && form.ipvOpens === 1) {
      removeAll([portal.box, ...portal.opts]);
      form.openedListbox = null;
    }
  };
  form.startDate = add(dateCombo("Start date", "Start date"));
  form.startTime = add(timeCombo("Start time", "Start time"));
  form.startTz = add(tzCombo("Time zone"));
  form.expander = add(el({ tag: "BUTTON", attrs: { "aria-label": "Add end date and time" }, text: "+ End date and time" }));
  form.expander._onClick = () => {
    if (form.endDate) return;
    /* Expanding auto-fills the end defaults: end date = start
       date + 1 day, end time 00:00, a second Time zone = EST. */
    const next = fbAddDays(EVENT.date, 1);
    form.endDate = add(dateCombo("End date", fbDateLabel(next.y, next.m, next.d)));
    form.endTime = add(timeCombo("End time", "00:00"));
    form.endTz = add(tzCombo("EST"));
  };
  form.submit = add(el({ tag: "BUTTON", text: "Create event" }));
  form.submit.disabled = true;

  function revealLocation() {
    if (form.location) return;
    const container = el({ tag: "DIV", attrs: { role: "combobox", "aria-label": "Add location" }, text: "Add location" });
    const input = el({ attrs: { placeholder: "Include a place or address" }, parent: container });
    form.location = container;
    form.locationInput = input;
    container._onClick = () => {
      if (options.locationSuggestions === false) return;
      openListbox(FB_LOCATION_SUGGESTIONS, (picked) => {
        if (options.locationPickSticks === false) return; /* the click missed */
        container._text = picked.textContent;
        input._value = ""; /* the typed text is replaced by the bound place */
      });
    };
    add(container);
    add(input);
  }

  form.root = root;
  return form;
}

const FB_OPTS = { settleMs: 10, portalTimeoutMs: 300 };

test("fillFacebookForm: the real Facebook form fills end to end — expand first, portal clicks, verified after blur", async () => {
  const form = buildFacebookForm();
  const res = await fillFacebookForm(form.root, EVENT, FB_OPTS);
  assert.deepEqual(res.missing, []);
  assert.deepEqual(kinds(res).sort(), ["startDate", "endDate", "startTime", "endTime", "timezone", "location", "name", "description", "price", "link"].sort());
  /* The end defaults were overwritten, not left standing. */
  assert.equal(form.startDate.textContent, fbDateLabel(2026, 11, 24));
  assert.equal(form.endDate.textContent, fbDateLabel(2026, 11, 24));
  assert.equal(form.startTime.textContent, "17:30");
  assert.equal(form.endTime.textContent, "19:30");
  assert.equal(form.startTz.textContent, "America/New_York Eastern Time (EST)");
  assert.equal(form.endTz.textContent, "America/New_York Eastern Time (EST)");
  assert.equal(form.ipv.textContent, "In person");
  /* The location bound a place — the combobox shows the full
     place string, not just the typed street. */
  assert.ok(form.location.textContent.indexOf("111 W Sycamore St, Kokomo, IN 46902") >= 0);
  assert.equal(form.locationInput.value, "", "the typed text was replaced by the bound place");
  /* Blur-then-verify: every date combobox was blurred. */
  assert.equal(form.startDate.blurred, true);
  assert.equal(form.endDate.blurred, true);
  /* Never submits. */
  assert.equal(form.submit.clicked, false);
});

test("fillFacebookForm: expanding auto-fills end defaults, and the fill overwrites them", async () => {
  const form = buildFacebookForm();
  /* Click the expander directly: the defaults appear before any
     end value is set — end date = start + 1 day, end time 00:00,
     a second Time zone = EST. */
  form.expander.click();
  const next = fbAddDays(EVENT.date, 1);
  assert.equal(form.endDate.textContent, fbDateLabel(next.y, next.m, next.d));
  assert.equal(form.endTime.textContent, "00:00");
  assert.equal(form.endTz.textContent, "EST");
  assert.ok(form.endTz !== form.startTz, "the end row has its own Time zone combobox");
  /* Now run the fill on the already-expanded form: the defaults
     are overwritten with the event's end values. */
  const res = await fillFacebookForm(form.root, EVENT, FB_OPTS);
  assert.deepEqual(res.missing, []);
  assert.equal(form.endDate.textContent, fbDateLabel(2026, 11, 24));
  assert.equal(form.endTime.textContent, "19:30");
});

test("fillFacebookForm: an in-person/virtual popup that closes on its own is re-opened, not trusted", async () => {
  const form = buildFacebookForm({ flakyIpv: true });
  const res = await fillFacebookForm(form.root, EVENT, FB_OPTS);
  assert.deepEqual(res.missing, []);
  assert.equal(form.ipvOpens, 2, "the trigger was clicked again after the first popup vanished");
  assert.equal(form.ipv.textContent, "In person");
});

test("fillFacebookForm: no location suggestions means no bound place — typed text alone never counts", async () => {
  const form = buildFacebookForm({ locationSuggestions: false });
  const res = await fillFacebookForm(form.root, EVENT, FB_OPTS);
  assert.ok(res.missing.indexOf("location") >= 0, "location is missing when no suggestion can bind it");
  assert.equal(form.locationInput.value, "111 W Sycamore St", "the address was typed");
  assert.equal(form.location.textContent, "Add location", "but no place was ever picked");
});

test("fillFacebookForm: a suggestion click that does not stick leaves location missing", async () => {
  const form = buildFacebookForm({ locationPickSticks: false });
  const res = await fillFacebookForm(form.root, EVENT, FB_OPTS);
  assert.ok(res.missing.indexOf("location") >= 0);
  assert.equal(form.location.textContent, "Add location");
});

test("fillFacebookForm: the two identically-named Time zone comboboxes are told apart by DOM order", async () => {
  const form = buildFacebookForm();
  const res = await fillFacebookForm(form.root, EVENT, FB_OPTS);
  assert.deepEqual(res.missing, []);
  assert.equal(form.startTz.getAttribute("aria-label"), "Time zone");
  assert.equal(form.endTz.getAttribute("aria-label"), "Time zone");
  assert.ok(form.startTz !== form.endTz, "two distinct comboboxes, not one field twice");
  assert.ok(form.root._fields.indexOf(form.startTz) < form.root._fields.indexOf(form.endTz), "start row first in DOM order");
  assert.equal(form.startTz.textContent, "America/New_York Eastern Time (EST)");
  assert.equal(form.endTz.textContent, "America/New_York Eastern Time (EST)");
});

test("fillFacebookForm: a date in the next month navigates the calendar forward", async () => {
  const dec = { ...EVENT, date: "2026-12-01", endTime: "19:30" };
  const form = buildFacebookForm({ openMonth: 11, openYear: 2026 });
  const res = await fillFacebookForm(form.root, dec, FB_OPTS);
  assert.deepEqual(res.missing, []);
  assert.equal(form.startDate.textContent, fbDateLabel(2026, 12, 1));
  assert.ok(form.navClicks >= 1, "Next Month was clicked to reach December");
});

test("fillFacebookForm: a disabled (past) date is never clicked and is reported missing", async () => {
  const form = buildFacebookForm({ disabledDays: ["2026-11-24"] });
  const res = await fillFacebookForm(form.root, EVENT, FB_OPTS);
  assert.ok(res.missing.indexOf("startDate") >= 0, "the target day is disabled, so the date is missing");
  assert.ok(res.missing.indexOf("endDate") >= 0);
  assert.ok(form.disabledCells.length >= 2, "both calendars rendered the disabled day");
  assert.ok(form.disabledCells.every((c) => !c.clicked), "no disabled gridcell was ever clicked");
  assert.equal(form.disabledClicks, 0);
});

test("Facebook mock: a date combobox's text reads blank while focused after picking, until blurred", () => {
  const form = buildFacebookForm();
  form.startDate.click();
  const cell = form.openedCalendar.cells.find((c) => c.textContent.indexOf("24 November 2026") >= 0);
  assert.ok(cell, "the target gridcell is in the open calendar");
  cell.click();
  assert.equal(form.startDate.textContent, "", "blank while focused, even though the value is set");
  assert.equal(form.startDate._text, fbDateLabel(2026, 11, 24), "the value is still set underneath");
  form.startDate.blur();
  assert.equal(form.startDate.textContent, fbDateLabel(2026, 11, 24), "readable after blur");
});

test("fillFacebookForm: a virtual event picks Virtual and never needs a location", async () => {
  const form = buildFacebookForm();
  const res = await fillFacebookForm(form.root, { ...EVENT, location: "https://zoom.us/j/123" }, FB_OPTS);
  assert.deepEqual(res.missing, []);
  assert.equal(form.ipv.textContent, "Virtual");
  assert.equal(form.location, undefined, "no location field appears for a virtual event");
  assert.ok(kinds(res).indexOf("location") < 0);
});

test("fillFacebookForm: an explicit IANA timezone picks its own option", async () => {
  const form = buildFacebookForm();
  const res = await fillFacebookForm(form.root, { ...EVENT, timezone: "America/Chicago" }, FB_OPTS);
  assert.deepEqual(res.missing, []);
  assert.equal(form.startTz.textContent, "America/Chicago Central Time (CST)");
  assert.equal(form.endTz.textContent, "America/Chicago Central Time (CST)");
});
