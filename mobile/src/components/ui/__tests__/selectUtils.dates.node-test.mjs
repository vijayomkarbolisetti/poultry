/**
 * Focused Node assertions for date-only helpers used by AppDatePicker.
 * Run: node mobile/src/components/ui/__tests__/selectUtils.dates.node-test.mjs
 *
 * Inline copies of pure logic from selectUtils.ts (no TS loader required).
 * Keep in sync with formatIsoDate / parseIsoDate / todayIsoDate /
 * formatDisplayDate / compareIsoDates / clampIsoDate.
 */
import assert from "node:assert/strict";

function formatIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [ys, ms, ds] = value.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

function todayIsoDate() {
  return formatIsoDate(new Date());
}

function formatDisplayDate(iso) {
  if (!iso) return "";
  const d = parseIsoDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function compareIsoDates(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function clampIsoDate(value, minimumDate, maximumDate) {
  let next = value;
  if (minimumDate && compareIsoDates(next, minimumDate) < 0) next = minimumDate;
  if (maximumDate && compareIsoDates(next, maximumDate) > 0) next = maximumDate;
  return next;
}

// --- valid ISO parsing ---
{
  const d = parseIsoDate("2026-10-23");
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 23);
}

// --- invalid date handling ---
assert.equal(parseIsoDate(""), null);
assert.equal(parseIsoDate("2026-10-23T12:00:00Z"), null);
assert.equal(parseIsoDate("23-10-2026"), null);
assert.equal(parseIsoDate("2026-13-01"), null);
assert.equal(parseIsoDate("2026-02-30"), null);
assert.equal(parseIsoDate("not-a-date"), null);

// --- local today formatting ---
{
  const today = todayIsoDate();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(today, formatIsoDate(new Date()));
}

// --- display formatting ---
assert.equal(formatDisplayDate(null), "");
assert.equal(formatDisplayDate(undefined), "");
assert.equal(formatDisplayDate("bad"), "bad");
{
  const label = formatDisplayDate("2026-10-23");
  assert.ok(label.includes("2026"));
  assert.ok(/oct/i.test(label));
  assert.ok(label.includes("23"));
}

// --- round-trip without day shift (local calendar, not UTC) ---
{
  const iso = "2026-10-23";
  const parsed = parseIsoDate(iso);
  assert.ok(parsed);
  assert.equal(formatIsoDate(parsed), iso);
}

// Contrast with UTC-unsafe toISOString: early local morning in UTC+ can be previous UTC day.
{
  const local = parseIsoDate("2026-01-01");
  assert.equal(formatIsoDate(local), "2026-01-01");
  const earlyLocal = new Date(2026, 0, 1, 0, 30, 0);
  assert.equal(formatIsoDate(earlyLocal), "2026-01-01");
  // In positive offsets (e.g. IST), 00:30 local is still 31 Dec UTC.
  if (earlyLocal.getTimezoneOffset() < 0) {
    assert.equal(earlyLocal.toISOString().slice(0, 10), "2025-12-31");
    assert.notEqual(earlyLocal.toISOString().slice(0, 10), formatIsoDate(earlyLocal));
  }
}

// --- clamp / compare ---
assert.equal(compareIsoDates("2026-10-22", "2026-10-23"), -1);
assert.equal(compareIsoDates("2026-10-23", "2026-10-23"), 0);
assert.equal(compareIsoDates("2026-10-24", "2026-10-23"), 1);
assert.equal(clampIsoDate("2026-10-20", "2026-10-22", "2026-10-25"), "2026-10-22");
assert.equal(clampIsoDate("2026-10-30", "2026-10-22", "2026-10-25"), "2026-10-25");
assert.equal(clampIsoDate("2026-10-23", "2026-10-22", "2026-10-25"), "2026-10-23");
assert.equal(clampIsoDate("2026-10-23", null, todayIsoDate()), "2026-10-23");

console.log("selectUtils.dates.node-test.mjs: all assertions passed");
