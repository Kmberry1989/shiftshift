"use strict";
/* Drag-from-anywhere: pure target classification + movement rule.
   The panel drags from any spot on it; only text inputs are
   excluded, and only the root bubble's click toggles the focused
   event. These tests run against the pure module, no Electron. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { classifyDragTarget, isDragMovement, shouldEngageDrag, DRAG_EXCLUDE_SELECTOR, DRAG_THRESHOLD_PX } = require("../renderer/drag.js");

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
          if ((p === "input" || p === "select" || p === "textarea") && cur.tagName.toLowerCase() === p) return cur;
          if (p.startsWith(".") && cur.classes.indexOf(p.slice(1)) >= 0) return cur;
        }
        cur = cur.parent;
      }
      return null;
    },
  };
  return el;
}

test("text inputs never start a drag", () => {
  assert.deepEqual(classifyDragTarget(fakeEl("input")), { start: false, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget(fakeEl("select")), { start: false, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget(fakeEl("textarea")), { start: false, fromRoot: false, inScrollArea: false });
  /* Even inside the root bubble, an input stays typeable. */
  const root = fakeEl("button", ["root-bubble"]);
  assert.deepEqual(classifyDragTarget(fakeEl("input", [], root)), { start: false, fromRoot: false, inScrollArea: false });
});

