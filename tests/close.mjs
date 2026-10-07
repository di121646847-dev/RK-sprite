import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const executablePath = process.env.RK_SPRITE_PACKAGED_EXE;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rk-sprite-close-"));
const userData = path.join(temp, "user-data");
const projectFile = path.join(temp, "Close.rksprite");
let application;

async function launch() {
  application = await electron.launch(executablePath
    ? { executablePath, args: [`--user-data-dir=${userData}`], cwd: root, timeout: 60000,
      env: { ...process.env, RK_SPRITE_TEST_USER_DATA: userData } }
    : { args: [root, `--user-data-dir=${userData}`], cwd: root, timeout: 60000,
      env: { ...process.env, RK_SPRITE_TEST_USER_DATA: userData } });
  return application.firstWindow();
}

async function closeWindow() {
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
}

try {
  let page = await launch();
  await application.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, projectFile);
  await page.getByRole("button", { name: "新建工程" }).click();
  await page.locator("#nameInput").fill("Close");
  await page.locator("#nameForm button[type=submit]").click();
  await page.locator("#canvasWidth").fill("640");
  await page.locator("#canvasWidth").dispatchEvent("change");
  await closeWindow();
  await page.locator("#closeDialog").waitFor({ state: "visible" });
  await page.locator("#cancelClose").click();
  await page.locator("#closeDialog").waitFor({ state: "hidden" });
  await closeWindow();
  await page.locator("#closeDialog").waitFor({ state: "visible" });
  await Promise.all([page.waitForEvent("close"), page.locator("#discardClose").click()]);
  assert.equal(JSON.parse(fs.readFileSync(projectFile, "utf8")).canvas.width, 512);
  await application.close();

  page = await launch();
  await application.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, projectFile);
  await page.getByRole("button", { name: "打开工程" }).click();
  await page.locator("#projectName").getByText("Close").waitFor();
  await page.locator("#canvasWidth").fill("768");
  await page.locator("#canvasWidth").dispatchEvent("change");
  await closeWindow();
  await page.locator("#closeDialog").waitFor({ state: "visible" });
  await Promise.all([page.waitForEvent("close"), page.locator("#saveAndClose").click()]);
  assert.equal(JSON.parse(fs.readFileSync(projectFile, "utf8")).canvas.width, 768);
  console.log("Close dialog: cancel, discard, and save all passed.");
} finally {
  try { await application?.close(); } catch {}
  fs.rmSync(temp, { recursive: true, force: true });
}
