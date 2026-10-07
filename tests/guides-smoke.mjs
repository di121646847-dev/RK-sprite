import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rk-guides-"));
const projectFile = path.join(temp, "Guides.rksprite");
const executablePath = process.env.RK_SPRITE_PACKAGED_EXE;
const userData = path.join(temp, "user-data");
const errors = [];
let app;

async function axes(page) {
  return page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
    return { x: rect(".axis-x"), y: rect(".axis-y"), label: rect(".axis-x span"), view: rect("#stageWrap") };
  });
}

async function setNumber(page, id, value) {
  await page.locator(id).fill(String(value));
  await page.locator(id).dispatchEvent("change");
}

try {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [`--user-data-dir=${userData}`] } : { args: [root, `--user-data-dir=${userData}`] }),
    cwd: root, env: { ...process.env, RK_SPRITE_TEST_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const pngs = await page.evaluate(() => [96, 224, 352].map((x, i) => {
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 384;
    const c = canvas.getContext("2d");
    c.fillStyle = ["#47c598", "#ebae3a", "#e75468"][i];
    c.fillRect(x, 128, 48, 88);
    c.fillRect(x + 8, 92, 32, 32);
    c.fillRect(x - 16, 140, 16, 52);
    c.fillRect(x + 48, 140, 16, 52);
    c.fillRect(x + 2, 216, 14, 48);
    c.fillRect(x + 32, 216, 14, 48);
    return canvas.toDataURL("image/png").split(",")[1];
  }));
  pngs.forEach((png, i) => fs.writeFileSync(path.join(temp, `${i}.png`), Buffer.from(png, "base64")));
  const project = { schemaVersion: 1, name: "Guides", canvas: { width: 512, height: 384 }, fps: 5,
    animations: [{ id: "walk", name: "walk", playbackSpeed: 1, frames: pngs.map((_, i) => ({
      id: `f${i}`, asset: `${i}.png`, durationMs: 800, offsetX: 0, offsetY: 0,
    })), layers: [] }] };
  fs.writeFileSync(projectFile, JSON.stringify(project));
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, projectFile);
  await page.getByRole("button", { name: "打开工程" }).click();
  await page.locator(".frame-card").nth(2).waitFor();
  await page.waitForFunction(() => document.querySelector("#stage").width === 512);

  for (const [width, height] of [[1500, 920], [920, 650]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    await page.locator("#fitCanvas").click();
    const viewBefore = await page.locator("#stage").boundingBox();
    const zoom = await page.locator("#zoomText").textContent();
    await page.locator("#showAxes").check();
    await page.locator("#showPixelGrid").check();
    await page.locator("#onionSkin").check();
    assert.deepEqual(await page.locator("#stage").boundingBox(), viewBefore);
    assert.equal(await page.locator("#zoomText").textContent(), zoom);
    assert.equal(await page.locator(".pixel-grid").isVisible(), true);
    const before = await axes(page);
    await page.locator("#zoomIn").click();
    await page.locator("#zoomIn").click();
    assert.deepEqual(await axes(page), before);
    assert.equal(before.x.width, before.view.width);
    assert.equal(before.y.height, before.view.height);
    await page.locator("#fitCanvas").click();
    await page.screenshot({ path: path.join(root, "out", `guides-${width}.png`) });
  }

  // UI drag must land the body's reference point on a visible grid intersection.
  await page.locator(".frame-card").first().locator(".frame-body").click();
  const stage = await page.locator("#stage").boundingBox();
  const scale = stage.width / 512;
  const start = { x: stage.x + 120 * scale, y: stage.y + 160 * scale };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 13 * scale, start.y + 11 * scale, { steps: 5 });
  assert.equal(await page.locator(".snap-marker").isVisible(), true);
  const marker = await page.locator(".snap-marker").boundingBox();
  const view = await page.locator("#stageWrap").boundingBox();
  assert.ok(Math.abs(marker.x + marker.width / 2 - (view.x + view.width / 2 + 16 * scale)) < 1);
  await page.mouse.up();
  assert.equal(await page.locator("#bodyOffsetX").inputValue(), "16");
  assert.equal(await page.locator("#bodyOffsetY").inputValue(), "8");
  await page.locator("#undo").click();
  assert.equal(await page.locator("#bodyOffsetX").inputValue(), "0");
  await page.locator("#redo").click();
  await page.locator("#undo").click();

  // A layer with a fractional owner offset must still snap to the same canvas grid.
  await page.locator("#snapGrid").uncheck();
  await setNumber(page, "#bodyOffsetX", 3.25);
  await page.locator("#addLayer").click();
  await page.locator("#newLayerName").fill("Coat");
  await page.locator("#layerForm button[type=submit]").click();
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.join(temp, "0.png"));
  await page.locator("#loadLayerImage").click();
  await page.waitForFunction(() => document.querySelector(".frame-card .frame-layer:not(.frame-body) img")?.naturalWidth > 0);
  await page.locator("#snapGrid").check();
  await setNumber(page, "#positionX", 5);
  assert.equal(await page.locator("#positionX").inputValue(), "4.75");
  await page.mouse.move(stage.x + 128 * scale, stage.y + 160 * scale);
  await page.mouse.down();
  await page.mouse.move(stage.x + 141 * scale, stage.y + 160 * scale, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.locator("#positionX").inputValue(), "20.75");
  await page.locator("#undo").click();
  assert.equal(await page.locator("#positionX").inputValue(), "4.75");
  await page.locator("#snapGrid").uncheck();
  await setNumber(page, "#positionX", 5.25);
  assert.equal(await page.locator("#positionX").inputValue(), "5.25");

  // Reopen the unchanged fixture for a clean playback/pixel test.
  await page.locator("#undo").focus();
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, projectFile);
  await page.locator("#openProject").click();
  await page.locator("#confirmCancel").click();
  await page.locator("#confirmAccept").click();
  await page.locator("#showPixelGrid").check();
  await page.locator("#snapGrid").check();
  await page.locator("#showAxes").check();
  await page.locator("#onionSkin").check();
  await page.locator("#play").click();
  for (const index of [1, 2, 0]) {
    await page.waitForFunction((id) => document.querySelector(".frame-card.selected")?.dataset.frameId === `f${id}`, index);
    assert.equal(await page.locator(".pixel-grid").isVisible(), true);
    assert.equal(await page.locator(".axis-x").isVisible(), true);
    assert.equal(await page.locator(".axis-y").isVisible(), true);
    await page.waitForFunction((id) => {
      const ctx = document.querySelector("#stage").getContext("2d");
      const a = [96, 224, 352].map((x) => ctx.getImageData(x + 20, 160, 1, 1).data[3]);
      return a[id] === 255 && a.every((v) => v >= 50);
    }, index, { timeout: 2500 });
  }
  await page.screenshot({ path: path.join(root, "out", "guides-playing.png") });
  const overlay = await page.locator(".pixel-grid").evaluate((node) => ({
    background: getComputedStyle(node).backgroundColor,
    pointer: getComputedStyle(node).pointerEvents,
  }));
  assert.deepEqual(overlay, { background: "rgba(0, 0, 0, 0)", pointer: "none" });
  const toolbarFits = await page.locator(".timeline-actions > *").evaluateAll((controls) => controls.every((node) => {
    const rect = node.getBoundingClientRect();
    const parent = node.closest(".timeline").getBoundingClientRect();
    return rect.left >= parent.left && rect.right <= parent.right;
  }));
  assert.equal(toolbarFits, true);
  await page.locator("#onionSkin").uncheck();
  await page.waitForFunction(() => {
    const c = document.querySelector("#stage").getContext("2d");
    return [96, 224, 352].filter((x) => c.getImageData(x + 20, 160, 1, 1).data[3] === 0).length === 2;
  });
  await page.locator("#onionSkin").check();
  await page.locator("#play").click();
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, temp);
  await page.locator("#exportAtlas").click();
  await page.locator("#toast").getByText(/已导出 1 组分层图集/).waitFor();
  const folder = fs.readdirSync(temp).find((entry) => entry.startsWith("RK_sprite_"));
  assert.ok(folder);
  const exported = fs.readFileSync(path.join(temp, folder, "walk_body.png")).toString("base64");
  const alphas = await page.evaluate(async (bytes) => {
    const image = new Image();
    image.src = `data:image/png;base64,${bytes}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    return [96, 224, 352].map((x) => ctx.getImageData(x + 20, 160, 1, 1).data[3]);
  }, exported);
  assert.deepEqual(alphas, [255, 0, 0]);
  assert.deepEqual(errors, []);
  console.log("Viewport-fixed axes, visible translucent grid, canvas-space snap and all playback guides passed.");
} finally {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
  fs.rmSync(temp, { recursive: true, force: true });
}
