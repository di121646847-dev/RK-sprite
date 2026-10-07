export function advancePlayback(frames, index, elapsedMs, deltaMs, speed) {
  if (!frames.length) return { index: 0, elapsedMs: 0 };
  const playable = frames.map((frame, frameIndex) => frame.disabled ? -1 : frameIndex).filter((frameIndex) => frameIndex >= 0);
  if (!playable.length) return { index, elapsedMs: 0 };
  const rate = Number.isFinite(speed) && speed >= 0.1 && speed <= 8 ? speed : 1;
  let nextElapsed = elapsedMs + Math.min(100, Math.max(0, deltaMs)) * rate;
  let nextIndex = playable.includes(index) ? index : playable.find((frameIndex) => frameIndex > index) ?? playable[0];
  while (nextElapsed >= frames[nextIndex].durationMs) {
    nextElapsed -= frames[nextIndex].durationMs;
    nextIndex = playable[(playable.indexOf(nextIndex) + 1) % playable.length];
  }
  return { index: nextIndex, elapsedMs: nextElapsed };
}
