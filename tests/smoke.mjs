import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packaged = process.env.RK_SPRITE_PACKAGED_EXE;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rk-sprite-smoke-"));
const userData = path.join(temp, "user-data");
const projectFile = path.join(temp, "Smoke.rksprite");
const videoFile = path.join(temp, "clip.webm");
const imageFile = path.join(temp, "outfit.png");
const errors = [];
let app;

try {
  app = await electron.launch(packaged
    ? { executablePath: packaged, args: [`--user-data-dir=${userData}`], cwd: root, timeout: 60000,
      env: { ...process.env, RK_SPRITE_TEST_USER_DATA: userData } }
    : { args: [root, `--user-data-dir=${userData}`], cwd: root, timeout: 60000,
      env: { ...process.env, RK_SPRITE_TEST_USER_DATA: userData } });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.getByRole("heading", { name: "RK sprite" }).waitFor();
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, projectFile);
  await page.getByRole("button", { name: "新建工程" }).click();
  await page.locator("#nameInput").fill("Smoke");
  await page.locator("#nameForm button[type=submit]").click();
  await page.locator("#projectName").getByText("Smoke").waitFor();
  assert.equal(fs.existsSync(projectFile), true);

  const video = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext("2d");
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.start();
    for (let i = 0; i < 8; i++) {
      context.fillStyle = i % 2 ? "#cc3948" : "#48d5aa";
      context.fillRect(0, 0, 160, 90);
      context.fillStyle = "#fff";
      context.fillRect(i * 12, 22, 24, 36);
      await new Promise((resolve) => setTimeout(resolve, 95));
    }
    const stopped = new Promise((resolve) => recorder.onstop = resolve);
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: "video/webm" });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  fs.writeFileSync(videoFile, Buffer.from(video));
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    context.fillStyle = "#f2c058";
    context.fillRect(4, 4, 24, 24);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  fs.writeFileSync(imageFile, Buffer.from(png, "base64"));

  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, videoFile);
  await page.locator("#videoImport").click();
  await page.locator("#selectVideo").click();
  try {
    await page.locator("#videoStatus").getByText(/160 × 90/).waitFor({ timeout: 10000 });
  } catch (error) {
    await page.screenshot({ path: path.join(root, "out", "video-import-failure.png") });
    const detail = await page.evaluate(() => ({
      status: document.querySelector("#videoStatus")?.textContent,
      source: document.querySelector("#sourceVideo")?.src,
      readyState: document.querySelector("#sourceVideo")?.readyState,
      dialogOpen: document.querySelector("#videoDialog")?.open,
    }));
    throw new Error(`Video import failed: ${JSON.stringify(detail)}, page errors: ${JSON.stringify(errors)}`, { cause: error });
  }
  await page.locator("#trimEnd").fill("0.6");
  await page.locator("#sampleInterval").fill("0.6");
  await page.locator("#framesPerInterval").fill("3");
  await page.locator("#extractFrames").click();
  await page.getByText("已提取 3 / 3 张候选帧").waitFor({ timeout: 20000 });
  await page.locator(".candidate-keep input:checked").nth(2).waitFor();
  assert.equal(await page.locator(".candidate-keep input:checked").count(), 3);
  await page.locator(".candidate-preview").nth(1).click();
  assert.equal(await page.locator(".candidate-keep input:checked").count(), 3);
  await page.locator("#framePreview").waitFor({ state: "visible" });
  assert.deepEqual(await page.locator("#framePreview").evaluate((canvas) => [canvas.width, canvas.height]), [160, 90]);
  await page.locator("#previewCaption").getByText(/第 2 帧.*0.20 秒.*160 × 90/).waitFor();
  await page.locator("#showSourceVideo").click();
  await page.locator("#sourceVideo").waitFor({ state: "visible" });
  await page.locator("#showFramePreview").click();
  await page.locator(".candidate-keep input").nth(1).uncheck();
  assert.equal(await page.locator(".candidate-keep input:checked").count(), 2);
  assert.equal(await page.locator(".selected-row").count(), 2);
  await page.locator(".selected-preview").last().click();
  await page.locator("#previewCaption").getByText(/第 3 帧.*0.40 秒/).waitFor();
  await assertVideoLayout(page, 1500, 920);
  await assertVideoLayout(page, 1024, 768);
  await assertVideoLayout(page, 920, 650);
  await page.screenshot({ path: path.join(root, "out", "video-selection-compact.png") });
  await page.locator("#expandVideoPreview").click();
  const enlargedFrame = await page.locator("#framePreview").boundingBox();
  assert.ok(enlargedFrame.height >= 450, JSON.stringify(enlargedFrame));
  assert.equal(await page.locator(".video-side").isVisible(), false);
  await page.screenshot({ path: path.join(root, "out", "video-preview-expanded.png") });
  await page.locator("#expandVideoPreview").click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 920));
  await page.locator("#showSourceVideo").click();
  await page.locator("#sourceVideo").waitFor({ state: "visible" });
  await page.screenshot({ path: path.join(root, "out", "video-source.png") });
  await page.locator("#showFramePreview").click();
  await page.screenshot({ path: path.join(root, "out", "video-selection.png") });
  await page.locator("#newAnimationName").fill("attack");
  await page.locator("#createSequence").click();
  await page.locator("#videoDialog").waitFor({ state: "hidden", timeout: 30000 });
  assert.equal(await page.locator(".frame-card").count(), 2);
  await page.locator("#playbackSpeed").fill("2.5");
  await page.locator("#playbackSpeed").dispatchEvent("change");
  assert.equal(await page.locator("#playbackSpeed").inputValue(), "2.5");
  assert.equal(await page.locator("#dirtyMark").textContent(), " *");
  await page.locator("#play").click();
  await page.waitForTimeout(100);
  await page.locator("#play").click();
  assert.equal(await page.locator("#playbackSpeed").inputValue(), "2.5");
  await page.locator(".frame-card").first().click();
  await page.locator("#moveFrameRight").click();
  assert.equal(await page.locator(".frame-card.selected").count(), 1);
  await page.locator("#moveFrameLeft").click();

  await page.locator("#addLayer").click();
  await page.locator("#newLayerName").fill("Coat");
  await page.locator("#newLayerSlot").fill("upper");
  await page.locator("#layerForm button[type=submit]").click();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, imageFile);
  await page.locator("#loadLayerStatic").click();
  await page.waitForFunction(() => {
    const pixel = document.querySelector("#stage").getContext("2d").getImageData(80, 45, 1, 1).data;
    return pixel[0] === 242 && pixel[1] === 192 && pixel[2] === 88 && pixel[3] === 255;
  });
  await page.locator("#positionX").fill("8");
  await page.locator("#positionX").dispatchEvent("change");

  await page.locator("#addLayer").click();
  await page.locator("#layerDialog").waitFor({ state: "visible" });
  await page.locator("#newLayerName").fill("Weapon preview");
  await page.locator("#newLayerKind").selectOption("preview");
  await page.locator("#layerForm button[type=submit]").click();
  await page.locator("#loadLayerImage").click();
  await page.locator("#positionX").fill("15");
  await page.locator("#positionX").dispatchEvent("change");

  assert.equal(await page.locator('[data-tool="brush"], [data-tool="eraser"], #brushColor').count(), 0);

  await page.locator("#saveProject").click();
  await page.locator("#dirtyMark").getByText("*").waitFor({ state: "hidden" });
  await page.locator("#saveStatus").getByText("已保存").waitFor();
  const saved = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  assert.equal(saved.animations[0].playbackSpeed, 2.5);
  assert.equal(saved.animations[0].frames.length, 2);
  assert.equal(saved.animations[0].layers.length, 2);
  assert.equal(saved.animations[0].layers[0].slot, "upper");
  assert.equal(saved.animations[0].frames[0].durationMs, 83);
  assert.equal(Object.keys(saved.animations[0].layers[0].instances).length, 2);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, projectFile);
  await page.locator("#openProject").click();
  await page.locator("#filmstrip .frame-card").first().waitFor();
  assert.equal(await page.locator("#playbackSpeed").inputValue(), "2.5");
  assert.equal(await page.locator("#saveStatus").textContent(), "");
  assert.equal(await page.locator("#layerList .layer-row").count(), 2);

  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, temp);
  await page.locator("#exportAtlas").click();
  await page.locator("#toast").getByText(/已导出 2 组分层图集/).waitFor({ timeout: 30000 });
  const exported = fs.readdirSync(temp).find((entry) => entry.startsWith("RK_sprite_"));
  assert.ok(exported);
  const files = fs.readdirSync(path.join(temp, exported));
  assert.equal(files.filter((entry) => entry.endsWith(".png")).length, 2);
  assert.equal(files.filter((entry) => entry.endsWith(".json")).length, 2);
  for (const file of files.filter((entry) => entry.endsWith(".png"))) {
    const buffer = fs.readFileSync(path.join(temp, exported, file));
    assert.equal(buffer.toString("ascii", 1, 4), "PNG");
    assert.ok(buffer.length > 100);
  }
  const coatJson = files.find((entry) => entry.includes("Coat") && entry.endsWith(".json"));
  const metadata = JSON.parse(fs.readFileSync(path.join(temp, exported, coatJson), "utf8"));
  assert.equal(metadata.slot, "upper");
  assert.equal(metadata.playbackSpeed, 2.5);
  assert.deepEqual(metadata.frames.map((entry) => entry.durationMs), [83, 83]);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(root, "out", "smoke.png") });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768));
  await page.screenshot({ path: path.join(root, "out", "smoke-compact.png") });
  const layout = await page.evaluate(() => {
    const stage = document.querySelector("#stage").getBoundingClientRect();
    const stageWrap = document.querySelector("#stageWrap").getBoundingClientRect();
    const inspector = document.querySelector(".inspector").getBoundingClientRect();
    const toolbar = document.querySelector(".canvas-toolbar").getBoundingClientRect();
    const timeline = document.querySelector(".timeline").getBoundingClientRect();
    return { stageWidth: stage.width, stageHeight: stage.height, toolbarBottom: toolbar.bottom, timelineTop: timeline.top, stageRight: stageWrap.right, inspectorLeft: inspector.left };
  });
  assert.ok(layout.stageWidth > 0 && layout.stageHeight > 0 && layout.toolbarBottom < layout.timelineTop);
  assert.ok(layout.stageRight <= layout.inspectorLeft + 1);

  console.log("Checking action and layer editing");
  await page.locator('#animationList [title="编辑动作 attack"]').click();
  await page.locator("#nameInput").fill("attack_renamed");
  await page.locator("#nameForm button[type=submit]").click();
  await page.locator("#timelineTitle").getByText("attack_renamed").waitFor();
  await page.locator('#layerList [title="编辑图层 Coat"]').click();
  await page.locator("#newLayerName").fill("Jacket");
  await page.locator("#newLayerSlot").fill("torso");
  await page.locator("#layerForm button[type=submit]").click();
  await page.locator("#inspectorName").getByText(/Jacket/).waitFor();
  await page.locator('#layerList [title="删除图层 Weapon preview"]').click();
  await page.locator("#confirmAccept").click();
  assert.equal(await page.locator("#layerList .layer-row").count(), 1);
  await page.locator('#animationList [title="删除动作 attack_renamed"]').click();
  await page.locator("#confirmAccept").click();
  assert.equal(await page.locator("#animationList .animation-row").count(), 0);
  await page.locator("#saveProject").click();
  const edited = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  assert.equal(edited.animations.length, 0);
  assert.equal(edited.animations.length, 0);

  console.log("Checking same-name video replacement");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 920));
  await page.locator("#videoImport").click();
  await page.locator("#newAnimationName").fill("attack");
  await page.locator("#createSequence").click();
  await page.locator("#videoDialog").waitFor({ state: "hidden", timeout: 30000 });
  console.log("Created the replacement target");
  const oldFrameIds = await page.evaluate(() => [...document.querySelectorAll(".frame-card")].map((card) => card.title));
  assert.equal(oldFrameIds.length, 2);
  assert.equal(await page.locator("#layerList .layer-row").count(), 0);
  await page.locator("#addLayer").click();
  await page.locator("#newLayerName").fill("Fresh Coat");
  await page.locator("#layerForm button[type=submit]").click();
  await page.locator("#loadLayerImage").click();
  console.log("Attached image to original action");
  await page.locator("#saveProject").click();
  const beforeReplacement = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  const oldIds = beforeReplacement.animations[0].frames.map((entry) => entry.id);
  assert.ok(beforeReplacement.animations[0].layers[0].instances[oldIds[0]]);

  await page.locator("#videoImport").click();
  await page.locator("#newAnimationName").fill("attack");
  await page.locator("#selectAllFrames").click();
  await page.locator("#createSequence").click();
  await page.locator("#videoDialog").waitFor({ state: "hidden", timeout: 30000 });
  console.log("Overwrote action");
  assert.equal(await page.locator(".frame-card").count(), 3);
  await page.locator("#saveProject").click();
  const afterReplacement = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  assert.equal(afterReplacement.animations.length, 1);
  assert.equal(afterReplacement.animations[0].frames.length, 3);
  assert.ok(afterReplacement.animations[0].frames.every((entry) => !oldIds.includes(entry.id)));
  assert.ok(oldIds.every((id) => !(id in afterReplacement.animations[0].layers[0].instances)));
  console.log(JSON.stringify({ project: projectFile, exported: files, screenshot: path.join(root, "out", "smoke.png") }, null, 2));
} finally {
  try {
    if (app) {
      await app.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      });
      await app.close();
    }
  } catch (error) { console.warn(`Could not close test app: ${error.message}`); }
  fs.rmSync(temp, { recursive: true, force: true });
}

