"use strict";
/* Click-through hit test — pure module (no Electron): which elements
   count as "content" the pointer is over, so clicks on them stay
   in-app, while clicks on genuinely transparent window area pass
   through to whatever is behind the overlay.
   Only LEAF interactive elements count. The old selector listed the
   big containers (.bubble-tree, .bubble-header, .calendar-view), so
   a visibly transparent gap between bubbles still hit-tested as
   "interactive" — elementFromPoint returns the tree for a gap — and
   the window ate the click. A gap must now read as empty. */
const CLICKABLE_SELECTOR = "button, input, select, textarea, a, .bubble, .search-box, .create-menu, .cal-cell, .cal-event, .week-event";
function isOverInteractive(el) {
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest(CLICKABLE_SELECTOR);
}
module.exports = { CLICKABLE_SELECTOR, isOverInteractive };
