import test from "node:test";
import assert from "node:assert/strict";
import {
  addAnimation, addLayer, copyLayerTransform, editLayer, exportPlan, frameOffset, layerBehind, makeFrame, makeProject,
  migrateProject, removeAnimation, removeLayer, renameAnimation, reorderFrame, replaceAnimation, validateProject,
} from "../src/model.mjs";

test("keeps animation frames and outfit slots separate from preview layers", () => {
  const project = makeProject("Hero");
  const run = addAnimation(project, "run", 12);
  const first = makeFrame("assets/a.png", 83, 0);
  const second = makeFrame("assets/b.png", 160, 83);
  run.frames.push(first, second);
  const armor = addLayer(run, "Armor", "equipment", "upper");
  armor.instances[first.id] = { asset: "assets/armor.png", x: 12, y: -7, scale: 1, rotation: 5, pivotX: .5, pivotY: .5 };
  const weapon = addLayer(run, "Sword", "preview");
  weapon.instances[first.id] = { asset: "assets/sword.png", x: 19, y: -9, scale: 1, rotation: 30, pivotX: .2, pivotY: .8 };
  const plan = exportPlan(project);
  assert.deepEqual(plan.map((entry) => entry.layer.kind), ["body", "equipment"]);
  assert.equal(plan[1].layer.slot, "upper");
  assert.deepEqual(run.frames.map((frame) => frame.durationMs), [83, 160]);
  assert.equal(plan[0].sheetWidth, 1024);
  assert.equal(plan[0].sheetHeight, 512);
  assert.equal(validateProject(project), project);
});

test("rejects duplicate animations and invalid frame timing", () => {
  const project = makeProject();
  addAnimation(project, "idle", 12);
  assert.equal(addAnimation(project, "跑步", 12).id, "跑步");
  assert.throws(() => addAnimation(project, "idle", 12), /already exists/);
  assert.throws(() => makeFrame("assets/a.png", 0), /Invalid/);
  assert.throws(() => addAnimation(project, "../bad", 100), /FPS/);
});

test("guards against oversized atlases before rendering", () => {
  const project = makeProject();
  project.canvas = { width: 8192, height: 8192 };
  addAnimation(project, "idle", 12).frames.push(makeFrame("assets/a.png", 83), makeFrame("assets/b.png", 83));
  assert.throws(() => exportPlan(project), /too large/);
});

test("renames and removes actions and layers without touching unrelated bindings", () => {
  const project = makeProject();
  const idle = addAnimation(project, "idle", 12);
  const run = addAnimation(project, "run", 12);
  const first = makeFrame("assets/idle.png", 83);
  const second = makeFrame("assets/run.png", 83);
  idle.frames.push(first);
  run.frames.push(second);
  const coat = addLayer(idle, "Coat", "equipment", "upper");
  coat.instances[first.id] = { asset: "assets/coat-idle.png" };
  const runningCoat = addLayer(run, "Coat", "equipment", "upper");
  runningCoat.instances[second.id] = { asset: "assets/coat-run.png" };
  assert.throws(() => renameAnimation(project, "idle", "run"), /already exists/);
  assert.equal(renameAnimation(project, "idle", "stand").id, "stand");
  assert.equal(editLayer(idle, coat.id, { name: "Jacket", kind: "preview" }).slot, "");
  assert.equal(editLayer(idle, coat.id, { name: "Jacket", kind: "equipment", slot: "torso" }).slot, "torso");
  removeAnimation(project, "stand");
  assert.equal(project.animations[0].id, "run");
  assert.equal(run.layers[0].instances[second.id].asset, "assets/coat-run.png");
  removeLayer(run, runningCoat.id);
  assert.deepEqual(run.layers, []);
  validateProject(project);
});