async function assertVideoLayout(page, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height), { width, height });
  const measurements = await page.evaluate(() => {
    const bounds = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    return {
      dialog: bounds("#videoDialog"),
      video: bounds(".video-view"),
      source: bounds("#sourceVideo"),
      frame: bounds("#framePreview"),
      controls: bounds(".video-controls"),
      candidateArea: bounds("#candidates"),
      cards: [...document.querySelectorAll(".candidate")].map((card) => {
        const rect = card.getBoundingClientRect();
        return { width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
      }),
      side: bounds(".video-side"),
      selected: bounds("#selectedFrames"),
      footer: bounds(".video-footer"),
      videoFit: getComputedStyle(document.querySelector("#sourceVideo")).objectFit,
    };
  });
  assert.ok(measurements.video.width > 0 && measurements.video.height >= 170, JSON.stringify(measurements));
  assert.ok(measurements.frame.width > 0 && measurements.frame.height > 0, JSON.stringify(measurements));
  assert.ok(measurements.video.bottom <= measurements.controls.top + 1, JSON.stringify(measurements));
  assert.ok(measurements.controls.bottom <= measurements.candidateArea.top + 50, JSON.stringify(measurements));
  assert.ok(measurements.candidateArea.bottom <= measurements.dialog.bottom + 1, JSON.stringify(measurements));
  assert.ok(measurements.selected.bottom <= measurements.footer.top + 1, JSON.stringify(measurements));
  assert.ok(measurements.side.left >= measurements.video.right - 1, JSON.stringify(measurements));
  assert.equal(measurements.videoFit, "contain");
  assert.ok(measurements.source.width <= measurements.video.width + 1, JSON.stringify(measurements));
  assert.ok(measurements.cards.every((card) => card.height === measurements.cards[0].height
    && Math.abs(card.width - measurements.cards[0].width) < 1
    && card.right <= measurements.side.left
    && card.bottom <= measurements.candidateArea.bottom), JSON.stringify(measurements));
}
