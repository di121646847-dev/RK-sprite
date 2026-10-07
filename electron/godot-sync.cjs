const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const RUNTIME_PATH = "rk_sprite/runtime/rk_sprite_player_v2.gd";
const PREVIOUS_RUNTIME_PATH = "rk_sprite/runtime/rk_sprite_player_v1.gd";

function projectSlug(projectFile) {
  const label = path.parse(projectFile).name.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36) || "sprite";
  return `${label}_${crypto.createHash("sha256").update(path.resolve(projectFile)).digest("hex").slice(0, 8)}`;
}

function writeAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}

function preserveAuthoredFile(file, bytes) {
  if (fs.existsSync(file)) {
    if (!fs.readFileSync(file).equals(Buffer.from(bytes))) {
      throw new Error(`Godot 运行文件已有修改，不会覆盖：${file}`);
    }
    return;
  }
  writeAtomic(file, bytes);
}

function writeManagedScene(file, current, previous) {
  if (!fs.existsSync(file)) return writeAtomic(file, current);
  const saved = fs.readFileSync(file);
  if (saved.equals(Buffer.from(current))) return;
  if (saved.equals(Buffer.from(previous))) return writeAtomic(file, current);
  throw new Error(`Godot 运行文件已有修改，不会覆盖：${file}`);
}

function parseImage(item) {
  if (!/^[\p{L}\p{N}_-]+$/u.test(item.name)) throw new Error("Invalid atlas file name.");
  const match = /^data:image\/png;base64,([a-z0-9+/=\r\n]+)$/i.exec(String(item.image || ""));
  if (!match) throw new Error("Invalid atlas PNG.");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length < 24 || bytes.length > 64 * 1024 * 1024 || bytes.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("Invalid or oversized atlas PNG.");
  }
  const metadata = item.metadata;
  if (!metadata || metadata.app !== "RK sprite" || metadata.sheet?.image !== `${item.name}.png`
    || !Array.isArray(metadata.frames)) throw new Error("Invalid atlas metadata.");
  return bytes;
}

function buildManifest(project, items) {
  const actions = {};
  for (const action of project.animations) {
    const body = items.find((item) => item.metadata.animation === action.id && item.metadata.layer === "body");
    if (!body) continue;
    const frames = body.metadata.frames.map((frame) => ({
      id: frame.frameId, sourceIndex: frame.sourceIndex, durationMs: frame.durationMs,
    }));
    const layers = items.filter((item) => item.metadata.animation === action.id && item.metadata.layer !== "body")
      .map((item) => ({
        id: item.metadata.layer, name: item.metadata.name, slot: item.metadata.slot || "outfit",
        defaultVisible: item.metadata.visible !== false,
        image: `${item.name}.png`,
        frames: item.metadata.frames.map((frame) => ({ present: frame.present, behind: frame.behind })),
      }));
    for (const item of items.filter((entry) => entry.metadata.animation === action.id)) {
      if (item.metadata.frames.length !== frames.length
        || item.metadata.frames.some((frame, index) => frame.frameId !== frames[index].id)) {
        throw new Error("Atlas layers have mismatched frame order.");
      }
    }
    actions[action.id] = {
      name: action.name, playbackSpeed: action.playbackSpeed ?? 1,
      body: `${body.name}.png`, frames, layers,
    };
  }
  if (!Object.keys(actions).length) throw new Error("At least one playable frame is required for Godot sync.");
  return { app: "RK sprite", schemaVersion: 1, canvas: project.canvas, actions };
}

function syncGodot(projectFile, project, items, godotRoot, runtimeFile) {
  const root = path.resolve(godotRoot);
  if (!fs.statSync(path.join(root, "project.godot")).isFile()) throw new Error("Select a Godot project folder.");
  const slug = projectSlug(projectFile);
  const relative = `rk_sprite/${slug}`;
  const destination = path.join(root, "rk_sprite", slug);
  const manifest = buildManifest(project, items);
  const images = items.map((item) => ({ name: `${item.name}.png`, bytes: parseImage(item) }));
  const scriptFile = path.join(root, ...RUNTIME_PATH.split("/"));
  const sceneFile = path.join(destination, "player.tscn");
  const previewFile = path.join(destination, "preview.tscn");
  const scene = `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${RUNTIME_PATH}" id="1"]\n\n[node name="RKSpritePlayer" type="Node2D"]\nscript = ExtResource("1")\ndata_file = "res://${relative}/animation.json"\n`;
  const previousScene = scene.replace(RUNTIME_PATH, PREVIOUS_RUNTIME_PATH);
  const preview = `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="PackedScene" path="res://${relative}/player.tscn" id="1"]\n\n[node name="Preview" type="Node2D"]\n\n[node name="RKSpritePlayer" parent="." instance=ExtResource("1")]\n\n[node name="Camera2D" type="Camera2D" parent="."]\nenabled = true\n`;
  const script = fs.readFileSync(runtimeFile);
  preserveAuthoredFile(scriptFile, script);
  writeManagedScene(sceneFile, scene, previousScene);
  preserveAuthoredFile(previewFile, Buffer.from(preview));
  for (const { name, bytes } of images) writeAtomic(path.join(destination, name), bytes);
  writeAtomic(path.join(destination, "animation.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { scene: `res://${relative}/player.tscn`, directory: destination, actions: Object.keys(manifest.actions).length };
}

module.exports = { buildManifest, projectSlug, syncGodot };
