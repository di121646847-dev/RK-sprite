import assert from "node:assert/strict";
import test from "node:test";
import { ProjectHistory } from "../src/history.mjs";

test("undo and redo restore the complete project and selection independently", () => {
  const history = new ProjectHistory();
  const project = { animations: [{ id: "run", frames: [{ id: "one" }], layers: [] }] };
  const selection = { animationId: "run", frameIndex: 0, layerId: "" };
  history.reset(project, selection);
  assert.equal(history.canUndo, false);
  assert.equal(history.record(project, selection), false);
  project.animations[0].frames.push({ id: "two" });
  selection.frameIndex = 1;
  assert.equal(history.record(project, selection), true);
  assert.equal(history.isDirty(project), true);

  const previous = history.undo();
  assert.deepEqual(previous.project.animations[0].frames.map((frame) => frame.id), ["one"]);
  assert.equal(previous.selection.frameIndex, 0);
  previous.project.animations[0].frames.push({ id: "unexpected" });
  const next = history.redo();
  assert.deepEqual(next.project.animations[0].frames.map((frame) => frame.id), ["one", "two"]);
  assert.equal(next.selection.frameIndex, 1);
  assert.equal(history.canRedo, false);
});

test("saved state survives undo, redo, and a new edit truncates the redo branch", () => {
  const history = new ProjectHistory();
  const project = { width: 32 };
  const selection = { animationId: "", frameIndex: 0, layerId: "" };
  history.reset(project, selection);
  project.width = 64;
  history.record(project, selection);
  history.markSaved(project);
  assert.equal(history.isDirty(project), false);
  const undone = history.undo();
  assert.equal(history.isDirty(undone.project), true);
  const redone = history.redo();
  assert.equal(history.isDirty(redone.project), false);

  const previous = history.undo();
  previous.project.width = 96;
  history.record(previous.project, selection);
  assert.equal(history.canRedo, false);
  assert.equal(history.isDirty(previous.project), true);
  history.reset(previous.project, selection);
  assert.equal(history.canUndo, false);
  assert.equal(history.isDirty(previous.project), false);
});

test("history keeps a bounded number of completed edits", () => {
  const history = new ProjectHistory(2);
  const project = { width: 0 };
  history.reset(project, {});
  for (const width of [1, 2, 3]) {
    project.width = width;
    history.record(project, {});
  }
  assert.equal(history.undo().project.width, 2);
  assert.equal(history.undo().project.width, 1);
  assert.equal(history.canUndo, false);
});
