import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const executablePath = process.env.RK_SPRITE_PACKAGED_EXE;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rk-sprite-drop-"));
const userData = path.join(temp, "user-data");
const projectDir = path.join(temp, "projects");
const spriteDir = path.join(temp, "sprites");
const videoDir = path.join(temp, "videos");
for (const directory of [projectDir, spriteDir, videoDir]) fs.mkdirSync(directory, { recursive: true });
const projectFile = path.join(projectDir, "Drop.rksprite");
const otherProject = path.join(projectDir, "Other.rksprite");
const spritePng = path.join(spriteDir, "hero.png");
const spriteJson = path.join(spriteDir, "hero.json");
const videoFile = path.join(videoDir, "clip.webm");
let app;

async function launch() {
  app = await electron.launch(executablePath
    ? { executablePath, args: [`--user-data-dir=${userData}`], cwd: root, timeout: 60000,
      env: { ...process.env, RK_SPRITE_TEST_USER_DATA: userData } }
    : { args: [root, `--user-data-dir=${userData}`], cwd: root, timeout: 60000,
      env: { ...process.env, RK_SPRITE_TEST_USER_DATA: userData } });
  return app.firstWindow();
}

async function drop(page, files, target = "#stageWrap") {
  const bounds = await page.locator(target).boundingBox();
  const session = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  const x = Math.round(bounds.x + bounds.width / 2);
  const y = Math.round(bounds.y + bounds.height / 2);
  try {
    for (const type of ["dragEnter", "dragOver", "drop"]) {
      await session.send("Input.dispatchDragEvent", { type, x, y, data });
    }
  } finally {
    await session.detach();
  }
}

try {
  let page = await launch();
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, projectFile);
  await page.getByRole("button", { name: "新建工程" }).click();
  await page.locator("#nameInput").fill("Drop");
  await page.locator("#nameForm button[type=submit]").click();
  await page.locator("#projectName").getByText("Drop").waitFor();

  const fixtures = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 12;
    const context = canvas.getContext("2d");
    context.fillStyle = "#d43a52";
    context.fillRect(0, 0, 12, 12);
    context.fillStyle = "#39cfa7";
    context.fillRect(12, 0, 12, 12);
    const png = canvas.toDataURL("image/png").split(",")[1];

    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.stop();
    await stopped;
    return { png, video: Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())) };
  });
  fs.writeFileSync(spritePng, Buffer.from(fixtures.png, "base64"));
  fs.writeFileSync(spriteJson, JSON.stringify({
    canvas: { width: 12, height: 12 },
    frames: [
      { filename: "a.png", frame: { x: 0, y: 0, w: 12, h: 12 }, duration: 83 },
      { filename: "b.png", frame: { x: 12, y: 0, w: 12, h: 12 }, duration: 83 },
    ],
  }));
  fs.writeFileSync(videoFile, Buffer.from(fixtures.video));
  fs.writeFileSync(otherProject, JSON.stringify({
    schemaVersion: 1, name: "Other", canvas: { width: 12, height: 12 }, fps: 12,
    animations: [],
  }));

  await drop(page, [spritePng, spriteJson]);
  await page.locator("#nameDialog").waitFor({ state: "visible" });
  await page.locator("#nameInput").fill("idle");
  await page.locator("#nameForm button[type=submit]").click();
  await page.locator(".frame-card").nth(1).waitFor();
  await page.locator("#addLayer").click();
  await page.locator("#newLayerName").fill("Dropped Coat");
  await page.locator("#layerForm button[type=submit]").click();
  await drop(page, [spritePng, spriteJson], "#layerList");
  await page.getByText("Dropped Coat 已对应 2 帧 Atlas").waitFor();
  await page.locator("#saveProject").click();
  const layered = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  assert.equal(Object.keys(layered.animations[0].layers[0].instances).length, 2);
  await drop(page, [videoFile]);
  await page.locator("#videoDialog").waitFor({ state: "visible" });
  await page.locator("#videoStatus").getByText(/24 × 12/).waitFor({ timeout: 15000 });
  await page.locator("#closeVideo").click();
  await drop(page, [otherProject]);
  await page.locator("#projectName").getByText("Other").waitFor();
  const recent = JSON.parse(fs.readFileSync(path.join(userData, "recent-directories.json"), "utf8"));
  assert.equal(recent.project, projectDir);
  assert.equal(recent.sprites, spriteDir);
  assert.equal(recent.video, videoDir);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].destroy());
  await app.close();

  page = await launch();
  await app.evaluate(({ dialog }) => {
    globalThis.testDialogPaths = {};
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.testDialogPaths[options.title] = options.defaultPath;
      return { canceled: true, filePaths: [] };
    };
  });
  await page.locator("#welcomeOpen").click();
  assert.equal(await app.evaluate(() => globalThis.testDialogPaths["Open RK sprite project"]), projectDir);

  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, otherProject);
  await page.locator("#welcomeOpen").click();
  await page.locator("#projectName").getByText("Other").waitFor();
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.testDialogPaths[options.title] = options.defaultPath;
      return { canceled: true, filePaths: [] };
    };
  });
  await page.locator("#videoImport").click();
  await page.locator("#selectVideo").click();
  await page.locator("#closeVideo").click();
  await page.locator("#pngImport").click();
  const dialogs = await app.evaluate(() => globalThis.testDialogPaths);
  assert.equal(dialogs["Import video"], videoDir);
  assert.equal(dialogs["Import PNG sequence or Atlas"], spriteDir);
  console.log("Disk-file drag/drop and recent project, video, sprite directories passed.");
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
