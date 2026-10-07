import test from "node:test";
import assert from "node:assert/strict";
import { framePlacement, gridFrames, parseAtlas, sourceCanvas } from "../src/atlas.mjs";

test("parses RK sprite exported frame array using the shared source canvas", () => {
  const frames = parseAtlas({
    canvas: { width: 64, height: 48 },
    frames: [
      { filename: "a.png", x: 0, y: 0, w: 64, h: 48, durationMs: 90 },
      { filename: "b.png", x: 64, y: 0, w: 64, h: 48, durationMs: 110 },
    ],
  }, 128, 48);
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[1].crop, { x: 64, y: 0, w: 64, h: 48 });
  assert.deepEqual(sourceCanvas(frames), { width: 64, height: 48 });
  assert.deepEqual(frames.map((frame) => frame.durationMs), [90, 110]);
});

test("parses Aseprite-style trimmed frames with bottom-center restoration", () => {
  const [frame] = parseAtlas({
    frames: {
      "run_1.png": {
        frame: { x: 13, y: 8, w: 18, h: 21 },
        rotated: false,
        spriteSourceSize: { x: 7, y: 9, w: 18, h: 21 },
        sourceSize: { w: 40, h: 36 },
        duration: 75,
      },
    },
  }, 64, 64);
  assert.deepEqual(framePlacement(frame, { width: 64, height: 48 }), { x: 19, y: 21 });
  assert.equal(frame.durationMs, 75);
  assert.throws(() => framePlacement(frame, { width: 32, height: 32 }), /exceeds/);
});

test("parses natural-number object frame order and rejects rotated or out-of-bounds regions", () => {
  const frames = parseAtlas({
    frames: {
      "frame_10": { frame: { x: 10, y: 0, w: 10, h: 10 } },
      "frame_2": { frame: { x: 0, y: 0, w: 10, h: 10 } },
    },
  }, 20, 10, 10);
  assert.deepEqual(frames.map((frame) => frame.name), ["frame_2", "frame_10"]);
  assert.throws(() => parseAtlas({
    frames: [{ frame: { x: 0, y: 0, w: 10, h: 10 }, rotated: true }],
  }, 20, 10), /rotated/);
  assert.throws(() => parseAtlas({
    frames: [{ frame: { x: 15, y: 0, w: 10, h: 10 } }],
  }, 20, 10), /bounds/);
});

test("slices one grid PNG into full cells with margin and spacing", () => {
  const frames = gridFrames(67, 24, {
    cellWidth: 20, cellHeight: 10, marginX: 2, marginY: 1,
    gapX: 2, gapY: 2, count: 3,
  });
  assert.deepEqual(frames.map((frame) => frame.crop), [
    { x: 2, y: 1, w: 20, h: 10 },
    { x: 24, y: 1, w: 20, h: 10 },
    { x: 46, y: 1, w: 20, h: 10 },
  ]);
  assert.deepEqual(sourceCanvas(frames), { width: 20, height: 10 });
  assert.throws(() => gridFrames(40, 10, { cellWidth: 20, cellHeight: 10, count: 3 }), /complete/);
});
