import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const executablePath = process.env.RK_SPRITE_PACKAGED_EXE;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rk-sprite-atlas-"));
const userData = path.join(temp, "user-data");
const projectFile = path.join(temp, "Atlas.rksprite");
const bodyImage = path.join(temp, "body.png");
const bodyJson = path.join(temp, "body.json");
const outfitImage = path.join(temp, "outfit.png");
const outfitJson = path.join(temp, "outfit.json");
const gridImage = path.join(temp, "grid.png");
const errors = [];
let app;

async function pick(paths) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selected });
  }, paths);
}

async function pixels(page, points) {
  return page.locator("#stage").evaluate((canvas, positions) => {
    const context = canvas.getContext("2d");
    return positions.map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
  }, points);
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
  await page.locator("#nameInput").fill("Atlas");
  await page.locator("#nameForm button[type=submit]").click();

  const assets = await page.evaluate(() => {
    const make = (width, height, paint) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      paint(canvas.getContext("2d"));
      return canvas.toDataURL("image/png").split(",")[1];
    };
    return {
      body: make(64, 32, (ctx) => {
        ctx.fillStyle = "#cc2233";
        ctx.fillRect(0, 0, 32, 32);
        ctx.fillStyle = "#2233cc";
        ctx.fillRect(32, 0, 32, 32);
      }),
      outfit: make(16, 8, (ctx) => {
        ctx.fillStyle = "#22ee66";
        ctx.fillRect(0, 0, 8, 8);
        ctx.fillStyle = "#eebb22";
        ctx.fillRect(8, 0, 8, 8);
      }),
      grid: make(96, 32, (ctx) => {
        for (const [index, color] of ["#cc2233", "#22cc33", "#2233cc"].entries()) {
          ctx.fillStyle = color;
          ctx.fillRect(index * 32, 0, 32, 32);
        }
      }),
    };
  });
  for (const [file, data] of [[bodyImage, assets.body], [outfitImage, assets.outfit], [gridImage, assets.grid]]) {
    fs.writeFileSync(file, Buffer.from(data, "base64"));
  }
  fs.writeFileSync(bodyJson, JSON.stringify({
    canvas: { width: 32, height: 32 },
    frames: [
      { filename: "body_1.png", x: 0, y: 0, w: 32, h: 32, durationMs: 91 },
      { filename: "body_2.png", x: 32, y: 0, w: 32, h: 32, durationMs: 109 },
    ],
  }));
  fs.writeFileSync(outfitJson, JSON.stringify({
    frames: {
      "coat_1.png": {
        frame: { x: 0, y: 0, w: 8, h: 8 }, rotated: false,
        spriteSourceSize: { x: 4, y: 5, w: 8, h: 8 }, sourceSize: { w: 32, h: 32 },
      },
      "coat_2.png": {
        frame: { x: 8, y: 0, w: 8, h: 8 }, rotated: false,
        spriteSourceSize: { x: 14, y: 5, w: 8, h: 8 }, sourceSize: { w: 32, h: 32 },
      },
    },
  }));

  await pick([bodyImage]);
  await page.locator("#pngImport").click();
  await page.locator("#nameInput").fill("run");
  await page.locator("#nameForm button[type=submit]").click();
  await page.locator(".frame-card").nth(1).waitFor();
  assert.deepEqual(await pixels(page, [[1, 1], [31, 31]]), [[204, 34, 51, 255], [204, 34, 51, 255]]);
  await page.locator(".frame-card").nth(1).click();
  await page.waitForFunction(() => {
    const pixel = document.querySelector("#stage").getContext("2d").getImageData(1, 1, 1, 1).data;
    return pixel[2] === 204;
  });
  assert.deepEqual(await pixels(page, [[1, 1]]), [[34, 51, 204, 255]]);

  await page.locator("#addLayer").click();
  await page.locator("#newLayerName").fill("Coat");
  await page.locator("#newLayerSlot").fill("upper");
  await page.locator("#layerForm button[type=submit]").click();
  await pick([outfitJson]);
  await page.locator("#loadLayerSequence").click();
  await page.getByText("Coat 已对应 2 帧 Atlas").waitFor();
  await page.waitForFunction(() => {
    const pixel = document.querySelector("#stage").getContext("2d").getImageData(15, 6, 1, 1).data;
    return pixel[0] === 238 && pixel[1] === 187 && pixel[2] === 34;
  });
  assert.deepEqual(await pixels(page, [[4, 5], [15, 6]]), [[34, 51, 204, 255], [238, 187, 34, 255]]);
  await page.locator(".frame-card").first().click();
  await page.waitForFunction(() => {
    const pixel = document.querySelector("#stage").getContext("2d").getImageData(5, 6, 1, 1).data;
    return pixel[0] === 34 && pixel[1] === 238 && pixel[2] === 102;
  });
  assert.deepEqual(await pixels(page, [[5, 6], [15, 6]]), [[34, 238, 102, 255], [204, 34, 51, 255]]);
  await page.locator("#play").click();
  await page.waitForFunction(() => {
    const pixel = document.querySelector("#stage").getContext("2d").getImageData(15, 6, 1, 1).data;
    return pixel[0] === 238 && pixel[1] === 187 && pixel[2] === 34;
  });
  await page.locator("#play").click();
  await page.locator(".frame-card").first().click();
  await page.waitForFunction(() => {
    const pixel = document.querySelector("#stage").getContext("2d").getImageData(5, 6, 1, 1).data;
    return pixel[0] === 34 && pixel[1] === 238 && pixel[2] === 102;
  });
  await page.screenshot({ path: path.join(root, "out", "atlas-preview.png") });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768));
  await page.screenshot({ path: path.join(root, "out", "atlas-preview-compact.png") });
  const inspectorFit = await page.locator(".inspector-actions button").evaluateAll((buttons) => buttons.every((button) => {
    const parent = button.closest(".inspector").getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    return rect.left >= parent.left && rect.right <= parent.right && button.scrollWidth <= button.clientWidth + 1;
  }));
  assert.equal(inspectorFit, true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 920));

  await page.locator("#playbackSpeed").fill("2.5");
  await page.locator("#playbackSpeed").dispatchEvent("change");
  await page.locator("#saveProject").click();
  const saved = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  assert.equal(saved.animations[0].frames.length, 2);
  assert.equal(saved.animations[0].playbackSpeed, 2.5);
  assert.deepEqual(saved.animations[0].frames.map((frame) => frame.durationMs), [91, 109]);
  assert.equal(Object.keys(saved.animations[0].layers[0].instances).length, 2);
  await pick([temp]);
  await page.locator("#exportAtlas").click();
  try {
    await page.getByText(/已导出 2 组分层图集/).waitFor({ timeout: 5000 });
  } catch (error) {
    throw new Error(`Atlas export status: ${await page.locator("#toast").textContent()}`, { cause: error });
  }
  const exported = fs.readdirSync(temp).find((name) => name.startsWith("RK_sprite_"));
  assert.ok(exported);
  const exportedBody = path.join(temp, exported, "run_body.png");
  const exportedJson = path.join(temp, exported, "run_body.json");
  assert.ok(fs.existsSync(exportedBody) && fs.existsSync(exportedJson));
  await pick([exportedJson]);
  await page.locator("#pngImport").click();
  await page.locator("#nameInput").fill("roundtrip");
  await page.locator("#nameForm button[type=submit]").click();
  await page.locator(".frame-card").nth(1).waitFor();
  assert.equal(await page.locator(".frame-card").count(), 2);
  await page.waitForFunction(() => {
    const pixel = document.querySelector("#stage").getContext("2d").getImageData(1, 1, 1, 1).data;
    return pixel[0] === 204 && pixel[2] === 51;
  });
  await page.locator("#saveProject").click();
  const roundtrip = JSON.parse(fs.readFileSync(projectFile, "utf8")).animations.find((entry) => entry.id === "roundtrip");
  assert.deepEqual(roundtrip.frames.map((entry) => entry.durationMs), [91, 109]);
  assert.equal(roundtrip.playbackSpeed, 2.5);
  await page.screenshot({ path: path.join(root, "out", "atlas-roundtrip.png") });

  await pick([projectFile]);
  await page.locator("#openProject").click();
  await page.waitForFunction(() => {
    const pixel = document.querySelector("#stage").getContext("2d").getImageData(1, 1, 1, 1).data;
    return pixel[0] === 204 && pixel[1] === 34 && pixel[2] === 51;
  });

  await page.locator('#animationList .list-item').first().click();
  await page.waitForFunction(() => {
    const pixel = document.querySelector("#stage").getContext("2d").getImageData(5, 6, 1, 1).data;
    return pixel[0] === 34 && pixel[1] === 238 && pixel[2] === 102;
  });
  await pick([gridImage]);
  await page.locator("#loadLayerSequence").click();
  await page.locator("#gridDialog").waitFor({ state: "visible" });
  await page.locator("#cellWidth").fill("32");
  await page.locator("#cellHeight").fill("32");
  await page.locator("#gridForm button[type=submit]").click();
  await page.getByText(/动作有 2 帧，素材有 3 帧/).waitFor();
  assert.deepEqual(await pixels(page, [[5, 6]]), [[34, 238, 102, 255]]);

  await pick([gridImage]);
  await page.locator("#pngImport").click();
  await page.locator("#gridDialog").waitFor({ state: "visible" });
  await page.locator("#cellWidth").fill("32");
  await page.locator("#cellHeight").fill("32");
  await page.locator("#gridStatus").getByText("3 帧").waitFor();
  await page.locator("#gridForm button[type=submit]").click();
  await page.locator("#nameInput").fill("grid");
  await page.locator("#nameForm button[type=submit]").click();
  await page.locator("#gridDialog").waitFor({ state: "hidden" });
  await page.locator(".frame-card").nth(2).waitFor();
  assert.equal(await page.locator(".frame-card").count(), 3);
  await page.locator(".frame-card").nth(2).click();
  await page.waitForFunction(() => {
    const pixel = document.querySelector("#stage").getContext("2d").getImageData(1, 1, 1, 1).data;
    return pixel[2] === 204;
  });
  assert.deepEqual(await pixels(page, [[1, 1]]), [[34, 51, 204, 255]]);

  assert.equal(await page.locator("#layerList .layer-row").count(), 0);
  assert.equal(await page.locator(".frame-card").first().locator(".frame-layer").count(), 1);
  await page.locator("#addLayer").click();
  await page.locator("#newLayerName").fill("Grid Coat");
  await page.locator("#layerForm button[type=submit]").click();
  assert.equal(await page.locator("#layerList .layer-row").count(), 1);
  assert.equal(await page.locator(".frame-card").first().locator(".frame-layer").count(), 2);
  await page.locator(".frame-card").nth(1).locator(".frame-layer").last().click();
  const dragged = await page.evaluate(async (base64) => {
    const card = document.querySelectorAll(".frame-card")[1];
    const target = card.querySelector(".frame-layer:not(.frame-body)");
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "outfit.png", { type: "image/png" }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const over = card.classList.contains("image-drag-over");
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return over;
  }, assets.outfit);
  assert.equal(dragged, true);
  await page.getByText("Grid Coat 已绑定到第 2 帧").waitFor();
  await page.waitForFunction(() => {
    const pixel = document.querySelector("#stage").getContext("2d").getImageData(17, 13, 1, 1).data;
    return pixel[0] === 238 && pixel[1] === 187 && pixel[2] === 34;
  });
  const thumbnailPixel = await page.locator(".frame-card").nth(1).locator(".frame-main img").evaluate(async (element) => {
    await element.decode();
    const canvas = document.createElement("canvas");
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(element, 0, 0);
    return Array.from(context.getImageData(52, 36, 1, 1).data);
  });
  assert.deepEqual(thumbnailPixel, [238, 187, 34, 255]);
  const layerThumbnail = await page.locator(".frame-card").nth(1).locator(".frame-layer:not(.frame-body) img").evaluate(async (element) => {
    await element.decode();
    const canvas = document.createElement("canvas");
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(element, 0, 0);
    return Array.from(context.getImageData(9, 1, 1, 1).data);
  });
  assert.deepEqual(layerThumbnail, [238, 187, 34, 255]);

  await page.locator("#copyFrameLayer").click();
  await page.locator(".frame-card").first().locator(".frame-layer:not(.frame-body)").click();
  await page.locator("#pasteFrameLayer").click();
  await page.waitForFunction(() => {
    const pixel = document.querySelector("#stage").getContext("2d").getImageData(17, 13, 1, 1).data;
    return pixel[0] === 238 && pixel[1] === 187 && pixel[2] === 34;
  });
  await page.locator("#clearFrameLayer").click();
  await page.locator("#confirmAccept").click();
  await page.waitForFunction(() => {
    const pixel = document.querySelector("#stage").getContext("2d").getImageData(17, 13, 1, 1).data;
    return pixel[0] === 204 && pixel[1] === 34 && pixel[2] === 51;
  });
  await page.locator(".frame-card").nth(1).locator(".frame-layer:not(.frame-body)").click();
  assert.deepEqual(await pixels(page, [[17, 13]]), [[238, 187, 34, 255]]);
  const stage = await page.locator("#stage").boundingBox();
  const wheelX = stage.x + stage.width * 0.55;
  const wheelY = stage.y + stage.height * 0.43;
  await page.mouse.move(wheelX, wheelY);
  await page.keyboard.down("r");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("r");
  await page.locator("#rotation").waitFor();
  const rotation = Number(await page.locator("#rotation").inputValue());
  assert.equal(rotation, 2);
  await page.keyboard.down("z");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("z");
  const scale = Number(await page.locator("#scale").inputValue());
  assert.ok(scale > 1 && scale < 1.1);
  await page.locator(".frame-card").first().locator(".frame-layer:not(.frame-body)").click();
  assert.equal(Number(await page.locator("#rotation").inputValue()), 0);
  assert.equal(Number(await page.locator("#scale").inputValue()), 1);
  await page.locator(".frame-card").nth(1).locator(".frame-layer:not(.frame-body)").click();
  await page.locator("#addLayer").click();
  await page.locator("#newLayerName").fill("Accessory");
  await page.locator("#layerForm button[type=submit]").click();
  await page.locator('[title="上移图层 Accessory"]').click();
  assert.deepEqual(await page.locator("#layerList .item-name").allTextContents(), ["Accessory", "Grid Coat"]);
  assert.deepEqual(await page.locator(".frame-card").nth(1).locator(".frame-layer:not(.frame-body) span").allTextContents(), ["Accessory", "Grid Coat"]);

  await page.locator("#saveProject").click();
  const isolated = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  const run = isolated.animations.find((entry) => entry.id === "run");
  const grid = isolated.animations.find((entry) => entry.id === "grid");
  assert.equal(run.layers[0].name, "Coat");
  assert.equal(grid.layers[0].name, "Accessory");
  assert.equal(grid.layers[1].name, "Grid Coat");
  assert.equal(run.layers[0].instances[grid.frames[1].id], undefined);
  assert.equal(grid.layers[1].instances[run.frames[0].id], undefined);
  assert.equal(grid.layers[1].instances[grid.frames[0].id], undefined);
  assert.ok(grid.layers[1].instances[grid.frames[1].id]?.asset);

  await page.locator(".frame-card").nth(1).locator(".frame-layer:not(.frame-body)").last().click();
  await page.locator("#frameDuration").fill("137");
  await page.locator("#frameDuration").dispatchEvent("change");
  const beforeDrag = JSON.parse(fs.readFileSync(projectFile, "utf8")).animations.find((entry) => entry.id === "grid");
  const frameIds = beforeDrag.frames.map((entry) => entry.id);
  await page.locator(".frame-card").nth(1).locator(".frame-drag-handle").dragTo(
    page.locator(".frame-card").nth(2),
    { targetPosition: { x: 125, y: 20 } }
  );
  await page.waitForFunction((id) => document.querySelectorAll(".frame-card")[2]?.dataset.frameId === id, frameIds[1]);
  assert.deepEqual(await page.locator(".frame-card").evaluateAll((cards) => cards.map((card) => card.dataset.frameId)),
    [frameIds[0], frameIds[2], frameIds[1]]);
  assert.equal(await page.locator("#frameDuration").inputValue(), "137");
  await page.locator(".frame-card").nth(2).locator(".frame-layer:not(.frame-body)").last().click();
  assert.deepEqual(await pixels(page, [[17, 13]]), [[238, 187, 34, 255]]);
  await page.locator("#saveProject").click();
  const reordered = JSON.parse(fs.readFileSync(projectFile, "utf8")).animations.find((entry) => entry.id === "grid");
  assert.deepEqual(reordered.frames.map((entry) => entry.id), [frameIds[0], frameIds[2], frameIds[1]]);
  assert.deepEqual(reordered.frames.map((entry) => entry.durationMs), [83, 83, 137]);
  assert.ok(reordered.layers[1].instances[reordered.frames[2].id]?.asset);

  await pick([projectFile]);
  await page.locator("#openProject").click();
  await page.locator('#animationList .list-item').last().click();
  assert.deepEqual(await page.locator(".frame-card").evaluateAll((cards) => cards.map((card) => card.dataset.frameId)),
    [frameIds[0], frameIds[2], frameIds[1]]);
  await page.locator(".frame-card").last().locator(".frame-main").dragTo(
    page.locator(".frame-card").first(),
    { targetPosition: { x: 5, y: 35 } }
  );
  await page.waitForFunction((id) => document.querySelector(".frame-card")?.dataset.frameId === id, frameIds[1]);
  assert.deepEqual(await page.locator(".frame-card").evaluateAll((cards) => cards.map((card) => card.dataset.frameId)),
    [frameIds[1], frameIds[0], frameIds[2]]);
  await page.screenshot({ path: path.join(root, "out", "frame-reorder.png") });

  await page.locator(".frame-card").first().locator(".frame-drag-handle").dragTo(
    page.locator('.frame-insertion-gap[data-insertion-index="2"]')
  );
  await page.waitForFunction((id) => document.querySelectorAll(".frame-card")[1]?.dataset.frameId === id, frameIds[1]);
  assert.deepEqual(await page.locator(".frame-card").evaluateAll((cards) => cards.map((card) => card.dataset.frameId)),
    [frameIds[0], frameIds[1], frameIds[2]]);

  await page.locator(".frame-card").first().locator(".frame-main").dragTo(
    page.locator('.frame-insertion-gap[data-insertion-index="3"]')
  );
  await page.waitForFunction((id) => document.querySelectorAll(".frame-card")[2]?.dataset.frameId === id, frameIds[0]);
  assert.deepEqual(await page.locator(".frame-card").evaluateAll((cards) => cards.map((card) => card.dataset.frameId)),
    [frameIds[1], frameIds[2], frameIds[0]]);

  await page.locator("#saveProject").click();
  const finalGrid = JSON.parse(fs.readFileSync(projectFile, "utf8")).animations.find((entry) => entry.id === "grid");
  assert.deepEqual(finalGrid.frames.map((entry) => entry.id), [frameIds[1], frameIds[2], frameIds[0]]);
  assert.deepEqual(finalGrid.frames.map((entry) => entry.durationMs), [137, 83, 83]);
  assert.ok(finalGrid.layers[1].instances[finalGrid.frames[0].id]?.asset);
  const previousExports = new Set(fs.readdirSync(temp));
  await pick([temp]);
  await page.locator("#exportAtlas").click();
  await page.getByText(/已导出 5 组分层图集/).waitFor();
  const newExport = fs.readdirSync(temp).find((entry) => entry.startsWith("RK_sprite_") && !previousExports.has(entry));
  assert.ok(newExport);
  const exportedGrid = JSON.parse(fs.readFileSync(path.join(temp, newExport, "grid_body.json"), "utf8"));
  assert.deepEqual(exportedGrid.frames.map((entry) => entry.frameId), [frameIds[1], frameIds[2], frameIds[0]]);
  assert.deepEqual(exportedGrid.frames.map((entry) => entry.durationMs), [137, 83, 83]);
  assert.deepEqual(errors, []);
  console.log("Atlas, outfit, grid, frame-layer drop, and whole-frame reordering passed.");
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
