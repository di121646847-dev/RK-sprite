export const SCHEMA_VERSION = 1;
export const MAX_FRAMES = 240;

export function cleanId(value) {
  return String(value || "").trim().replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 64);
}

export function makeProject(name = "Untitled") {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: String(name || "Untitled").trim(),
    canvas: { width: 512, height: 512 },
    fps: 12,
    animations: [],
  };
}

export function makeAnimation(name, fps = 12) {
  const id = cleanId(name);
  if (!id) throw new Error("Enter an animation name.");
  if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error("FPS must be between 1 and 60.");
  return { id, name: String(name).trim(), fps, playbackSpeed: 1, frames: [], layers: [] };
}

export function addAnimation(project, name, fps = 12) {
  const animation = makeAnimation(name, fps);
  if (project.animations.some((entry) => entry.id === animation.id)) throw new Error("Animation name already exists.");
  project.animations.push(animation);
  return animation;
}

export function renameAnimation(project, animationId, name) {
  const animation = project.animations.find((entry) => entry.id === animationId);
  if (!animation) throw new Error("Animation not found.");
  const renamed = makeAnimation(name, animation.fps);
  if (project.animations.some((entry) => entry !== animation && entry.id === renamed.id)) {
    throw new Error("Animation name already exists.");
  }
  animation.id = renamed.id;
  animation.name = renamed.name;
  return animation;
}

export function removeAnimation(project, animationId) {
  const index = project.animations.findIndex((entry) => entry.id === animationId);
  if (index < 0) throw new Error("Animation not found.");
  return project.animations.splice(index, 1)[0];
}

export function replaceAnimation(project, replacement) {
  const index = project.animations.findIndex((entry) => entry.id === replacement.id);
  if (index < 0) {
    project.animations.push(replacement);
  } else {
    const old = project.animations[index];
    replacement.playbackSpeed = old.playbackSpeed ?? 1;
    replacement.layers = (old.layers || []).map((layer) => ({ ...layer, instances: {} }));
    project.animations[index] = replacement;
  }
  return replacement;
}

export function makeFrame(asset, durationMs, timeMs = null) {
  const duration = Math.round(Number(durationMs));
  if (!asset || !Number.isFinite(duration) || duration < 1 || duration > 60000) throw new Error("Invalid animation frame.");
  return { id: crypto.randomUUID(), asset, durationMs: duration, timeMs, offsetX: 0, offsetY: 0, disabled: false };
}

export function frameOffset(frame) {
  return { x: Number(frame?.offsetX || 0), y: Number(frame?.offsetY || 0) };
}

export function layerBehind(layer, frame) {
  return typeof layer?.instances?.[frame?.id]?.behind === "boolean"
    ? layer.instances[frame.id].behind : layer?.behind === true;
}

export function copyLayerTransform(animation, layer, sourceFrame) {
  const source = layer.instances[sourceFrame.id];
  if (!source?.asset) return 0;
  let count = 0;
  for (const frame of animation.frames) {
    if (frame.id === sourceFrame.id) continue;
    const target = layer.instances[frame.id];
    if (!target?.asset) continue;
    for (const key of ["x", "y", "rotation", "scale", "pivotX", "pivotY"]) {
      target[key] = source[key] ?? (key === "scale" ? 1 : key.startsWith("pivot") ? 0.5 : 0);
    }
    count++;
  }
  return count;
}

export function reorderFrame(animation, frameId, insertionIndex) {
  const frames = animation?.frames;
  if (!Array.isArray(frames)) return null;
  const from = frames.findIndex((frame) => frame.id === frameId);
  if (from < 0 || !Number.isInteger(insertionIndex) || insertionIndex < 0 || insertionIndex > frames.length) return null;
  const to = insertionIndex > from ? insertionIndex - 1 : insertionIndex;
  if (to === from) return null;
  const [moved] = frames.splice(from, 1);
  frames.splice(to, 0, moved);
  return to;
}

export function addLayer(animation, name, kind, slot = "") {
  if (!["equipment", "preview"].includes(kind)) throw new Error("Unknown layer type.");
  const layer = {
    id: crypto.randomUUID(),
    name: String(name || kind).trim(),
    kind,
    slot: kind === "equipment" ? String(slot || "outfit").trim() : "",
    behind: false,
    visible: true,
    instances: {},
  };
  animation.layers.push(layer);
  return layer;
}

export function editLayer(animation, layerId, { name, kind, slot }) {
  const layer = animation.layers.find((entry) => entry.id === layerId);
  if (!layer) throw new Error("Layer not found.");
  const label = String(name || "").trim();
  if (!label) throw new Error("Enter a layer name.");
  if (!["equipment", "preview"].includes(kind) && !(layer.kind === "paint" && kind === "paint")) {
    throw new Error("Unknown layer type.");
  }
  layer.name = label;
  layer.kind = kind;
  layer.slot = kind === "equipment" ? String(slot || "outfit").trim() || "outfit" : "";
  return layer;
}

