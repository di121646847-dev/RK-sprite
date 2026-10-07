import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const executablePath = process.env.RK_SPRITE_PACKAGED_EXE;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rk-sprite-history-"));
const userData = path.join(temp, "user-data");
const projectFile = path.join(temp, "History.rksprite");
const framePaths = [0, 1, 2].map((index) => path.join(temp, `frame_${index}.png`));
const outfitPath = path.join(temp, "outfit.png");
const errors = [];
let app;

async function pick(files) {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, files);
}

try {
  app = await electron.launch(executablePath
    ? { executablePath, args: [`--user-data-dir=${userData}`], cwd: root, timeout: 60000,
      env: { ...process.env, RK_SPRITE_TEST_USER_DATA: userData } }
    : { args: [root, `--user-data-dir=${userData}`], cwd: root, timeout: 60000,
      env: { ...process.env, RK_SPRITE_TEST_USER_DATA: userData } });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, projectFile);
  await page.getByRole("button", { name: "新建工程" }).click();
  await page.locator("#nameInput").fill("History");
  await page.locator("#nameForm button[type=submit]").click();
  await page.locator("#projectName").getByText("History").waitFor();
  assert.equal(await page.locator("#undo").isDisabled(), true);
  assert.equal(await page.locator("#redo").isDisabled(), true);

  const pngs = await page.evaluate(() => ["#e94b52", "#48c5a5", "#537ee4", "#f2c058"].map((color) => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    context.fillStyle = color;
    context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL("image/png").split(",")[1];
  }));
  for (const [index, file] of [...framePaths, outfitPath].entries()) {
    fs.writeFileSync(file, Buffer.from(pngs[index], "base64"));
  }

  await pick(framePaths);
  await page.locator("#pngImport").click();
  await page.locator("#nameInput").fill("run");
  await page.locator("#nameForm button[type=submit]").click();
  await page.locator(".frame-card").nth(2).waitFor();
  const frameIds = await page.locator(".frame-card").evaluateAll((cards) => cards.map((card) => card.dataset.frameId));
  assert.equal(await page.locator("#undo").isEnabled(), true);
  await page.locator("#undo").click();
  assert.equal(await page.locator(".frame-card").count(), 0);
  assert.equal(await page.locator("#redo").isEnabled(), true);
  await page.locator("#redo").click();
  assert.deepEqual(await page.locator(".frame-card").evaluateAll((cards) => cards.map((card) => card.dataset.frameId)), frameIds);

  await page.locator("#addLayer").click();
  await page.locator("#newLayerName").fill("Coat");
  await page.locator("#layerForm button[type=submit]").click();
  await pick([outfitPath]);
  await page.locator("#loadLayerImage").click();
  await page.waitForFunction(() => !!document.querySelector(".frame-card .frame-layer:not(.frame-body) img")?.src);
  await page.locator("#positionX").fill("12");
  await page.locator("#positionX").dispatchEvent("change");
  await page.locator("#saveProject").click();
  await page.locator("#dirtyMark").getByText("*").waitFor({ state: "hidden" });
  const saved = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  assert.equal(saved.animations[0].layers[0].instances[frameIds[0]].x, 12);
  await page.locator("#undo").click();
  assert.equal(await page.locator("#positionX").inputValue(), "0");
  assert.equal(await page.locator("#dirtyMark").textContent(), " *");
  await page.locator("#redo").click();
  assert.equal(await page.locator("#positionX").inputValue(), "12");
  assert.equal(await page.locator("#dirtyMark").textContent(), "");

  await page.locator(".frame-card").first().locator(".frame-drag-handle").dragTo(
    page.locator('.frame-insertion-gap[data-insertion-index="3"]')
  );
  await page.waitForFunction((id) => document.querySelectorAll(".frame-card")[2]?.dataset.frameId === id, frameIds[0]);
  assert.equal(await page.locator("#dirtyMark").textContent(), " *");
  await page.locator("#undo").focus();
  await page.keyboard.press("Control+z");
  await page.waitForFunction((id) => document.querySelector(".frame-card")?.dataset.frameId === id, frameIds[0]);
  assert.equal(await page.locator("#dirtyMark").textContent(), "");
  await page.keyboard.press("Control+Shift+z");
  await page.waitForFunction((id) => document.querySelectorAll(".frame-card")[2]?.dataset.frameId === id, frameIds[0]);
  await page.keyboard.press("Control+z");
  await page.waitForFunction((id) => document.querySelector(".frame-card")?.dataset.frameId === id, frameIds[0]);
  await page.keyboard.press("Control+y");
  await page.waitForFunction((id) => document.querySelectorAll(".frame-card")[2]?.dataset.frameId === id, frameIds[0]);

  await page.locator("#layerList button[aria-label^='删除图层']").click();
  await page.locator("#confirmAccept").click();
  await page.locator("#layerList .layer-row").waitFor({ state: "hidden" });
  await page.locator("#undo").click();
  await page.locator("#layerList .layer-row").waitFor();
  await page.locator(".frame-card").last().locator(".frame-layer:not(.frame-body)").click();
  assert.equal(await page.locator("#positionX").inputValue(), "12");
  await page.locator("#redo").click();
  assert.equal(await page.locator("#layerList .layer-row").count(), 0);
  await page.locator("#undo").click();
  await page.locator("#undo").click();
  assert.deepEqual(await page.locator(".frame-card").evaluateAll((cards) => cards.map((card) => card.dataset.frameId)), frameIds);
  await page.locator("#frameDuration").fill("135");
  await page.locator("#frameDuration").dispatchEvent("change");
  assert.equal(await page.locator("#redo").isDisabled(), true);
  await page.locator("#undo").click();
  assert.equal(await page.locator("#frameDuration").inputValue(), "83");
  assert.equal(await page.locator("#dirtyMark").textContent(), "");
  await page.locator("#redo").click();
  assert.equal(await page.locator("#frameDuration").inputValue(), "135");

  await page.locator("#saveProject").click();
  const persisted = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  assert.deepEqual(persisted.animations[0].frames.map((frame) => frame.id), frameIds);
  assert.equal(persisted.animations[0].frames[0].durationMs, 135);
  assert.equal(persisted.animations[0].layers[0].instances[frameIds[0]].x, 12);
  await pick([projectFile]);
  await page.locator("#openProject").click();
  assert.equal(await page.locator("#undo").isDisabled(), true);
  assert.equal(await page.locator("#redo").isDisabled(), true);
  await page.screenshot({ path: path.join(root, "out", "history-desktop.png") });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 650));
  await page.screenshot({ path: path.join(root, "out", "history-compact.png") });
  const buttons = await page.locator("#undo, #redo, #exportAtlas").evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().toJSON()));
  assert.ok(buttons.every((bounds) => bounds.left >= 0 && bounds.right <= 920), JSON.stringify(buttons));
  assert.deepEqual(errors, []);
  console.log("Undo/redo, save state, frame order, layer restore, keyboard shortcuts, and reopen passed.");
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
