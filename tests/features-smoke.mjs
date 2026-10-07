import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { projectSlug } from "../electron/godot-sync.cjs";

const root = path.resolve(import.meta.dirname, "..");
const executablePath = process.env.RK_SPRITE_PACKAGED_EXE;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rk-sprite-features-"));
const userData = path.join(temp, "user-data");
const projectFile = path.join(temp, "Features.rksprite");
const godotRoot = path.join(temp, "godot-project");
const bodyFiles = [0, 1, 2].map((index) => path.join(temp, `body_${index}.png`));
const outfitFiles = [0, 1, 2].map((index) => path.join(temp, `coat_${index}.png`));
const godotExe = process.env.GODOT_EXE || "godot";
const errors = [];
let app;

async function pick(files) {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, files);
}

try {
  fs.mkdirSync(godotRoot);
  fs.writeFileSync(path.join(godotRoot, "project.godot"), 'config_version=5\n\n[application]\nconfig/name="RK smoke"\n');
  fs.writeFileSync(path.join(godotRoot, "keep.txt"), "untouched");
  app = await electron.launch(executablePath
    ? { executablePath, args: [`--user-data-dir=${userData}`], cwd: root, timeout: 60000,
      env: { ...process.env, RK_SPRITE_TEST_USER_DATA: userData } }
    : { args: [root, `--user-data-dir=${userData}`], cwd: root, timeout: 60000,
      env: { ...process.env, RK_SPRITE_TEST_USER_DATA: userData } });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const imageData = await page.evaluate(() => ["#e33a55", "#438aee", "#55c48c", "#ecbf32", "#ea7630", "#ba53de"].map((color) => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    context.fillStyle = color;
    context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL("image/png").split(",")[1];
  }));
  for (const [index, file] of [...bodyFiles, ...outfitFiles].entries()) {
    fs.writeFileSync(file, Buffer.from(imageData[index], "base64"));
  }
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, projectFile);
  await page.getByRole("button", { name: "新建工程" }).click();
  await page.locator("#nameInput").fill("Features");
  await page.locator("#nameForm button[type=submit]").click();
  await pick(bodyFiles);
  await page.locator("#pngImport").click();
  await page.locator("#nameInput").fill("run");
  await page.locator("#nameForm button[type=submit]").click();
  await page.locator(".frame-card").nth(2).waitFor();
  const ids = await page.locator(".frame-card").evaluateAll((cards) => cards.map((card) => card.dataset.frameId));
  await page.locator("#playbackSpeed").fill("2");
  await page.locator("#playbackSpeed").dispatchEvent("change");

  await page.locator("#showAxes").check();
  const axes = await page.evaluate(() => {
    const stage = document.querySelector("#stageWrap").getBoundingClientRect();
    const guides = document.querySelector("#stageGuides").getBoundingClientRect();
    const x = document.querySelector(".axis-x").getBoundingClientRect();
    const y = document.querySelector(".axis-y").getBoundingClientRect();
    return {
      stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height },
      guides: { x: guides.x, y: guides.y, width: guides.width, height: guides.height },
      x: x.y, y: y.x, xLabel: document.querySelector(".axis-x span").textContent,
      yLabel: document.querySelector(".axis-y span").textContent,
    };
  });
  assert.deepEqual(axes.guides, axes.stage);
  assert.ok(Math.abs(axes.x - (axes.stage.y + axes.stage.height / 2)) <= 1);
  assert.ok(Math.abs(axes.y - (axes.stage.x + axes.stage.width / 2)) <= 1);
  assert.equal(axes.xLabel, "X");
  assert.equal(axes.yLabel, "Y");
  await page.locator("#bodyOffsetX").fill("4");
  await page.locator("#bodyOffsetX").dispatchEvent("change");
  await page.locator("#bodyOffsetY").fill("-3");
  await page.locator("#bodyOffsetY").dispatchEvent("change");
  await page.locator('[data-tool="align"]').click();
  const stage = await page.locator("#stage").boundingBox();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 + 8, stage.y + stage.height / 2);
  await page.mouse.up();
  assert.equal(await page.locator("#bodyOffsetX").inputValue(), "6");
  await page.locator("#undo").click();
  assert.equal(await page.locator("#bodyOffsetX").inputValue(), "4");
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 + 5, stage.y + stage.height / 2);
  await page.mouse.up();
  assert.equal(await page.locator("#bodyOffsetX").inputValue(), "5.25");
  await page.locator("#undo").click();
  await page.locator("#gridStep").fill("1");
  await page.locator("#gridStep").dispatchEvent("change");
  await page.locator("#showPixelGrid").check();
  assert.equal(await page.locator("#bodyOffsetX").inputValue(), "4");
  const grid = await page.evaluate(() => {
    const layer = document.querySelector(".pixel-grid");
    const parent = document.querySelector("#stageGuides");
    return { display: getComputedStyle(layer).display, size: getComputedStyle(layer).backgroundSize,
      pointer: getComputedStyle(parent).pointerEvents };
  });
  assert.deepEqual(grid, { display: "block", size: "4px 4px, 4px 4px", pointer: "none" });
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 + 5, stage.y + stage.height / 2);
  await page.mouse.up();
  assert.equal(await page.locator("#bodyOffsetX").inputValue(), "5");
  await page.locator("#undo").click();
  assert.equal(await page.locator("#bodyOffsetX").inputValue(), "4");
  await page.locator('[data-tool="select"]').click();
  await page.locator(".frame-card").first().locator(".frame-body").click();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 + 5, stage.y + stage.height / 2);
  await page.mouse.up();
  assert.equal(await page.locator("#bodyOffsetX").inputValue(), "5");
  await page.locator("#undo").click();
  assert.equal(await page.locator("#bodyOffsetX").inputValue(), "4");
  await page.locator("#addLayer").click();
  await page.locator("#newLayerName").fill("Coat");
  await page.locator("#newLayerSlot").fill("upper");
  await page.locator("#layerForm button[type=submit]").click();
  await pick(outfitFiles);
  await page.locator("#loadLayerSequence").click();
  await page.getByText(/Coat 已对应 3 帧/).waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector(".frame-card .frame-layer:not(.frame-body) img");
    return image?.complete && image.naturalWidth > 0;
  });
  const layerStage = await page.locator("#stage").boundingBox();
  const layerPoint = { x: layerStage.x + layerStage.width / 2, y: layerStage.y + layerStage.height / 2 };
  await page.mouse.move(layerPoint.x, layerPoint.y);
  await page.mouse.down();
  await page.mouse.move(layerPoint.x + 5, layerPoint.y);
  await page.mouse.up();
  assert.equal(await page.locator("#positionX").inputValue(), "1");
  await page.locator("#undo").click();
  await page.locator("#showPixelGrid").uncheck();
  await page.mouse.move(layerPoint.x, layerPoint.y);
  await page.mouse.down();
  await page.mouse.move(layerPoint.x + 5, layerPoint.y);
  await page.mouse.up();
  assert.equal(await page.locator("#positionX").inputValue(), "1.25");
  await page.locator("#undo").click();
  await page.locator("#showPixelGrid").check();
  await page.locator("#layerBehind").check();
  await page.locator("#positionX").fill("5");
  await page.locator("#positionX").dispatchEvent("change");
  await page.locator("#pivotX").fill("25");
  await page.locator("#pivotX").dispatchEvent("change");
  await page.locator('[data-tool="pivot"]').click();
  const pivotStage = await page.locator("#stage").boundingBox();
  await page.mouse.click(pivotStage.x + 17.4 * 4, pivotStage.y + 16.3 * 4);
  const pivotPercent = Number(await page.locator("#pivotX").inputValue());
  assert.equal((pivotPercent * 32 / 100).toFixed(2), Math.round(pivotPercent * 32 / 100).toFixed(2));
  await page.locator("#undo").click();
  await page.locator('[data-tool="select"]').click();
  assert.equal(await page.locator("#pivotX").inputValue(), "25");
  await page.locator("#positionX").fill("5.4");
  await page.locator("#positionX").dispatchEvent("change");
  assert.equal(await page.locator("#positionX").inputValue(), "5");
  await page.locator("#copyLayerTransform").click();
  await page.getByText(/素材未更改/).waitFor();
  await page.locator(".frame-card").nth(1).locator(".frame-layer:not(.frame-body)").click();
  await page.locator("#frameDisabled").check();
  await page.locator(".frame-card").nth(1).locator(".frame-disable").getAttribute("aria-label").then((label) =>
    assert.match(label, /启用/));
  await page.locator(".frame-card").nth(2).locator(".frame-layer:not(.frame-body)").click();
  assert.equal(await page.locator("#layerBehind").isChecked(), false);
  await page.locator("#positionX").inputValue().then((value) => assert.equal(value, "5"));
  await page.locator("#undo").click();
  await page.locator("#redo").click();
  await page.locator("#saveProject").click();
  await page.locator("#saveStatus").getByText("已保存").waitFor();
  const saved = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  assert.equal(saved.animations[0].playbackSpeed, 2);
  assert.deepEqual(saved.animations[0].frames.map((frame) => frame.disabled), [false, true, false]);
  assert.equal(saved.animations[0].frames[0].offsetX, 4);
  assert.equal(saved.animations[0].frames[0].offsetY, -3);
  const coat = saved.animations[0].layers[0];
  assert.equal(coat.instances[ids[0]].behind, true);
  assert.equal(coat.instances[ids[2]].behind, undefined);
  assert.equal(coat.instances[ids[2]].x, 5);
  assert.equal(coat.instances[ids[2]].pivotX, 0.25);
  assert.notEqual(coat.instances[ids[0]].asset, coat.instances[ids[2]].asset);

  await pick([godotRoot]);
  await page.locator("#syncGodot").click();
  const slug = projectSlug(projectFile);
  const output = path.join(godotRoot, "rk_sprite", slug);
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("已同步到 Godot"));
  const manifest = JSON.parse(fs.readFileSync(path.join(output, "animation.json"), "utf8"));
  assert.equal(manifest.actions.run.playbackSpeed, 2);
  assert.match(fs.readFileSync(path.join(output, "player.tscn"), "utf8"), /rk_sprite_player_v2\.gd/);
  assert.deepEqual(manifest.actions.run.frames.map((frame) => frame.id), [ids[0], ids[2]]);
  assert.deepEqual(manifest.actions.run.frames.map((frame) => frame.sourceIndex), [0, 2]);
  assert.deepEqual(manifest.actions.run.layers[0].frames.map((frame) => frame.behind), [true, false]);
  assert.equal(fs.readFileSync(path.join(godotRoot, "keep.txt"), "utf8"), "untouched");
  assert.ok(fs.existsSync(path.join(output, "player.tscn")));
  assert.ok(fs.existsSync(path.join(output, "preview.tscn")));
  const sceneFile = path.join(output, "player.tscn");
  const previousScene = fs.readFileSync(sceneFile, "utf8").replace("rk_sprite_player_v2.gd", "rk_sprite_player_v1.gd");
  fs.writeFileSync(sceneFile, previousScene);
  await pick([godotRoot]);
  await page.locator("#syncGodot").click();
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("已同步到 Godot"));
  assert.match(fs.readFileSync(sceneFile, "utf8"), /rk_sprite_player_v2\.gd/);
  const imageBytes = fs.readFileSync(path.join(output, manifest.actions.run.body));
  const pixels = await page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return [[0, 0], [4, 0], [3, 3]].map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
  }, imageBytes.toString("base64"));
  assert.deepEqual(pixels, [[0, 0, 0, 0], [227, 58, 85, 255], [0, 0, 0, 0]]);
  await page.screenshot({ path: path.join(root, "out", "grid-axes-desktop.png") });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 650));
  await page.screenshot({ path: path.join(root, "out", "grid-axes-compact.png") });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 920));
  await page.locator("#showPixelGrid").uncheck();
  assert.equal(await page.locator(".pixel-grid").evaluate((node) => getComputedStyle(node).display), "none");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 650));
  await page.screenshot({ path: path.join(root, "out", "features-compact.png") });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 920));
  await page.screenshot({ path: path.join(root, "out", "features-desktop.png") });
  assert.deepEqual(errors, []);

  if (spawnSync(godotExe, ["--version"], { encoding: "utf8", timeout: 10000 }).status === 0) {
    const probe = fs.readFileSync(path.join(root, "tests", "godot", "runtime_probe.gd"), "utf8")
      .replaceAll("TEST_SLUG", slug);
    fs.writeFileSync(path.join(godotRoot, "runtime_probe.gd"), probe);
    const imported = spawnSync(godotExe, ["--headless", "--editor", "--path", godotRoot, "--import", "--quit"], {
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(imported.status, 0, imported.stdout + imported.stderr);
    const runtime = spawnSync(godotExe, ["--headless", "--path", godotRoot, "--script", "res://runtime_probe.gd"], {
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(runtime.status, 0, runtime.stdout + runtime.stderr);
    assert.match(runtime.stdout, /Godot runtime probe passed/);
  } else {
    console.log("Godot executable unavailable; runtime probe skipped.");
  }
  console.log("Per-frame order, copy transforms, alignment, disabled frames and Godot sync passed.");
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
