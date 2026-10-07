const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("rk", {
  onCloseRequested: (callback) => ipcRenderer.on("app:close-requested", () => callback()),
  cancelClose: () => ipcRenderer.invoke("app:cancel-close"),
  completeClose: () => ipcRenderer.invoke("app:complete-close"),
  newProject: (name) => ipcRenderer.invoke("project:new", name),
  openProject: (path) => ipcRenderer.invoke("project:open", path),
  saveProject: (project) => ipcRenderer.invoke("project:save", project),
  pickVideo: (path) => ipcRenderer.invoke("files:pick-video", path),
  pickImages: (paths) => ipcRenderer.invoke("files:pick-images", paths),
  pickSprites: (paths) => ipcRenderer.invoke("files:pick-sprites", paths),
  droppedPaths: (files) => Array.from(files, (file) =>
    webUtils.getPathForFile(file) || (typeof file.path === "string" ? file.path : "")
  ).filter(Boolean),
  importAsset: (file) => ipcRenderer.invoke("asset:import", file),
  writeAsset: (path, data) => ipcRenderer.invoke("asset:write", path, data),
  readAsset: (path) => ipcRenderer.invoke("asset:read", path),
  exportDirectory: () => ipcRenderer.invoke("export:directory"),
  exportItems: (directory, items) => ipcRenderer.invoke("export:write", directory, items),
  pickGodotProject: () => ipcRenderer.invoke("godot:pick-project"),
  syncGodot: (directory, project, items) => ipcRenderer.invoke("godot:sync", directory, project, items),
});
