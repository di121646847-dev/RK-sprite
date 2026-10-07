import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildManifest, syncGodot } = require("../electron/godot-sync.cjs");
const runtimeFile = path.resolve(import.meta.dirname, "..", "godot", "rk_sprite_player_v2.gd");

test("Godot manifest keeps per-frame order and excludes preview-only layers", () => {
  const project = { canvas: { width: 32, height: 32 }, animations: [{ id: "run", name: "Run", playbackSpeed: 2.5 }] };
  const frame = { frameId: "a", sourceIndex: 1, durationMs: 90, behind: false, present: true };
  const items = [
    { name: "run_body", metadata: { animation: "run", layer: "body", frames: [frame] } },
    { name: "run_coat", metadata: { animation: "run", layer: "coat", name: "Coat", slot: "upper", visible: false,
      frames: [{ ...frame, behind: true }] } },
  ];
  const manifest = buildManifest(project, items);
  assert.equal(manifest.actions.run.layers[0].defaultVisible, false);
  assert.equal(manifest.actions.run.playbackSpeed, 2.5);
  assert.deepEqual(manifest.actions.run.frames, [{ id: "a", sourceIndex: 1, durationMs: 90 }]);
  items[1].metadata.frames[0].frameId = "different";
  assert.throws(() => buildManifest(project, items), /mismatched/);
});

test("Godot sync confines generated files and preserves edited runtime scene", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rk-sync-test-"));
  try {
    const root = path.join(temp, "game");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "project.godot"), "config_version=5\n");
    fs.writeFileSync(path.join(root, "custom.txt"), "user");
    const projectFile = path.join(temp, "Hero.rksprite");
    const project = { canvas: { width: 1, height: 1 }, animations: [{ id: "idle", name: "Idle" }] };
    const item = { name: "idle_body", image: "data:image/png;base64," +
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/O3sAAAAASUVORK5CYII=",
    metadata: { app: "RK sprite", animation: "idle", layer: "body",
      sheet: { image: "idle_body.png" }, frames: [{ frameId: "a", sourceIndex: 0, durationMs: 83 }] } };
    const result = syncGodot(projectFile, project, [item], root, runtimeFile);
    assert.ok(fs.existsSync(path.join(result.directory, "animation.json")));
    assert.equal(JSON.parse(fs.readFileSync(path.join(result.directory, "animation.json"), "utf8")).actions.idle.playbackSpeed, 1);
    assert.equal(fs.readFileSync(path.join(root, "custom.txt"), "utf8"), "user");
    const scene = path.join(result.directory, "player.tscn");
    const oldScene = fs.readFileSync(scene, "utf8").replace("rk_sprite_player_v2.gd", "rk_sprite_player_v1.gd");
    fs.writeFileSync(scene, oldScene);
    syncGodot(projectFile, project, [item], root, runtimeFile);
    assert.match(fs.readFileSync(scene, "utf8"), /rk_sprite_player_v2\.gd/);
    fs.writeFileSync(scene, "user scene");
    assert.throws(() => syncGodot(projectFile, project, [item], root, runtimeFile), /不会覆盖/);
    assert.equal(fs.readFileSync(scene, "utf8"), "user scene");
    item.name = "../outside";
    assert.throws(() => syncGodot(projectFile, project, [item], root, runtimeFile), /Invalid atlas file name/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
