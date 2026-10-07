import test from "node:test";
import assert from "node:assert/strict";
import { sampleTimes } from "../src/video-sampling.mjs";

test("selects one frame every requested number of seconds", () => {
  assert.deepEqual(sampleTimes({
    start: 1, end: 2, duration: 3, mode: "interval", interval: 0.25,
  }), [1, 1.25, 1.5, 1.75]);
});

test("takes Y evenly spaced frames in every X-second interval from the trim start", () => {
  assert.deepEqual(sampleTimes({
    start: 0.5, end: 2.5, duration: 3, mode: "interval", interval: 1, framesPerInterval: 4,
  }), [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25]);
  assert.deepEqual(sampleTimes({
    start: 0, end: 1.2, duration: 2, mode: "interval", interval: 1, framesPerInterval: 2,
  }), [0, 0.5, 1]);
});

test("supports FPS sampling and excludes the end boundary", () => {
  assert.deepEqual(sampleTimes({
    start: 0, end: 0.6, duration: 1, mode: "fps", fps: 5,
  }), [0, 0.2, 0.4]);
});

test("rejects invalid intervals and too many candidate frames", () => {
  assert.throws(() => sampleTimes({
    start: 0, end: 1, duration: 1, mode: "interval", interval: 0,
  }), /间隔/);
  assert.throws(() => sampleTimes({
    start: 0, end: 10, duration: 10, mode: "interval", interval: 0.01,
  }), /最多/);
  assert.throws(() => sampleTimes({
    start: 0, end: 2, duration: 1, mode: "interval", interval: 0.5,
  }), /起点和终点/);
  assert.throws(() => sampleTimes({
    start: 0, end: 1, duration: 2, mode: "interval", interval: 1, framesPerInterval: 0,
  }), /1–60/);
});