export function removeLayer(animation, layerId) {
  const index = animation.layers.findIndex((entry) => entry.id === layerId);
  if (index < 0) throw new Error("Layer not found.");
  return animation.layers.splice(index, 1)[0];
}

export function migrateProject(project) {
  if (!Array.isArray(project.layers)) {
    for (const animation of project.animations) animation.layers ||= [];
    return false;
  }
  if (!project.animations.length) {
    project.legacyLayers = [...(project.legacyLayers || []), ...project.layers];
    delete project.layers;
    return true;
  }
  const claimed = new Set();
  for (const [index, animation] of project.animations.entries()) {
    const ids = new Set(animation.frames.map((frame) => frame.id));
    animation.layers ||= [];
    for (const layer of project.layers) {
      const instances = Object.fromEntries(Object.entries(layer.instances || {})
        .filter(([frameId]) => ids.has(frameId)));
      Object.keys(instances).forEach((id) => claimed.add(id));
      if (!Object.keys(instances).length && (index !== 0 || Object.keys(layer.instances || {}).length)) continue;
      const id = project.animations.length === 1 ? layer.id : `${layer.id}_${animation.id}`;
      animation.layers.push({ ...layer, id, instances });
    }
  }
  const leftovers = project.layers.map((layer) => ({
    ...layer,
    instances: Object.fromEntries(Object.entries(layer.instances || {}).filter(([id]) => !claimed.has(id))),
  })).filter((layer) => Object.keys(layer.instances).length);
  if (leftovers.length) project.legacyLayers = [...(project.legacyLayers || []), ...leftovers];
  delete project.layers;
  return true;
}

export function validateProject(project) {
  if (!project || project.schemaVersion !== SCHEMA_VERSION) throw new Error("Unsupported RK sprite project.");
  const { width, height } = project.canvas || {};
  if (![width, height].every((value) => Number.isInteger(value) && value >= 1 && value <= 8192)) {
    throw new Error("Canvas dimensions must be between 1 and 8192 pixels.");
  }
  if (!Array.isArray(project.animations)) throw new Error("Invalid project structure.");
  const frameIds = new Set();
  for (const animation of project.animations) {
    if (!cleanId(animation.id) || !Array.isArray(animation.frames) || !Array.isArray(animation.layers)
      || animation.frames.length > MAX_FRAMES
      || (animation.playbackSpeed !== undefined
        && (!Number.isFinite(animation.playbackSpeed) || animation.playbackSpeed < 0.1 || animation.playbackSpeed > 8))) {
      throw new Error("Invalid animation.");
    }
    for (const frame of animation.frames) {
      if (!frame.id || frameIds.has(frame.id) || !frame.asset || !Number.isFinite(frame.durationMs)
        || frame.durationMs < 1 || frame.durationMs > 60000) throw new Error("Invalid or duplicate frame.");
      if ((frame.offsetX !== undefined && (!Number.isFinite(frame.offsetX) || Math.abs(frame.offsetX) > 8192))
        || (frame.offsetY !== undefined && (!Number.isFinite(frame.offsetY) || Math.abs(frame.offsetY) > 8192))
        || (frame.disabled !== undefined && typeof frame.disabled !== "boolean")) throw new Error("Invalid frame alignment.");
      frameIds.add(frame.id);
    }
    const layerIds = new Set();
    for (const layer of animation.layers) {
      if (!layer.id || !["equipment", "paint", "preview"].includes(layer.kind) || !layer.instances
        || typeof layer.instances !== "object" || layerIds.has(layer.id)
        || Object.keys(layer.instances).some((id) => !animation.frames.some((frame) => frame.id === id)
          || (layer.instances[id].behind !== undefined && typeof layer.instances[id].behind !== "boolean"))) {
        throw new Error("Invalid layer.");
      }
      layerIds.add(layer.id);
    }
  }
  return project;
}

export function exportPlan(project, columns = 8) {
  validateProject(project);
  if (!Number.isInteger(columns) || columns < 1 || columns > 32) throw new Error("Columns must be 1-32.");
  const sets = [];
  for (const animation of project.animations) {
    const frames = animation.frames.filter((frame) => !frame.disabled);
    if (!frames.length) continue;
    const entries = [{ id: "body", name: "Body", kind: "body", frames }];
    entries.push(...animation.layers.filter((layer) => layer.kind !== "preview"
      && frames.some((frame) => layer.instances[frame.id]?.asset))
      .map((layer) => ({ ...layer, frames })));
    for (const entry of entries) {
      const sheetWidth = project.canvas.width * Math.min(columns, frames.length);
      const sheetHeight = project.canvas.height * Math.ceil(frames.length / columns);
      if (sheetWidth > 16384 || sheetHeight > 16384 || sheetWidth * sheetHeight > 120000000) {
        throw new Error(`${animation.name}: atlas is too large. Reduce the column count or canvas size.`);
      }
      sets.push({ animation, layer: entry, frames, sheetWidth, sheetHeight });
    }
  }
  if (!sets.length) throw new Error("There are no animation frames to export.");
  return sets;
}