test("replacing an action keeps unrelated animations and clears only replaced frame bindings", () => {
  const project = makeProject();
  const old = addAnimation(project, "idle", 12);
  const run = addAnimation(project, "run", 12);
  const oldFrame = makeFrame("assets/old.png", 83);
  const runFrame = makeFrame("assets/run.png", 83);
  old.frames.push(oldFrame);
  run.frames.push(runFrame);
  const layer = addLayer(old, "Coat", "equipment", "upper");
  old.playbackSpeed = 2.5;
  layer.instances[oldFrame.id] = { asset: "assets/old-coat.png" };
  const runLayer = addLayer(run, "Run Coat", "equipment", "upper");
  runLayer.instances[runFrame.id] = { asset: "assets/run-coat.png" };
  const replacement = { ...old, frames: [makeFrame("assets/new.png", 120)] };
  replaceAnimation(project, replacement);
  assert.equal(project.animations.length, 2);
  assert.equal(project.animations[0], replacement);
  assert.equal(project.animations[1], run);
  assert.deepEqual(replacement.layers[0].instances, {});
  assert.equal(replacement.playbackSpeed, 2.5);
  assert.equal(runLayer.instances[runFrame.id].asset, "assets/run-coat.png");
  validateProject(project);
});

test("each action owns its speed; legacy actions default to one times without changing frame timing", () => {
  const project = makeProject();
  const run = addAnimation(project, "run");
  const idle = addAnimation(project, "idle");
  run.playbackSpeed = 2;
  idle.frames.push(makeFrame("idle.png", 83));
  delete idle.playbackSpeed;
  assert.equal(renameAnimation(project, "run", "sprint").playbackSpeed, 2);
  assert.equal(run.frames.length, 0);
  assert.equal(idle.playbackSpeed ?? 1, 1);
  validateProject(project);
  run.playbackSpeed = 9;
  assert.throws(() => validateProject(project), /Invalid animation/);
});

test("legacy paint layers stay readable but new paint layers cannot be created", () => {
  const project = makeProject();
  const animation = addAnimation(project, "idle");
  const frame = makeFrame("assets/body.png", 83);
  animation.frames.push(frame);
  animation.layers.push({
    id: "old-paint", name: "Old paint", kind: "paint", slot: "", visible: true,
    instances: { [frame.id]: { asset: "assets/old-paint.png" } },
  });
  assert.throws(() => addLayer(animation, "New paint", "paint"), /Unknown layer/);
  assert.equal(validateProject(project), project);
  assert.deepEqual(exportPlan(project).map((entry) => entry.layer.kind), ["body", "paint"]);
});

test("older global layers migrate to their frame-owning animation", () => {
  const project = makeProject();
  const idle = addAnimation(project, "idle");
  const run = addAnimation(project, "run");
  const idleFrame = makeFrame("assets/idle.png", 83);
  const runFrame = makeFrame("assets/run.png", 83);
  idle.frames.push(idleFrame);
  run.frames.push(runFrame);
  project.layers = [
    { id: "coat", name: "Coat", kind: "equipment", instances: {
      [idleFrame.id]: { asset: "assets/idle-coat.png" },
      [runFrame.id]: { asset: "assets/run-coat.png" },
    } },
    { id: "orphan", name: "Orphan", kind: "preview", instances: { missing: { asset: "assets/orphan.png" } } },
  ];
  assert.equal(migrateProject(project), true);
  assert.equal(idle.layers[0].instances[idleFrame.id].asset, "assets/idle-coat.png");
  assert.equal(run.layers[0].instances[runFrame.id].asset, "assets/run-coat.png");
  assert.equal(idle.layers[1], undefined);
  assert.equal(project.layers, undefined);
  assert.equal(project.legacyLayers[0].instances.missing.asset, "assets/orphan.png");
  assert.equal(validateProject(project), project);
});

test("each animation owns its own frame layers and export data", () => {
  const project = makeProject();
  const idle = addAnimation(project, "idle");
  const attack = addAnimation(project, "attack");
  const idleFrame = makeFrame("idle.png", 83);
  const attackFrame = makeFrame("attack.png", 83);
  idle.frames.push(idleFrame);
  attack.frames.push(attackFrame);
  const idleCoat = addLayer(idle, "Coat", "equipment", "upper");
  idleCoat.instances[idleFrame.id] = { asset: "idle-coat.png" };
  const attackCoat = addLayer(attack, "Coat", "equipment", "upper");
  attackCoat.instances[attackFrame.id] = { asset: "attack-coat.png" };
  assert.notEqual(idleCoat.id, attackCoat.id);
  assert.equal(idle.layers[0].instances[attackFrame.id], undefined);
  assert.equal(attack.layers[0].instances[idleFrame.id], undefined);
  assert.deepEqual(exportPlan(project).map((set) => [set.animation.id, set.layer.kind]), [
    ["idle", "body"], ["idle", "equipment"], ["attack", "body"], ["attack", "equipment"],
  ]);
});

