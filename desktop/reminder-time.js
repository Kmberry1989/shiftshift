"use strict";
/* Reminder fire-time math (v0.1.14) — pure module, no Electron,
   so the tests can exercise it directly.

   A reminder fires at the event start minus the lead. Minute and
   hour leads are plain epoch subtraction. Whole-day leads (1 day,
   2 days, 1 week) subtract CALENDAR days — the same wall-clock
   time the day(s) before — not 1440 minutes of epoch time: across
   a daylight-saving change the two differ by an hour (spring
   forward: 24 h before a 5:30 PM event is 6:30 PM the day before;
   fall back: 4:30 PM). Date#setDate keeps the wall-clock time,
   so it is correct on both sides of the change. */

function reminderFireMs(startMs, leadMinutes) {
  if (typeof startMs !== "number" || !Number.isFinite(startMs)) return null;
  if (typeof leadMinutes !== "number" || !Number.isFinite(leadMinutes) || leadMinutes < 0) return null;
  if (leadMinutes >= 1440 && leadMinutes % 1440 === 0) {
    const d = new Date(startMs);
    d.setDate(d.getDate() - leadMinutes / 1440);
    return d.getTime();
  }
  return startMs - leadMinutes * 60 * 1000;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { reminderFireMs };
}
