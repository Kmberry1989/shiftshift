"use strict";
/* Extension fill logic (extension/fill.js): field matching,
   formatters, React-safe value setting, whole-form fill. Uses a
   minimal fake DOM — no browser needed. Event records use the
   app's own shape: date "YYYY-MM-DD", startTime/endTime "HH:MM". */
const test = require("node:test");
const assert = require("node:assert/strict");

const { matchFieldKind, valueFor, formatDate, formatTime, setFieldValue, fillEventForm } = require("../../extension/fill.js");

class FakeEl {
  constructor({ tag = "INPUT", type = "text", attrs = {}, labelText = "" }) {
    this.tagName = tag;
    this.type = type;
    this._value = "";
    this.disabled = false;
    this._attrs = attrs;
    this.labels = labelText ? [{ textContent: labelText }] : [];
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
  dispatchEvent(e) { this.events.push(e.type); return true; }
}

class FakeRoot {
  constructor(fields) { this._fields = fields; }
  querySelectorAll() { return this._fields; }
  querySelector() { return null; }
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
