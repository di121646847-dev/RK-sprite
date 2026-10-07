import test from "node:test";
import assert from "node:assert/strict";
import { advancePlayback } from "../src/playback.mjs";

test("preview speed changes frame advance without changing frame duration", () => {
  const frames = [{ durationMs: 100 }, { durationMs: 100 }, { durationMs: 100 }];
  assert.deepEqual(advancePlayback(frames, 0, 0, 50, 1), { index: 0, elapsedMs: 50 });
  assert.deepEqual(advancePlayback(frames, 0, 0, 50, 2), { index: 1, elapsedMs: 0 });
  assert.deepEqual(advancePlayback(frames, 0, 0, 50, 0.5), { index: 0, elapsedMs: 25 });
  assert.deepEqual(frames.map((frame) => frame.durationMs), [100, 100, 100]);
});

test("preview speed accounts for individual durations and wraps", () => {
  const frames = [{ durationMs: 20 }, { durationMs: 40 }];
  assert.deepEqual(advancePlayback(frames, 0, 0, 25, 2), { index: 1, elapsedMs: 30 });
  assert.deepEqual(advancePlayback(frames, 1, 30, 10, 2), { index: 0, elapsedMs: 10 });
});

test("disabled frames are skipped on entry and on wrap without changing authored timing", () => {
  const frames = [{ durationMs: 80 }, { durationMs: 100, disabled: true }, { durationMs: 40 }];
  assert.deepEqual(advancePlayback(frames, 0, 0, 90, 1), { index: 2, elapsedMs: 10 });
  assert.deepEqual(advancePlayback(frames, 2, 25, 20, 1), { index: 0, elapsedMs: 5 });
  assert.deepEqual(advancePlayback(frames, 1, 0, 0, 1), { index: 2, elapsedMs: 0 });
  assert.deepEqual(advancePlayback(frames.map((frame) => ({ ...frame, disabled: true })), 1, 0, 100, 1), { index: 1, elapsedMs: 0 });
});
