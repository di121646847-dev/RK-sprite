const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { syncGodot } = require("./godot-sync.cjs");

if (process.env.RK_SPRITE_TEST_USER_DATA) {
  const directory = path.resolve(process.env.RK_SPRITE_TEST_USER_DATA);
  fs.mkdirSync(directory, { recursive: true });
  app.setPath("userData", directory);
}

const PROJECT_EXTENSION = ".rksprite";
let mainWindow;
let currentProjectPath = "";
let selectedExportDirectory = "";
let closePending = false;
let allowClose = false;
const RECENT_KINDS = new Set(["project", "video", "sprites", "images", "export", "godot"]);
let recentDirectories = {};
let selectedGodotRoot = "";

function recentFile() {
  return path.join(app.getPath("userData"), "recent-directories.json");
}

function loadRecentDirectories() {
  try {
    const saved = JSON.parse(fs.readFileSync(recentFile(), "utf8"));
    recentDirectories = Object.fromEntries(Object.entries(saved).filter(([key, directory]) =>
      RECENT_KINDS.has(key) && typeof directory === "string" && fs.existsSync(directory)
    ));
  } catch {
    recentDirectories = {};
  }
}

function rememberDirectory(kind, fileOrDirectory) {
  if (!RECENT_KINDS.has(kind)) return;
  const directory = kind === "export" ? fileOrDirectory : path.dirname(fileOrDirectory);
  recentDirectories[kind] = directory;
  saveJson(recentFile(), recentDirectories);
}

function openProjectFile(file) {
  if (path.extname(file).toLowerCase() !== PROJECT_EXTENSION || !fs.statSync(file).isFile()) {
    throw new Error("Choose an RK sprite project.");
  }
  const project = checkProject(JSON.parse(fs.readFileSync(file, "utf8")));
  currentProjectPath = file;
  rememberDirectory("project", file);
  return { project, file };
}

function videoSource(file) {
  if (![".mp4", ".webm", ".mov", ".m4v", ".ogv"].includes(path.extname(file).toLowerCase())
    || !fs.statSync(file).isFile()) throw new Error("Choose a supported video.");
  rememberDirectory("video", file);
  return { name: path.basename(file), url: pathToFileURL(file).href };
}

function projectRoot() {
  if (!currentProjectPath) throw new Error("Create or open a project first.");
  return path.dirname(currentProjectPath);
}

function relativeAssetPath(relative) {
  const root = projectRoot();
  const value = String(relative || "").replaceAll("\\", "/");
  if (!value || value.startsWith("/") || value.includes(":") || value.split("/").includes("..")) {
    throw new Error("Invalid project asset path.");
  }
  const full = path.resolve(root, value);
  if (!full.startsWith(`${root}${path.sep}`)) throw new Error("Asset must stay inside the project.");
  return full;
}

function safeFileName(value) {
  return String(value || "asset").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/^\.+/, "").slice(0, 80) || "asset";
}

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function checkProject(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.animations)
    || (!Array.isArray(value.layers) && value.animations.some((animation) => !Array.isArray(animation.layers)))) {
    throw new Error("Invalid RK sprite project.");
  }
  return value;
}

