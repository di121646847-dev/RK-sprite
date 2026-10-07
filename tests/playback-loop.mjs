import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const executablePath = process.env.RK_SPRITE_PACKAGED_EXE;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rk-sprite-playback-"));
const userData = path.join(temp, "user-data");
const projectFile = path.join(temp, "Playback.rksprite");
const frameFiles = Array.from({ length: 3 }, (_, index) => path.join(temp, `frame_${index}.png`));
let app;

try {
  app = await electron.launch(executablePath
    ? { executablePath, args: [`--user-data-dir=${userData}`], cwd: root, timeout: 60000,
      env: { ...process.env, RK_SPRITE_TEST_USER_DATA: userData } }
    : { args: [root, `--user-data-dir=${userData}`], cwd: root, timeout: 60000,
      env: { ...process.env, RK_SPRITE_TEST_USER_DATA: userData } });
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, projectFile);
  await page.getByRole("button", { name: "新建工程" }).click();
  await page.locator("#nameInput").fill("Playback");
  await page.locator("#nameForm button[type=submit]").click();

  const pngs = await page.evaluate(() => ["#d23f45", "#32aa71", "#416bd3"].map((color) => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 512, 512);
    return canvas.toDataURL("image/png").split(",")[1];
  }));
  for (const [index, file] of frameFiles.entries()) fs.writeFileSync(file, Buffer.from(pngs[index], "base64"));
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, frameFiles);
  await page.locator("#pngImport").click();
  await page.locator("#nameInput").fill("loop");
  await page.locator("#nameForm button[type=submit]").click();
  await page.locator(".frame-card").nth(2).waitFor();
  const initialCanvas = await page.locator("#stage").evaluate((canvas) => ({
    width: canvas.width, height: canvas.height,
  }));
  assert.deepEqual(initialCanvas, { width: 512, height: 512 });
  const zoomBeforeGrid = await page.locator("#zoomText").textContent();
  const stageBeforeGrid = await page.locator("#stage").boundingBox();
  const canvasBeforeGrid = await page.locator("#stage").evaluate((canvas) =>
    Array.from(canvas.getContext("2d").getImageData(256, 256, 1, 1).data));
  await page.locator("#showPixelGrid").check();
  const stageAfterGrid = await page.locator("#stage").boundingBox();
  assert.equal(await page.locator("#zoomText").textContent(), zoomBeforeGrid);
  assert.deepEqual(stageAfterGrid, stageBeforeGrid);
  assert.deepEqual(await page.locator("#stage").evaluate((canvas) =>
    Array.from(canvas.getContext("2d").getImageData(256, 256, 1, 1).data)), canvasBeforeGrid);
  assert.equal(await page.locator("#showPixelGrid").isChecked(), true);
  await page.locator("#showPixelGrid").uncheck();

  await page.evaluate(() => {
    const stage = document.querySelector("#stage");
    window.__stageResizes = 0;
    for (const property of ["width", "height"]) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property);
      Object.defineProperty(stage, property, {
        configurable: true,
        get() { return descriptor.get.call(this); },
        set(value) {
          window.__stageResizes++;
          descriptor.set.call(this, value);
        },
      });
    }
    window.__playbackSamples = [];
    const observer = new MutationObserver(() => {
      const selected = document.querySelector(".frame-card.selected");
      const index = [...document.querySelectorAll(".frame-card")].indexOf(selected);
      const samples = window.__playbackSamples;
      if (index >= 0 && samples.at(-1)?.index !== index) samples.push({ index, time: performance.now() });
    });
    observer.observe(document.querySelector("#filmstrip"), { subtree: true, attributes: true, attributeFilter: ["class"] });
    window.__playbackObserver = observer;
  });
  await page.locator("#play").click();
  await page.waitForFunction(() => window.__playbackSamples.length >= 34, null, { timeout: 10000 });
  await page.locator("#play").click();
  const { samples, resizes } = await page.evaluate(() => {
    window.__playbackObserver.disconnect();
    return { samples: window.__playbackSamples, resizes: window.__stageResizes };
  });
  const intervals = samples.slice(1).map((entry, index) => ({
    from: samples[index].index,
    to: entry.index,
    ms: Math.round(entry.time - samples[index].time),
  }));
  const wrap = intervals.filter((entry) => entry.from === 2 && entry.to === 0).map((entry) => entry.ms);
  const internal = intervals.filter((entry) => entry.from !== 2).map((entry) => entry.ms);
  console.log(JSON.stringify({ wrap, internal, resizes, maxWrap: Math.max(...wrap), maxInternal: Math.max(...internal) }));
  assert.ok(wrap.length >= 8 && internal.length >= 16);
  assert.equal(resizes, 0);
} finally {
  try {
    if (app) {
      await app.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      });
      await app.close();
    }
  } catch {}
  fs.rmSync(temp, { recursive: true, force: true });
}
