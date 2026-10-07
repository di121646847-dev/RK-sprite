import assert from "node:assert/strict";
import test from "node:test";
import { gridLayout, onionFrames, snapCoordinate } from "../src/canvas-guides.mjs";

test("grid is visible below 400 percent without changing the snap step", () => {
  for (const zoom of [0.1, 0.5, 1, 1.5, 4, 8]) {
    for (const step of [1, 8, 16]) {
      const grid = gridLayout(step, zoom);
      assert.equal(grid.step, step);
      assert.ok(grid.spacing >= 4);
      assert.equal(grid.displayStep % step, 0);
    }
  }
});

test("snap uses canvas position including frame offset, not just the layer-local offset", () => {
  assert.equal(snapCoordinate(5, 8), 8);
  assert.equal(snapCoordinate(-5, 8), -8);
  assert.equal(snapCoordinate(5, 8, 3.25), 4.75);
  assert.equal(snapCoordinate(0, 1, 0.5), 0.5);
  assert.equal(snapCoordinate(4.9, 8, 193), 7);
});

test("onion skin skips disabled frames, wraps, and does not draw a neighbor twice", () => {
  const frames = [{ id: 0 }, { id: 1, disabled: true }, { id: 2 }, { id: 3 }];
  assert.deepEqual(onionFrames(frames, frames[0]), [frames[3], frames[2]]);
  assert.deepEqual(onionFrames(frames, frames[3]), [frames[2], frames[0]]);
  assert.deepEqual(onionFrames(frames.slice(0, 3), frames[0]), [frames[2]]);
  assert.deepEqual(onionFrames(frames.slice(0, 1), frames[0]), []);
});