function pngDimensions(file) {
  const header = Buffer.alloc(24);
  const fd = fs.openSync(file, "r");
  try {
    if (fs.readSync(fd, header, 0, 24, 0) !== 24 || header.toString("ascii", 1, 4) !== "PNG") {
      throw new Error("Invalid PNG image.");
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

function selectedSpriteSource(files) {
  const pngs = files.filter((file) => path.extname(file).toLowerCase() === ".png");
  const jsons = files.filter((file) => path.extname(file).toLowerCase() === ".json");
  if (jsons.length > 1 || (jsons.length && pngs.length > 1) || !pngs.length && !jsons.length) {
    throw new Error("Select one Atlas PNG with its JSON, or one/more PNG frames.");
  }
  if (pngs.length > 1) return { kind: "frames", files: pngs };
  const json = jsons[0] || (pngs.length === 1
    ? [
      path.join(path.dirname(pngs[0]), `${path.parse(pngs[0]).name}.json`),
      path.basename(pngs[0]).toLowerCase() === "spritesheet.png"
        ? path.join(path.dirname(pngs[0]), "spritesheet.json")
        : "",
    ].find((file) => file && fs.existsSync(file))
    : null);
  if (!json) return { kind: "grid", png: pngs[0], ...pngDimensions(pngs[0]) };
  if (fs.statSync(json).size > 4 * 1024 * 1024) throw new Error("Atlas JSON is too large.");
  const metadata = JSON.parse(fs.readFileSync(json, "utf8").replace(/^\uFEFF/, ""));
  const referenced = String(metadata.meta?.image || metadata.image || "").replaceAll("\\", "/");
  if (referenced && (referenced.startsWith("/") || referenced.includes(":") || referenced.split("/").includes(".."))) {
    throw new Error("Atlas image reference must be beside its JSON.");
  }
  const image = pngs[0] || path.join(path.dirname(json), referenced || `${path.parse(json).name}.png`);
  if (!fs.existsSync(image) || path.extname(image).toLowerCase() !== ".png") {
    throw new Error("Select the PNG referenced by this Atlas JSON.");
  }
  return { kind: "atlas", png: image, metadata, ...pngDimensions(image) };
}

function createWindow() {
  closePending = false;
  allowClose = false;
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 920,
    minHeight: 650,
    title: "RK sprite",
    backgroundColor: "#171b20",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "..", "src", "index.html"));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.on("close", (event) => {
    if (allowClose) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    mainWindow.webContents.send("app:close-requested");
  });
}

app.whenReady().then(() => {
  loadRecentDirectories();
  ipcMain.handle("app:cancel-close", () => {
    closePending = false;
  });
  ipcMain.handle("app:complete-close", () => {
    allowClose = true;
    setImmediate(() => mainWindow?.close());
  });
  ipcMain.handle("project:new", async (_event, name) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Create RK sprite project",
      defaultPath: path.join(recentDirectories.project || app.getPath("documents"), `${safeFileName(name || "New project")}${PROJECT_EXTENSION}`),
      filters: [{ name: "RK sprite project", extensions: ["rksprite"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const file = result.filePath.endsWith(PROJECT_EXTENSION) ? result.filePath : result.filePath + PROJECT_EXTENSION;
    if (fs.existsSync(file)) throw new Error("Project already exists. Open it instead.");
    const project = { schemaVersion: 1, name: String(name || "New project").trim(), canvas: { width: 512, height: 512 }, fps: 12, animations: [] };
    saveJson(file, project);
    currentProjectPath = file;
    rememberDirectory("project", file);
    return { project, file };
  });

  ipcMain.handle("project:open", async (_event, droppedFile) => {
    if (droppedFile) return openProjectFile(path.resolve(String(droppedFile)));
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Open RK sprite project",
      defaultPath: recentDirectories.project || app.getPath("documents"),
      properties: ["openFile"],
      filters: [{ name: "RK sprite project", extensions: ["rksprite"] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return openProjectFile(result.filePaths[0]);
  });

  ipcMain.handle("project:save", (_event, project) => {
    checkProject(project);
    saveJson(currentProjectPath, project);
    return { file: currentProjectPath };
  });

  ipcMain.handle("files:pick-video", async (_event, droppedFile) => {
    if (droppedFile) return videoSource(path.resolve(String(droppedFile)));
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Import video",
      defaultPath: recentDirectories.video || app.getPath("videos"),
      properties: ["openFile"],
      filters: [{ name: "Video", extensions: ["mp4", "webm", "mov", "m4v", "ogv"] }],
    });
    return result.canceled ? null : videoSource(result.filePaths[0]);
  });

  ipcMain.handle("files:pick-images", async (_event, droppedFiles) => {
    if (droppedFiles?.length) {
      const files = droppedFiles.map((file) => path.resolve(String(file)));
      if (files.some((file) => path.extname(file).toLowerCase() !== ".png" || !fs.statSync(file).isFile())) {
        throw new Error("Choose PNG images.");
      }
      rememberDirectory("images", files[0]);
      return files;
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Import PNG images",
      defaultPath: recentDirectories.images || recentDirectories.sprites || app.getPath("pictures"),
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "PNG images", extensions: ["png"] }],
    });
    if (result.canceled) return [];
    rememberDirectory("images", result.filePaths[0]);
    return result.filePaths;
  });

  ipcMain.handle("files:pick-sprites", async (_event, droppedFiles) => {
    if (droppedFiles?.length) {
      const files = droppedFiles.map((file) => path.resolve(String(file)));
      const source = selectedSpriteSource(files);
      rememberDirectory("sprites", files[0]);
      return source;
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Import PNG sequence or Atlas",
      defaultPath: recentDirectories.sprites || recentDirectories.images || app.getPath("pictures"),
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "PNG and Atlas JSON", extensions: ["png", "json"] },
        { name: "PNG images", extensions: ["png"] },
      ],
    });
    if (result.canceled) return null;
    const source = selectedSpriteSource(result.filePaths);
    rememberDirectory("sprites", result.filePaths[0]);
    return source;
  });

  ipcMain.handle("asset:import", (_event, input) => {
    const source = path.resolve(String(input || ""));
    if (path.extname(source).toLowerCase() !== ".png" || !fs.statSync(source).isFile()) throw new Error("Choose a PNG image.");
    const bytes = fs.readFileSync(source);
    if (bytes.toString("ascii", 1, 4) !== "PNG") throw new Error("Invalid PNG image.");
    const name = `${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 20)}.png`;
    const relative = `assets/imported/${name}`;
    const destination = relativeAssetPath(relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes);
    return relative;
  });

  ipcMain.handle("asset:write", (_event, relative, dataUrl) => {
    const match = /^data:image\/png;base64,([a-z0-9+/=\r\n]+)$/i.exec(String(dataUrl || ""));
    if (!match || !String(relative).toLowerCase().endsWith(".png")) throw new Error("Expected PNG image data.");
    const bytes = Buffer.from(match[1], "base64");
    if (bytes.length < 24 || bytes.length > 64 * 1024 * 1024 || bytes.toString("ascii", 1, 4) !== "PNG") {
      throw new Error("Invalid or oversized PNG.");
    }
    const destination = relativeAssetPath(relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    return relative;
  });

  ipcMain.handle("asset:read", (_event, relative) => {
    const file = relativeAssetPath(relative);
    if (path.extname(file).toLowerCase() !== ".png") throw new Error("Only PNG assets can be read.");
    return `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
  });

  ipcMain.handle("export:directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Export layered atlases",
      defaultPath: recentDirectories.export || app.getPath("documents"),
      properties: ["openDirectory", "createDirectory"],
    });
    selectedExportDirectory = result.canceled ? "" : result.filePaths[0];
    if (selectedExportDirectory) rememberDirectory("export", selectedExportDirectory);
    return selectedExportDirectory || null;
  });

  ipcMain.handle("export:write", (_event, directory, items) => {
    const target = path.resolve(String(directory || ""));
    if (!selectedExportDirectory || target !== path.resolve(selectedExportDirectory)) throw new Error("Select an export directory first.");
    if (!fs.statSync(target).isDirectory()) throw new Error("Export directory not found.");
    const folder = path.join(target, `RK_sprite_${new Date().toISOString().replace(/[:.]/g, "-")}`);
    fs.mkdirSync(folder, { recursive: false });
    for (const item of items) {
      const stem = safeFileName(item.name);
      if (item.image) {
        const match = /^data:image\/png;base64,([a-z0-9+/=\r\n]+)$/i.exec(item.image);
        if (!match) throw new Error("Invalid atlas image.");
        fs.writeFileSync(path.join(folder, `${stem}.png`), Buffer.from(match[1], "base64"));
      }
      saveJson(path.join(folder, `${stem}.json`), item.metadata);
    }
    selectedExportDirectory = "";
    return folder;
  });

  ipcMain.handle("godot:pick-project", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select Godot project folder",
      defaultPath: recentDirectories.godot || app.getPath("documents"),
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const directory = path.resolve(result.filePaths[0]);
    if (!fs.existsSync(path.join(directory, "project.godot"))) throw new Error("所选目录不是 Godot 工程。");
    selectedGodotRoot = directory;
    recentDirectories.godot = directory;
    saveJson(recentFile(), recentDirectories);
    return { directory };
  });

  ipcMain.handle("godot:sync", (_event, directory, project, items) => {
    if (!selectedGodotRoot || path.resolve(String(directory)) !== selectedGodotRoot) {
      throw new Error("请先选择 Godot 工程。");
    }
    checkProject(project);
    if (!currentProjectPath) throw new Error("请先打开 RK sprite 工程。");
    const result = syncGodot(
      currentProjectPath, project, items, selectedGodotRoot,
      path.join(__dirname, "..", "godot", "rk_sprite_player_v2.gd")
    );
    selectedGodotRoot = "";
    return result;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
