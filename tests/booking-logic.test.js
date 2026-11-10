import test from "node:test";
import assert from "node:assert/strict";
import { parseTimeSlot, slotsOverlap } from "../controllers/bookingController.js";

test("parseTimeSlot accepts valid HH:MM-HH:MM and rejects invalid", () => {
  assert.deepEqual(parseTimeSlot("09:00-11:00"), { start: 540, end: 660 });
  assert.equal(parseTimeSlot("9:00-11:00"), null);
  assert.equal(parseTimeSlot("11:00-09:00"), null);
  assert.equal(parseTimeSlot("11:00-11:00"), null);
  assert.equal(parseTimeSlot("24:00-25:00"), null);
  assert.equal(parseTimeSlot("bad"), null);
});

test("slotsOverlap detects overlapping and non-overlapping ranges", () => {
  assert.equal(slotsOverlap("10:00-11:00", "10:30-11:30"), true);
  assert.equal(slotsOverlap("10:00-11:00", "09:00-10:30"), true);
  assert.equal(slotsOverlap("10:00-11:00", "11:00-12:00"), false);
  assert.equal(slotsOverlap("10:00-11:00", "09:00-10:00"), false);
  assert.equal(slotsOverlap("10:00-12:00", "11:00-11:30"), true);
});
