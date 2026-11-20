"use strict";
/* Dragging is disabled (v0.1.16, Kyle's call: the drag-scale issue
   persisted through two fixes). No pointerdown starts a move, the
   drag IPC and the is-dragging machinery are gone, and every click
   behavior still works — copy on value click, expand/collapse,
   header buttons, search, Create event menu. The bubble stays
   where it is; positioning is via Settings → Position only. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");
const rendererJs = read(path.join(DESKTOP, "renderer", "renderer.js"));
const stylesCss = read(path.join(DESKTOP, "renderer", "styles.css"));
const mainJs = read(path.join(DESKTOP, "main.js"));
const preloadJs = read(path.join(DESKTOP, "preload.js"));
const indexHtml = read(path.join(DESKTOP, "renderer", "index.html"));
const positionJs = read(path.join(DESKTOP, "position.js"));

test("the drag module is gone and nothing imports it", () => {
  assert.ok(!fs.existsSync(path.join(DESKTOP, "renderer", "drag.js")), "renderer/drag.js must not exist");
  assert.ok(!rendererJs.includes('from "./drag.js"'), "renderer must not import the drag helper");
  assert.ok(!rendererJs.includes("classifyDragTarget"), "no drag target classification may remain");
  assert.ok(!rendererJs.includes("isDragMovement"), "no drag movement rule may remain");
  assert.ok(!rendererJs.includes("shouldEngageDrag"), "no drag engage gate may remain");
});

test("no pointerdown starts a move: no drag state, no drag IPC, no suppressor", () => {
  assert.ok(!rendererJs.includes("dragState"), "no drag state may remain");
  assert.ok(!rendererJs.includes("endPanelDrag"), "no drag-end function may remain");
  assert.ok(!rendererJs.includes("suppressClickAfterDrag"), "no post-drag click suppressor may remain");
  assert.ok(!rendererJs.includes("window.sideshow.dragStart"), "no drag-start IPC call may remain");
  assert.ok(!rendererJs.includes("window.sideshow.dragMove"), "no drag-move IPC call may remain");
  assert.ok(!rendererJs.includes("window.sideshow.dragEnd"), "no drag-end IPC call may remain");
  assert.ok(!rendererJs.includes("renderDeferred"), "no drag-deferred render may remain");
  assert.ok(!rendererJs.includes("heightDeferred"), "no drag-deferred height report may remain");
  assert.ok(!rendererJs.includes("is-dragging"), "no is-dragging class may remain");
  assert.ok(!rendererJs.includes("setPointerCapture"), "no pointer capture for dragging may remain");
});

test("main has no drag IPC handlers and preload exposes no drag calls", () => {
  for (const ch of ["sideshow:drag-start", "sideshow:drag-move", "sideshow:drag-end"]) {
    assert.ok(!mainJs.includes(ch), "main must not handle " + ch);
    assert.ok(!preloadJs.includes(ch), "preload must not expose " + ch);
  }
  assert.ok(!mainJs.includes("dragStartPos"), "no drag start position may remain");
  assert.ok(!positionJs.includes("clampDragPosition"), "the drag clamp must be gone with dragging");
});

test("styles carry no is-dragging rules", () => {
  assert.ok(!stylesCss.includes("is-dragging"), "no is-dragging rule may remain");
});

test("clicking the root bubble still toggles the focused event", () => {
  /* The toggle used to live in endPanelDrag's no-drag branch; with
     dragging gone it is a plain click listener on the root bubble. */
  const rootStart = rendererJs.indexOf('root.className = "bubble root-bubble pulse-item"');
  assert.ok(rootStart >= 0, "the root bubble must be created in render()");
  const rootBlock = rendererJs.slice(rootStart, rendererJs.indexOf("tree.appendChild(root);", rootStart));
  assert.ok(rootBlock.includes('root.addEventListener("click"'), "the root bubble must carry its own click listener");
  assert.ok(rootBlock.includes("focusedEvent = null"), "the click must close the focused event");
  assert.ok(rootBlock.includes("focusedEvent = events[0]"), "the click must open the first event when none is focused");
});

test("click behaviors still work: copy, expand, header buttons, search, Create menu", () => {
  assert.ok(rendererJs.includes("window.sideshow.copy("), "value clicks must still copy");
  assert.ok(indexHtml.includes('id="searchInput"') || rendererJs.includes("searchInput"), "the search box must still exist");
  assert.ok(indexHtml.includes('id="settingsBtn"'), "the settings button must still exist");
  assert.ok(indexHtml.includes('id="calendarViewBtn"'), "the calendar button must still exist");
  assert.ok(indexHtml.includes('id="closeBtn"'), "the close button must still exist");
  assert.ok(indexHtml.includes('id="createEventBtn"'), "the Create event button must still exist");
  assert.ok(rendererJs.includes("closeCreateMenu"), "the Create menu must still close");
});