test("reorders whole frames without separating timing or layer bindings", () => {
  const project = makeProject();
  const run = addAnimation(project, "run");
  const frames = [
    makeFrame("a.png", 80, 0),
    makeFrame("b.png", 140, 80),
    makeFrame("c.png", 220, 220),
  ];
  run.frames.push(...frames);
  const coat = addLayer(run, "Coat", "equipment", "upper");
  coat.instances[frames[1].id] = { asset: "b-coat.png", x: 12 };
  assert.equal(reorderFrame(run, frames[1].id, 3), 2);
  assert.deepEqual(run.frames.map((frame) => frame.asset), ["a.png", "c.png", "b.png"]);
  assert.deepEqual(run.frames.map((frame) => frame.durationMs), [80, 220, 140]);
  assert.deepEqual(run.frames.map((frame) => frame.timeMs), [0, 220, 80]);
  assert.equal(coat.instances[run.frames[2].id].asset, "b-coat.png");
  assert.equal(reorderFrame(run, frames[1].id, 0), 0);
  assert.deepEqual(run.frames.map((frame) => frame.asset), ["b.png", "a.png", "c.png"]);
  assert.equal(reorderFrame(run, frames[1].id, 0), null);
  assert.equal(reorderFrame(run, "missing", 1), null);
  assert.equal(reorderFrame(run, frames[0].id, 4), null);
  validateProject(project);
});

test("per-frame order, disabled playback export, and alignment survive old defaults", () => {
  const project = makeProject();
  const action = addAnimation(project, "attack");
  const frames = [makeFrame("a.png", 90), makeFrame("b.png", 120), makeFrame("c.png", 75)];
  action.frames.push(...frames);
  const coat = addLayer(action, "Coat", "equipment", "upper");
  coat.behind = true;
  coat.instances[frames[0].id] = { asset: "coat-a.png", behind: false };
  coat.instances[frames[2].id] = { asset: "coat-c.png" };
  frames[0].offsetX = 4;
  frames[0].offsetY = -7;
  frames[1].disabled = true;
  assert.deepEqual(frameOffset(frames[0]), { x: 4, y: -7 });
  assert.equal(layerBehind(coat, frames[0]), false);
  assert.equal(layerBehind(coat, frames[2]), true);
  const plan = exportPlan(project);
  assert.deepEqual(plan.map((entry) => entry.frames.map((frame) => frame.id)), [
    [frames[0].id, frames[2].id], [frames[0].id, frames[2].id],
  ]);
  delete frames[2].offsetX;
  delete frames[2].offsetY;
  assert.deepEqual(frameOffset(frames[2]), { x: 0, y: 0 });
  validateProject(project);
});

test("transform-only copy preserves target frame assets and per-frame layer order", () => {
  const project = makeProject();
  const action = addAnimation(project, "attack");
  const frames = [makeFrame("a.png", 90), makeFrame("b.png", 90), makeFrame("c.png", 90)];
  action.frames.push(...frames);
  const coat = addLayer(action, "Coat", "equipment", "upper");
  coat.instances[frames[0].id] = { asset: "red.png", x: 8, y: 9, scale: 1.5, rotation: 32, pivotX: .2, pivotY: .7, behind: true };
  coat.instances[frames[1].id] = { asset: "blue.png", x: 0, behind: false };
  assert.equal(copyLayerTransform(action, coat, frames[0]), 1);
  assert.deepEqual(coat.instances[frames[1].id], {
    asset: "blue.png", x: 8, y: 9, scale: 1.5, rotation: 32, pivotX: .2, pivotY: .7, behind: false,
  });
  assert.equal(coat.instances[frames[2].id], undefined);
  assert.equal(validateProject(project), project);
});
