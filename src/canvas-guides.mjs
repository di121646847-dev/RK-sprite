export function gridLayout(step, zoom) {
  const pixels = Math.max(1, Math.min(256, Math.round(Number(step) || 8)));
  // Keep major lines visible when individual pixels are smaller than the display.
  const multiple = Math.max(1, 2 ** Math.ceil(Math.log2(4 / (pixels * zoom))));
  return { step: pixels, displayStep: pixels * multiple, spacing: pixels * multiple * zoom };
}

export function snapCoordinate(value, step = 1, base = 0) {
  return Math.round(((Math.round((base + value) / step) * step) - base) * 1e6) / 1e6;
}

export function onionFrames(frames, current) {
  const index = frames.indexOf(current);
  if (index < 0) return [];
  const neighbors = [];
  for (const direction of [-1, 1]) {
    for (let distance = 1; distance < frames.length; distance++) {
      const other = frames[(index + direction * distance + frames.length) % frames.length];
      if (other.disabled) continue;
      if (!neighbors.includes(other)) neighbors.push(other);
      break;
    }
  }
  return neighbors;
}
