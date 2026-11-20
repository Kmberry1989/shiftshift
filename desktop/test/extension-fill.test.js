"use strict";
/* Extension fill logic (extension/fill.js): field matching,
   formatters, React-safe value setting, whole-form fill. Uses a
   minimal fake DOM — no browser needed. Event records use the
   app's own shape: date "YYYY-MM-DD", startTime/endTime "HH:MM". */
const test = require("node:test");
const assert = require("node:assert/strict");

const { matchFieldKind, valueFor, formatDate, formatTime, setFieldValue, fillEventForm, isVirtualEvent, setInPersonVirtual, revealOptionalFields } = require("../../extension/fill.js");

class FakeEl {
  constructor({ tag = "INPUT", type = "text", attrs = {}, labelText = "", text = "", parent = null, onClick = null, options = null }) {
    this.tagName = tag;
    this.type = type;
    this._value = "";
    this.disabled = false;
    this._attrs = attrs;
    this.labels = labelText ? [{ textContent: labelText }] : [];
    this.textContent = text;
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
  closest() { return null; }
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

test("revealOptionalFields: clicks 'End date and time' only when the event has an end time, then the fill reaches the revealed fields", () => {
  const endDate = el({ attrs: { "aria-label": "End date" } });
  const endTime = el({ attrs: { "aria-label": "End time" } });
  const root = new FakeRoot([]);
  const expander = el({ tag: "BUTTON", text: "End date and time", onClick: () => { root._fields.push(endDate, endTime); } });
  root._fields = [
    el({ attrs: { "aria-label": "Start date" } }),
    el({ attrs: { "aria-label": "Start time" } }),
    expander,
  ];
  const revealed = revealOptionalFields(root, EVENT);
  assert.deepEqual(revealed.expanders, ["End date and time"]);
  assert.equal(expander.clicked, true);
  const res = fillEventForm(root, EVENT);
  assert.equal(endDate.value, "11/24/2026", "revealed end date fills");
  assert.equal(endTime.value, "7:30 PM", "revealed end time fills");
  assert.ok(kinds(res).indexOf("endDate") >= 0 && kinds(res).indexOf("endTime") >= 0);

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
