"use strict";
/* Click-through hit test: only leaf interactive elements keep a
   click in-app; a visibly transparent gap between bubbles must read
   as empty so the click reaches the app behind the overlay. These
   tests run against the pure module, no Electron. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { CLICKABLE_SELECTOR, isOverInteractive } = require("../renderer/click-through.js");

/* Minimal stand-in for a DOM element: closest() walks up through
   parents, answering by tag and class like the real one. */
function fakeEl(tag, classes, parent) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    classes: classes || [],
    parent: parent || null,
    closest(sel) {
      let cur = el;
      while (cur) {
        for (const part of sel.split(",")) {
          const p = part.trim();
          if (p === cur.tagName.toLowerCase()) return cur;
          if (p.startsWith(".") && cur.classes.indexOf(p.slice(1)) >= 0) return cur;
        }
        cur = cur.parent;
      }
      return null;
    },
  };
  return el;
}

test("a gap inside the tree is empty: the tree container does not count", () => {
  const view = fakeEl("div", [], null);
  const tree = fakeEl("main", ["bubble-tree"], view);
  assert.equal(isOverInteractive(tree), false);
  const branch = fakeEl("div", ["event-branch"], tree);
  assert.equal(isOverInteractive(branch), false);
  const connector = fakeEl("div", ["tree-connector"], tree);
  assert.equal(isOverInteractive(connector), false);
  assert.equal(isOverInteractive(view), false);
});

test("a gap in the header is empty: the header container does not count", () => {
  const header = fakeEl("header", ["bubble-header"], null);
  assert.equal(isOverInteractive(header), false);
});

test("a gap in the calendar view is empty: the view container does not count", () => {
  const view = fakeEl("main", ["calendar-view"], null);
  assert.equal(isOverInteractive(view), false);
});

test("every bubble counts, including text nested inside one", () => {
  const tree = fakeEl("main", ["bubble-tree"], null);
  const bubble = fakeEl("button", ["bubble", "event-bubble"], tree);
  assert.equal(isOverInteractive(bubble), true);
  const valueBubble = fakeEl("button", ["bubble", "value-bubble"], tree);
  assert.equal(isOverInteractive(valueBubble), true);
  const text = fakeEl("span", ["value-text"], valueBubble);
  assert.equal(isOverInteractive(text), true);
  const root = fakeEl("button", ["bubble", "root-bubble"], tree);
  assert.equal(isOverInteractive(root), true);
  const nextUp = fakeEl("button", ["bubble", "next-up"], tree);
  assert.equal(isOverInteractive(nextUp), true);
});

test("header controls count: buttons, the search box, the create menu", () => {
  const header = fakeEl("header", ["bubble-header"], null);
  assert.equal(isOverInteractive(fakeEl("button", [], header)), true);
  const searchBox = fakeEl("div", ["search-box"], header);
  assert.equal(isOverInteractive(searchBox), true);
  assert.equal(isOverInteractive(fakeEl("input", [], searchBox)), true);
  assert.equal(isOverInteractive(fakeEl("svg", [], searchBox)), true);
  const menu = fakeEl("div", ["create-menu"], header);
  assert.equal(isOverInteractive(menu), true);
  assert.equal(isOverInteractive(fakeEl("button", [], menu)), true);
});

test("calendar content counts: day cells, event chips, week rows", () => {
  assert.equal(isOverInteractive(fakeEl("div", ["cal-cell"], null)), true);
  assert.equal(isOverInteractive(fakeEl("div", ["cal-event"], null)), true);
  assert.equal(isOverInteractive(fakeEl("div", ["week-event"], null)), true);
});

test("an element without closest(), or null, is empty", () => {
  assert.equal(isOverInteractive(null), false);
  assert.equal(isOverInteractive({}), false);
  assert.equal(isOverInteractive({ tagName: "DIV" }), false);
});

test("the selector lists leaf elements only, never the big containers", () => {
  for (const container of [".bubble-tree", ".bubble-header", ".calendar-view", ".settings-view"]) {
    assert.ok(!CLICKABLE_SELECTOR.split(",").map((s) => s.trim()).includes(container), container + " must not be in the selector");
  }
  for (const leaf of ["button", "input", "select", "textarea", "a", ".bubble", ".search-box", ".create-menu", ".cal-cell", ".cal-event", ".week-event"]) {
    assert.ok(CLICKABLE_SELECTOR.split(",").map((s) => s.trim()).includes(leaf), leaf + " must be in the selector");
  }
});