test("any other spot starts a drag, but only the root toggles on click", () => {
  assert.deepEqual(classifyDragTarget(fakeEl("div")), { start: true, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget(fakeEl("button", ["event-bubble"])), { start: true, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget(fakeEl("button", ["value-bubble"])), { start: true, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget(fakeEl("button", ["cal-event"])), { start: true, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget(fakeEl("div", ["cal-cell"])), { start: true, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget(fakeEl("button", ["root-bubble"])), { start: true, fromRoot: true, inScrollArea: false });
  /* Clicking the text inside the root bubble counts as the root. */
  const root = fakeEl("button", ["root-bubble"]);
  assert.deepEqual(classifyDragTarget(fakeEl("span", ["root-text"], root)), { start: true, fromRoot: true, inScrollArea: false });
});

test("targets inside the tree or calendar are marked as scroll areas", () => {
  const tree = fakeEl("div", ["bubble-tree"]);
  assert.deepEqual(classifyDragTarget(fakeEl("button", ["event-bubble"], tree)), { start: true, fromRoot: false, inScrollArea: true });
  const cal = fakeEl("div", ["calendar-view"]);
  assert.deepEqual(classifyDragTarget(fakeEl("div", ["cal-cell"], cal)), { start: true, fromRoot: false, inScrollArea: true });
  /* The week journal shares the calendar-view class, so it is a
     scroll area too — a vertical swipe scrolls it, a sideways drag
     moves the window. */
  const week = fakeEl("div", ["calendar-view", "week-view"]);
  assert.deepEqual(classifyDragTarget(fakeEl("button", ["week-event"], week)), { start: true, fromRoot: false, inScrollArea: true });
  const header = fakeEl("div", ["bubble-header"]);
  assert.deepEqual(classifyDragTarget(fakeEl("button", ["icon-btn"], header)), { start: true, fromRoot: false, inScrollArea: false });
});

test("a target without closest() never starts a drag", () => {
  assert.deepEqual(classifyDragTarget(null), { start: false, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget({}), { start: false, fromRoot: false, inScrollArea: false });
  assert.deepEqual(classifyDragTarget({ nodeType: 3 }), { start: false, fromRoot: false, inScrollArea: false });
});

test("movement needs more than 4px manhattan, same as before", () => {
  assert.equal(DRAG_THRESHOLD_PX, 4);
  assert.equal(DRAG_EXCLUDE_SELECTOR, "input, select, textarea");
  assert.equal(isDragMovement(0, 0), false);
  assert.equal(isDragMovement(4, 0), false);
  assert.equal(isDragMovement(0, 4), false);
  assert.equal(isDragMovement(3, 1), false);
  assert.equal(isDragMovement(3, 2), true);
  assert.equal(isDragMovement(5, 0), true);
  assert.equal(isDragMovement(-3, -2), true);
});

test("touch drags from a scroll area only engage when horizontal", () => {
  /* A vertical swipe in the tree/calendar is a scroll: the window
     must not nudge before the browser's pointercancel arrives. */
  assert.equal(shouldEngageDrag("touch", true, 0, 40), false);
  assert.equal(shouldEngageDrag("touch", true, 5, 40), false);
  assert.equal(shouldEngageDrag("touch", true, 20, 20), false);
  /* Horizontal (or horizontal-dominant) touch drags move the window. */
  assert.equal(shouldEngageDrag("touch", true, 40, 0), true);
  assert.equal(shouldEngageDrag("touch", true, 40, 5), true);
  assert.equal(shouldEngageDrag("touch", true, 21, 20), true);
  /* Mouse and pen never get a scroll takeover: any direction moves. */
  assert.equal(shouldEngageDrag("mouse", true, 0, 40), true);
  assert.equal(shouldEngageDrag("pen", true, 0, 40), true);
  /* Touch drags from non-scrollable areas move in any direction. */
  assert.equal(shouldEngageDrag("touch", false, 0, 40), true);
  assert.equal(shouldEngageDrag("touch", false, 40, 0), true);
});

test("drag regression: the pulse freezes while dragging, and click-through never flips mid-drag", () => {
  const stylesCss = fs.readFileSync(path.join(__dirname, "..", "renderer", "styles.css"), "utf8");
  const rendererJs = fs.readFileSync(path.join(__dirname, "..", "renderer", "renderer.js"), "utf8");
  /* The pulse lives on the branch, not the bubble, so the
     is-dragging hover guard never reached it: the whole branch kept
     breathing (1 → 1.01) while the panel was dragged. A drag must
     freeze it too. */
  assert.ok(
    stylesCss.includes("#bubbleView.is-dragging #bubbleTree.pulse .pulse-item { animation: none !important; }"),
    "the branch pulse must freeze under is-dragging"
  );
  /* updateIgnoreMouse must bail while a drag is active. The
     mousemove listener re-evaluates click-through on every move,
     and as the panel slides under the pointer the pointer can land
     on a gap between bubbles — flipping the window click-through
     mid-gesture breaks the pointer stream on Windows (a
     pointercancel, or a move reporting buttons=0), which ends the
     drag early, drops is-dragging, and lets the hover scale back
     in while the user is still dragging. */
  const fnStart = rendererJs.indexOf("function updateIgnoreMouse");
  assert.ok(fnStart >= 0, "updateIgnoreMouse must exist");
  const fnHead = rendererJs.slice(fnStart, rendererJs.indexOf("const el = document.elementFromPoint", fnStart));
  assert.ok(fnHead.includes("if (dragState) return;"), "updateIgnoreMouse must return early while dragState is set");
});

test("drag regression v0.1.15: pointer capture keeps the stream alive on Windows", () => {
  const rendererJs = fs.readFileSync(path.join(__dirname, "..", "renderer", "renderer.js"), "utf8");
  /* Without capture the OS re-hit-tests after every setPosition and
     the stream breaks — a move reporting buttons=0 then ends the
     drag early while the button is still held, dropping
     is-dragging and letting the hover scale back in. Capture
     retargets the stream to the drag origin even off-window. */
  assert.ok(rendererJs.includes("e.target.setPointerCapture(e.pointerId)"), "the drag start must capture the pointer");
  assert.ok(rendererJs.includes('document.addEventListener("lostpointercapture"'), "a lost capture must end the drag cleanly");
  const lostStart = rendererJs.indexOf('document.addEventListener("lostpointercapture"');
  const lostBody = rendererJs.slice(lostStart, rendererJs.indexOf("});", lostStart));
  assert.ok(lostBody.includes("endPanelDrag(false)"), "a lost capture must end the drag without the root toggle");
});

test("drag regression v0.1.15: renders and height reports freeze mid-drag, then flush once", () => {
  const rendererJs = fs.readFileSync(path.join(__dirname, "..", "renderer", "renderer.js"), "utf8");
  /* A re-render mid-drag rebuilds the tree under the pointer
     (destroying the element being dragged from) and reports a new
     content height, resizing the window while it moves. Both are
     deferred, not dropped: the drag end flushes them once. */
  const renderStart = rendererJs.indexOf("function render() {");
  const renderHead = rendererJs.slice(renderStart, renderStart + 600);
  assert.ok(renderHead.includes("if (dragState) { renderDeferred = true; return; }"), "render() must defer while a drag is active");
  const reportStart = rendererJs.indexOf("function reportContentHeight() {");
  const reportHead = rendererJs.slice(reportStart, reportStart + 600);
  assert.ok(reportHead.includes("if (dragState) { heightDeferred = true; return; }"), "reportContentHeight() must defer while a drag is active");
  const endStart = rendererJs.indexOf("function endPanelDrag(allowToggle) {");
  const endBody = rendererJs.slice(endStart, rendererJs.indexOf("resetIdleTimer();", endStart));
  assert.ok(endBody.includes("if (renderDeferred) { renderDeferred = false; render(); }"), "the drag end must flush a deferred render");
  assert.ok(endBody.includes("else if (heightDeferred) { heightDeferred = false; reportContentHeight(); }"), "the drag end must flush a deferred height report");
  /* A timer armed before the drag must not hide the panel under it. */
  const downStart = rendererJs.indexOf('document.addEventListener("pointerdown"');
  const downBody = rendererJs.slice(downStart, rendererJs.indexOf('if (info.fromRoot) e.preventDefault();', downStart));
  assert.ok(downBody.includes("clearIdleTimer();"), "the drag start must clear the pending idle timer");
});

test("drag regression v0.1.15: the is-dragging guard covers every bubble and every animation", () => {
  const stylesCss = fs.readFileSync(path.join(__dirname, "..", "renderer", "styles.css"), "utf8");
  /* The old guard named event/value bubbles only. Every bubble
     shares .bubble (root, Next up, event, value, empty, sign-in),
     and a copy-pop already running when the drag starts would keep
     growing its bubble to 1.07 through the old guard. */
  assert.ok(
    stylesCss.includes("#bubbleView.is-dragging .bubble-tree .bubble { transform: none !important; animation: none !important; }"),
    "every bubble must freeze transform and animation under is-dragging"
  );
  assert.ok(
    stylesCss.includes("#bubbleView.is-dragging.inflate { animation: none !important; }"),
    "the inflate-on-open animation must freeze if a drag starts inside its first 250 ms"
  );
});

test("drag regression v0.1.15: a buttons=0 move must not end a captured drag", () => {
  const rendererJs = fs.readFileSync(path.join(__dirname, "..", "renderer", "renderer.js"), "utf8");
  /* The old branch ended the drag on any move reporting buttons=0 —
     the tripwire that killed the drag early on Windows while the
     button was still held. With pointer capture, pointerup always
     arrives, so the branch must only fire when capture failed. */
  assert.ok(rendererJs.includes("captured: false"), "dragState must track whether capture was established");
  assert.ok(rendererJs.includes("dragState.captured = true"), "a successful capture must be recorded");
  assert.ok(rendererJs.includes("if (!dragState.captured && !(e.buttons & 1)) { endPanelDrag(true); return; }"), "the buttons=0 early-end must only fire without capture");
});

test("drag regression v0.1.15: the post-drag click suppressor must expire on its own", () => {
  const rendererJs = fs.readFileSync(path.join(__dirname, "..", "renderer", "renderer.js"), "utf8");
  /* endPanelDrag arms suppressClickAfterDrag so the drag-end click
     cannot toggle the root bubble or copy a value. A window-moving
     drag does not reliably deliver that click at all, so without a
     deadline the flag would stay armed and eat the user's next real
     click. The next pointerdown clears it too (a real click is
     always preceded by one; the drag-end click is not). */
  const endStart = rendererJs.indexOf("function endPanelDrag(allowToggle) {");
  const endBody = rendererJs.slice(endStart, rendererJs.indexOf("resetIdleTimer();", endStart));
  assert.ok(endBody.includes("setTimeout(() => { suppressClickAfterDrag = false; }, 500);"), "the suppressor must expire 500 ms after the drag ends");
  const downStart = rendererJs.indexOf('document.addEventListener("pointerdown"');
  const downHead = rendererJs.slice(downStart, downStart + 300);
  assert.ok(downHead.includes("suppressClickAfterDrag = false;"), "a new gesture's pointerdown must clear the suppressor");
});
