export function sampleTimes({ start, end, duration, mode, fps, interval, framesPerInterval = 1, maxFrames = 240 }) {
  if (![start, end, duration].every(Number.isFinite) || duration <= 0 || start < 0
    || end <= start || end > duration + 0.05) {
    throw new Error("检查视频的起点和终点。");
  }
  if (mode === "interval" && (!Number.isInteger(framesPerInterval) || framesPerInterval < 1 || framesPerInterval > 60)) {
    throw new Error("每段请填写 1–60 帧。");
  }
  const step = mode === "interval" ? interval / framesPerInterval : mode === "fps" ? 1 / fps : NaN;
  if (!Number.isFinite(step) || (mode === "interval" && (!Number.isFinite(interval) || interval < 0.01 || interval > 60))
    || (mode === "fps" && (!Number.isFinite(fps) || fps < 1 || fps > 60))) {
    throw new Error("请输入有效的取帧间隔或采样帧率。");
  }
  const count = Math.ceil((end - start) / step - 1e-8);
  if (count < 1 || count > maxFrames) {
    throw new Error(`最多可提取 ${maxFrames} 张候选帧，请缩短范围或增大间隔。`);
  }
  return Array.from({ length: count }, (_, index) => Math.min(duration - 0.001, start + index * step));
}
