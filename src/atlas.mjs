import { MAX_FRAMES } from "./model.mjs";

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function rectangle(value) {
  const x = Number(value?.x ?? value?.left);
  const y = Number(value?.y ?? value?.top);
  const w = Number(value?.w ?? value?.width);
  const h = Number(value?.h ?? value?.height);
  if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1) {
    throw new Error("Atlas JSON contains an invalid frame rectangle.");
  }
  return { x, y, w, h };
}

function size(value, fallback) {
  const w = Number(value?.w ?? value?.width ?? fallback.w);
  const h = Number(value?.h ?? value?.height ?? fallback.h);
  if (![w, h].every(Number.isInteger) || w < 1 || h < 1 || w > 8192 || h > 8192) {
    throw new Error("Atlas source canvas must be within 1-8192 px.");
  }
  return { w, h };
}

function validateFrames(frames, imageWidth, imageHeight) {
  if (!frames.length || frames.length > MAX_FRAMES) throw new Error(`Atlas must contain 1-${MAX_FRAMES} frames.`);
  for (const frame of frames) {
    const { x, y, w, h } = frame.crop;
    const { source, offset } = frame;
    if (x + w > imageWidth || y + h > imageHeight) throw new Error("Atlas frame exceeds the PNG bounds.");
    if (offset.x + frame.output.w > source.w || offset.y + frame.output.h > source.h) {
      throw new Error("Atlas trim offset exceeds the source canvas.");
    }
  }
  return frames;
}

export function parseAtlas(metadata, imageWidth, imageHeight, fallbackFps = 12) {
  const entries = Array.isArray(metadata?.frames)
    ? metadata.frames.map((entry, index) => [entry.filename || entry.name || String(index + 1), entry])
    : metadata?.frames && typeof metadata.frames === "object"
      ? Object.entries(metadata.frames).sort(([left], [right]) => natural.compare(left, right))
      : null;
  if (!entries) throw new Error("Atlas JSON must contain a frames array or object.");
  const baseDuration = Math.round(1000 / fallbackFps);
  const frames = entries.map(([name, value]) => {
    if (value.rotated === true) throw new Error(`${name}: rotated packing is not supported; export without rotation.`);
    const crop = rectangle(value.frame || value.crop || value);
    const source = size(value.sourceSize || value.source || metadata.canvas || metadata.meta?.canvas, crop);
    const output = size(value.spriteSourceSize || value.trimmedRect, crop);
    if (output.w !== crop.w || output.h !== crop.h) {
      throw new Error(`${name}: trimmed size does not match its packed rectangle.`);
    }
    const offset = value.spriteSourceSize || value.trimmedRect
      ? { x: Number(value.spriteSourceSize?.x ?? value.trimmedRect?.x), y: Number(value.spriteSourceSize?.y ?? value.trimmedRect?.y) }
      : { x: 0, y: 0 };
    if (![offset.x, offset.y].every(Number.isInteger) || offset.x < 0 || offset.y < 0) {
      throw new Error(`${name}: invalid sprite source offset.`);
    }
    const duration = Number(value.durationMs ?? value.duration ?? baseDuration);
    if (!Number.isFinite(duration) || duration < 1 || duration > 60000) throw new Error(`${name}: invalid frame duration.`);
    return { name: String(name), crop, source, output, offset, durationMs: Math.round(duration) };
  });
  return validateFrames(frames, imageWidth, imageHeight);
}

export function gridFrames(imageWidth, imageHeight, { cellWidth, cellHeight, marginX = 0, marginY = 0, gapX = 0, gapY = 0, count = 0 }) {
  const [w, h, x0, y0, dx, dy, limit] = [cellWidth, cellHeight, marginX, marginY, gapX, gapY, count].map(Number);
  if (![w, h, x0, y0, dx, dy, limit].every(Number.isInteger) || w < 1 || h < 1
    || [x0, y0, dx, dy, limit].some((value) => value < 0)) throw new Error("Enter valid grid dimensions.");
  const cols = Math.floor((imageWidth - x0 + dx) / (w + dx));
  const rows = Math.floor((imageHeight - y0 + dy) / (h + dy));
  const total = limit || cols * rows;
  if (cols < 1 || rows < 1 || total > cols * rows || total > MAX_FRAMES) {
    throw new Error(`Grid must contain 1-${MAX_FRAMES} complete frames.`);
  }
  const frames = Array.from({ length: total }, (_, index) => {
    const x = x0 + (index % cols) * (w + dx);
    const y = y0 + Math.floor(index / cols) * (h + dy);
    return {
      name: `frame_${String(index + 1).padStart(4, "0")}.png`,
      crop: { x, y, w, h }, source: { w, h }, output: { w, h }, offset: { x: 0, y: 0 },
      durationMs: null,
    };
  });
  return validateFrames(frames, imageWidth, imageHeight);
}

export function sourceCanvas(frames, fallback = null) {
  if (fallback) return { width: fallback.width, height: fallback.height };
  return {
    width: Math.max(...frames.map((frame) => frame.source.w)),
    height: Math.max(...frames.map((frame) => frame.source.h)),
  };
}

export function framePlacement(frame, targetCanvas) {
  if (frame.source.w > targetCanvas.width || frame.source.h > targetCanvas.height) {
    throw new Error("Atlas source canvas exceeds the current project canvas.");
  }
  return {
    x: Math.floor((targetCanvas.width - frame.source.w) / 2) + frame.offset.x,
    y: targetCanvas.height - frame.source.h + frame.offset.y,
  };
}
