import {
  addAnimation, addLayer, cleanId, copyLayerTransform, editLayer, exportPlan, frameOffset, layerBehind, makeAnimation, makeFrame,
  MAX_FRAMES, migrateProject, removeAnimation, removeLayer, renameAnimation, reorderFrame, replaceAnimation, validateProject,
} from "./model.mjs";
import { advancePlayback } from "./playback.mjs";
import { framePlacement, gridFrames, parseAtlas, sourceCanvas } from "./atlas.mjs";
import { sampleTimes } from "./video-sampling.mjs";
import { ProjectHistory } from "./history.mjs";
import { gridLayout, onionFrames, snapCoordinate } from "./canvas-guides.mjs";

const $ = (id) => document.getElementById(id);
const els = {
  projectName: $("projectName"), dirtyMark: $("dirtyMark"),
  saveStatus: $("saveStatus"),
  animationList: $("animationList"), layerList: $("layerList"),
  filmstrip: $("filmstrip"), stage: $("stage"), stageWrap: $("stageWrap"),
  stageGuides: $("stageGuides"),
  inspectorBody: $("inspectorBody"), inspectorEmpty: $("inspectorEmpty"),
  timelineTitle: $("timelineTitle"), timelineMeta: $("timelineMeta"),
  sourceVideo: $("sourceVideo"), captureCanvas: $("captureCanvas"),
};
const state = {
  project: null, file: "", animationId: "", frameIndex: 0, layerId: "",
  tool: "select", zoom: 1, dirty: false, playing: false, editingLayerId: "",
  candidates: [], order: [], video: null, extracting: false, importing: false, previewId: null, previewMode: "video",
  drag: null, images: new Map(), layerClipboard: null,
};
const FRAME_DRAG_TYPE = "application/x-rk-sprite-frame";
let frameDrag = null;
const history = new ProjectHistory();
const ctx = els.stage.getContext("2d");
const heldTransformKeys = new Set();
let playbackLast = 0;
let playbackElapsed = 0;
let toastTimer;
let nameResolve = null;
let confirmResolve = null;

function askName(title, initial = "") {
  return new Promise((resolve) => {
    nameResolve = resolve;
    $("nameDialogTitle").textContent = title;
    $("nameInput").value = initial;
    $("nameDialog").showModal();
    $("nameInput").focus();
    $("nameInput").select();
  });
}

function askConfirm(message) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    $("confirmMessage").textContent = message;
    $("confirmDialog").showModal();
  });
}

function icons() {
  if (!document.querySelector("i[data-lucide]")) return;
  window.lucide?.createIcons();
  document.querySelectorAll("svg[data-lucide]").forEach((icon) => icon.removeAttribute("data-lucide"));
}

function toast(message, isError = false) {
  const node = $("toast");
  node.textContent = message;
  node.style.display = "block";
  node.style.background = isError ? "#703b3d" : "#244d42";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.style.display = "none", 4200);
}

function errorMessage(error) {
  toast(error?.message || String(error), true);
}

function selection() {
  return { animationId: state.animationId, frameIndex: state.frameIndex, layerId: state.layerId };
}

function syncHistory() {
  state.dirty = !!state.project && history.isDirty(state.project);
  els.dirtyMark.textContent = state.dirty ? " *" : "";
  if (state.dirty) els.saveStatus.textContent = "";
  $("undo").disabled = !history.canUndo;
  $("redo").disabled = !history.canRedo;
}

function markDirty() {
  history.record(state.project, selection());
  syncHistory();
}

function restoreHistory(snapshot) {
  if (!snapshot) return;
  state.project = snapshot.project;
  Object.assign(state, snapshot.selection);
  state.playing = false;
  state.drag = null;
  frameDrag = null;
  state.layerClipboard = null;
  syncHistory();
  refresh();
}

function animation() {
  return state.project?.animations.find((entry) => entry.id === state.animationId) || null;
}

function frame() {
  return animation()?.frames[state.frameIndex] || null;
}

function layer() {
  return animation()?.layers.find((entry) => entry.id === state.layerId) || null;
}

function instance(targetLayer = layer(), targetFrame = frame()) {
  if (!targetLayer || !targetFrame) return null;
  return targetLayer.instances[targetFrame.id] || null;
}

function ensureInstance(targetLayer = layer(), targetFrame = frame()) {
  if (!targetLayer || !targetFrame) return null;
  return targetLayer.instances[targetFrame.id] ||= {
    asset: "", x: 0, y: 0, rotation: 0, scale: 1, pivotX: 0.5, pivotY: 0.5,
  };
}

function iconButton(icon, title, action, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = `<i data-lucide="${icon}"></i>`;
  button.disabled = disabled;
  button.addEventListener("click", action);
  return button;
}

async function image(asset) {
  if (!asset) return null;
  if (!state.images.has(asset)) {
    state.images.set(asset, window.rk.readAsset(asset).then((data) => new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`Cannot load ${asset}`));
      element.src = data;
    })));
  }
  return state.images.get(asset);
}

function forgetImage(asset) {
  state.images.delete(asset);
}

function currentFrameImage(targetFrame = frame()) {
  return targetFrame?.asset ? image(targetFrame.asset) : Promise.resolve(null);
}

function addImageToCanvas(context, bitmap, width, height, offset = { x: 0, y: 0 }) {
  context.drawImage(bitmap, Math.floor((width - bitmap.width) / 2) + offset.x, height - bitmap.height + offset.y);
}

function gridSnapEnabled() {
  return $("showPixelGrid").checked && $("snapGrid").checked;
}

function snapPosition(value, base = 0) {
  return gridSnapEnabled() ? snapCoordinate(value, Number($("gridStep").value) || 8, base) : Math.round(value * 100) / 100;
}

function updateStageGuides() {
  const grid = gridLayout($("gridStep").value, state.zoom);
  els.stageGuides.style.setProperty("--pixel-size", `${grid.spacing}px`);
  els.stageGuides.style.setProperty("--grid-x", `${els.stageWrap.clientWidth / 2}px`);
  els.stageGuides.style.setProperty("--grid-y", `${els.stageWrap.clientHeight / 2}px`);
  els.stageGuides.classList.toggle("show-axes", !!state.project && $("showAxes").checked);
  els.stageGuides.classList.toggle("show-grid", !!state.project && $("showPixelGrid").checked);
  $("gridStep").title = `每格 ${grid.step} 画布像素；当前显示每 ${grid.displayStep} 像素的网格线`;
  const body = frameOffset(frame());
  const selected = layer();
  const anchor = state.tool !== "align" && selected ? instance() : null;
  const x = body.x + (anchor?.x || 0);
  const y = body.y + (anchor ? anchor.y || 0 : (state.project?.canvas.height || 0) / 2);
  els.stageGuides.style.setProperty("--snap-x", `${x * state.zoom}px`);
  els.stageGuides.style.setProperty("--snap-y", `${y * state.zoom}px`);
  els.stageGuides.classList.toggle("show-snap", !!state.drag && gridSnapEnabled());
}

function drawLayer(context, bitmap, item, width, height, offset) {
  context.save();
  context.translate(offset.x, offset.y);
  if (item.kind === "paint") {
    addImageToCanvas(context, bitmap, width, height);
  } else {
    const itemState = item.data;
    context.translate(width / 2 + Number(itemState.x || 0), height / 2 + Number(itemState.y || 0));
    context.rotate(Number(itemState.rotation || 0) * Math.PI / 180);
    context.scale(Number(itemState.scale || 1), Number(itemState.scale || 1));
    context.drawImage(bitmap, -bitmap.width * Number(itemState.pivotX ?? 0.5), -bitmap.height * Number(itemState.pivotY ?? 0.5));
  }
  context.restore();
}

async function renderComposition(context, width, height, selectedAnimation = animation(), selectedFrame = frame(), onlyLayer = null, onion = false) {
  context.clearRect(0, 0, width, height);
  if (!selectedAnimation || !selectedFrame) return;
  const offset = frameOffset(selectedFrame);
  async function drawItems(behind) {
    for (const item of selectedAnimation.layers) {
      if (onlyLayer && item.id !== onlyLayer.id) continue;
      if (!onlyLayer && !item.visible) continue;
      if (!onlyLayer && layerBehind(item, selectedFrame) !== behind) continue;
      const itemState = item.instances[selectedFrame.id];
      if (!itemState?.asset) continue;
      const bitmap = await image(itemState.asset);
      drawLayer(context, bitmap, { kind: item.kind, data: itemState }, width, height, offset);
    }
  }
  if (!onlyLayer) await drawItems(true);
  if (!onlyLayer || onlyLayer.id === "body") {
    const base = await currentFrameImage(selectedFrame);
    if (base) addImageToCanvas(context, base, width, height, offset);
  }
  await drawItems(false);
  if (onion && !onlyLayer) {
    for (const neighbor of onionFrames(selectedAnimation.frames, selectedFrame)) {
      context.save();
      context.globalAlpha = 0.22;
      const bitmap = await currentFrameImage(neighbor);
      if (bitmap) addImageToCanvas(context, bitmap, width, height, frameOffset(neighbor));
      context.restore();
    }
  }
}

let renderSerial = 0;
async function draw() {
  const serial = ++renderSerial;
  if (!state.project) {
    els.stage.width = 1;
    els.stage.height = 1;
    return;
  }
  const { width, height } = state.project.canvas;
  const render = document.createElement("canvas");
  render.width = width;
  render.height = height;
  try {
    await renderComposition(render.getContext("2d"), width, height, animation(), frame(), null, $("onionSkin").checked);
    if (serial !== renderSerial) return;
    if (els.stage.width !== width) els.stage.width = width;
    if (els.stage.height !== height) els.stage.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(render, 0, 0);
    const selected = layer();
    const current = instance();
    if (selected && current?.asset && selected.kind === "preview") {
      const bitmap = await image(current.asset);
      if (serial !== renderSerial) return;
      ctx.save();
      const offset = frameOffset(frame());
      ctx.translate(width / 2 + offset.x + current.x, height / 2 + offset.y + current.y);
      ctx.rotate(current.rotation * Math.PI / 180);
      ctx.scale(current.scale, current.scale);
      ctx.strokeStyle = "#52e3bf";
      ctx.lineWidth = 1 / current.scale;
      ctx.strokeRect(-bitmap.width * current.pivotX, -bitmap.height * current.pivotY, bitmap.width, bitmap.height);
      ctx.beginPath();
      ctx.moveTo(-7 / current.scale, 0);
      ctx.lineTo(7 / current.scale, 0);
      ctx.moveTo(0, -7 / current.scale);
      ctx.lineTo(0, 7 / current.scale);
      ctx.stroke();
      ctx.restore();
    }
  } catch (error) {
    errorMessage(error);
  }
}

function refreshList() {
  els.animationList.replaceChildren();
  els.layerList.replaceChildren();
  if (!state.project) return;
  for (const item of state.project.animations) {
    const row = document.createElement("div");
    row.className = "animation-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `list-item${state.animationId === item.id ? " selected" : ""}`;
    button.innerHTML = '<span class="item-icon"><i data-lucide="clapperboard"></i></span><span class="item-name"></span><span class="item-count"></span>';
    button.querySelector(".item-name").textContent = item.name;
    button.querySelector(".item-count").textContent = `${item.frames.length}`;
    button.addEventListener("click", () => {
      state.animationId = item.id;
      state.frameIndex = 0;
      state.layerId = item.layers[0]?.id || "";
      state.playing = false;
      refresh();
    });
    const actions = document.createElement("div");
    actions.className = "item-actions";
    actions.append(
      iconButton("pencil", `编辑动作 ${item.name}`, () => editAnimationName(item).catch(errorMessage)),
      iconButton("trash-2", `删除动作 ${item.name}`, () => deleteAnimation(item).catch(errorMessage)),
    );
    row.append(button, actions);
    els.animationList.append(row);
  }
  for (const item of animation()?.layers || []) {
    const row = document.createElement("div");
    row.className = "layer-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `list-item${state.layerId === item.id ? " selected" : ""}`;
    button.innerHTML = `<span class="item-icon"><i data-lucide="${item.kind === "preview" ? "scan-eye" : item.kind === "paint" ? "paintbrush" : "shirt"}"></i></span><span class="item-name"></span>`;
    button.querySelector(".item-name").textContent = item.name;
    button.title = item.kind === "preview" ? "仅用于预览，不会导出" : item.slot || "独立导出";
    button.addEventListener("click", () => {
      state.layerId = item.id;
      refresh();
    });
    const visibility = iconButton(item.visible ? "eye" : "eye-off", item.visible ? "隐藏" : "显示", () => {
      item.visible = !item.visible;
      markDirty();
      refresh();
    });
    visibility.className = "visibility";
    const actions = document.createElement("div");
    actions.className = "item-actions";
    actions.append(
      iconButton("arrow-up", `上移图层 ${item.name}`, () => moveLayer(item, -1), animation().layers.indexOf(item) === 0),
      iconButton("arrow-down", `下移图层 ${item.name}`, () => moveLayer(item, 1), animation().layers.indexOf(item) === animation().layers.length - 1),
      iconButton("pencil", `编辑图层 ${item.name}`, () => openLayerEditor(item)),
      iconButton("trash-2", `删除图层 ${item.name}`, () => deleteLayer(item).catch(errorMessage)),
    );
    row.append(visibility, button, actions);
    els.layerList.append(row);
  }
  icons();
}

function moveLayer(item, direction) {
  const layers = animation()?.layers;
  if (!layers) return;
  const index = layers.indexOf(item);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= layers.length) return;
  [layers[index], layers[next]] = [layers[next], layers[index]];
  markDirty();
  refresh();
}

async function editAnimationName(item) {
  const name = await askName("编辑动作", item.name);
  if (!name || (name === item.name && cleanId(name) === item.id)) return;
  const wasSelected = state.animationId === item.id;
  const renamed = renameAnimation(state.project, item.id, name);
  if (wasSelected) state.animationId = renamed.id;
  markDirty();
  refresh();
}

async function deleteAnimation(item) {
  if (!await askConfirm(`删除动作「${item.name}」及其逐帧图层绑定？本地素材文件不会删除。`)) return;
  removeAnimation(state.project, item.id);
  if (state.animationId === item.id) state.animationId = state.project.animations[0]?.id || "";
  state.layerId = animation()?.layers[0]?.id || "";
  state.frameIndex = 0;
  state.playing = false;
  markDirty();
  refresh();
}

function openLayerEditor(item = null) {
  state.editingLayerId = item?.id || "";
  $("layerDialogTitle").textContent = item ? "编辑图层" : "添加图层";
  $("layerSubmit").textContent = item ? "保存" : "添加";
  $("newLayerName").value = item?.name || "";
  $("newLayerKind").value = item?.kind || "equipment";
  $("newLayerSlot").value = item?.slot || "";
  $("newSlotRow").hidden = $("newLayerKind").value !== "equipment";
  $("layerDialog").showModal();
}

async function deleteLayer(item) {
  if (!await askConfirm(`删除图层「${item.name}」及其所有帧绑定？本地素材文件不会删除。`)) return;
  removeLayer(animation(), item.id);
  if (state.layerId === item.id) state.layerId = animation().layers[0]?.id || "";
  markDirty();
  refresh();
}

function clearFrameDropIndicators() {
  els.filmstrip.querySelectorAll(".frame-drop-before, .frame-drop-after, .frame-dragging")
    .forEach((card) => card.classList.remove("frame-drop-before", "frame-drop-after", "frame-dragging"));
  els.filmstrip.querySelectorAll(".frame-insertion-gap.active").forEach((gap) => gap.classList.remove("active"));
}

function isFrameDrag(event) {
  return frameDrag && Array.from(event.dataTransfer?.types || []).includes(FRAME_DRAG_TYPE);
}

function frameInsertionIndex(clientX) {
  for (const [index, card] of [...els.filmstrip.querySelectorAll(".frame-card")].entries()) {
    const rect = card.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) return index;
  }
  return animation()?.frames.length ?? 0;
}

function previewFrameDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = "move";
  clearFrameDropIndicators();
  const cards = [...els.filmstrip.querySelectorAll(".frame-card")];
  const insertion = frameInsertionIndex(event.clientX);
  const card = cards[Math.min(insertion, cards.length - 1)];
  card?.classList.add(insertion === cards.length ? "frame-drop-after" : "frame-drop-before");
}

function finishFrameDrop(event, insertionIndex = frameInsertionIndex(event.clientX)) {
  const drag = frameDrag;
  if (!drag || drag.animationId !== animation()?.id) return;
  const next = reorderFrame(animation(), drag.frameId, insertionIndex);
  frameDrag = null;
  clearFrameDropIndicators();
  if (next === null) return;
  state.playing = false;
  state.frameIndex = next;
  markDirty();
  refresh();
}

async function refreshFilmstrip() {
  const target = animation();
  els.filmstrip.replaceChildren();
  els.timelineTitle.textContent = target?.name || "时间轴";
  els.timelineMeta.textContent = target ? `${target.frames.length} 帧` : "";
  if (!target) return;
  const gaps = Array.from({ length: target.frames.length + 1 }, (_, insertionIndex) => {
    const gap = document.createElement("div");
    gap.className = "frame-insertion-gap";
    gap.dataset.insertionIndex = String(insertionIndex);
    gap.addEventListener("dragover", (event) => {
      if (!isFrameDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      clearFrameDropIndicators();
      gap.classList.add("active");
    });
    gap.addEventListener("dragleave", (event) => {
      if (!gap.contains(event.relatedTarget)) gap.classList.remove("active");
    });
    gap.addEventListener("drop", (event) => {
      if (!isFrameDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      gap.classList.remove("active");
      finishFrameDrop(event, insertionIndex);
    });
    return gap;
  });
  const cards = target.frames.map((item, index) => {
    const card = document.createElement("div");
    card.className = `frame-card${state.frameIndex === index ? " selected" : ""}${item.disabled ? " disabled-frame" : ""}`;
    card.title = `第 ${index + 1} 帧 · ${item.durationMs} ms`;
    card.dataset.frameId = item.id;
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "frame-drag-handle";
    handle.draggable = target.frames.length > 1;
    handle.title = `拖动第 ${index + 1} 帧调整顺序`;
    handle.setAttribute("aria-label", handle.title);
    handle.innerHTML = '<i data-lucide="grip-horizontal"></i>';
    const startFrameDrag = (event) => {
      if (target.frames.length < 2) {
        event.preventDefault();
        return;
      }
      frameDrag = { animationId: target.id, frameId: item.id };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(FRAME_DRAG_TYPE, item.id);
      card.classList.add("frame-dragging");
    };
    const endFrameDrag = () => {
      frameDrag = null;
      clearFrameDropIndicators();
    };
    handle.addEventListener("dragstart", startFrameDrag);
    handle.addEventListener("dragend", endFrameDrag);
    const cardHeader = document.createElement("div");
    cardHeader.className = "frame-card-header";
    cardHeader.append(handle);
    const disableButton = iconButton(item.disabled ? "eye-off" : "eye", item.disabled ? `启用第 ${index + 1} 帧` : `禁用第 ${index + 1} 帧`, () => {
      item.disabled = !item.disabled;
      state.frameIndex = index;
      state.playing = false;
      markDirty();
      refresh();
    });
    disableButton.className = "frame-disable";
    cardHeader.append(disableButton);
    card.append(cardHeader);
    const main = document.createElement("button");
    main.type = "button";
    main.className = "frame-main";
    main.draggable = target.frames.length > 1;
    main.addEventListener("dragstart", startFrameDrag);
    main.addEventListener("dragend", endFrameDrag);
    const thumbnail = document.createElement("img");
    thumbnail.alt = `第 ${index + 1} 帧`;
    thumbnail.draggable = false;
    const text = document.createElement("span");
    text.textContent = `${String(index + 1).padStart(2, "0")}  ·  ${item.durationMs} ms`;
    main.append(thumbnail, text);
    main.addEventListener("click", () => {
      state.frameIndex = index;
      state.playing = false;
      refresh();
    });
    card.append(main);
    const layers = document.createElement("div");
    layers.className = "frame-layers";
    const bodyButton = document.createElement("button");
    bodyButton.type = "button";
    bodyButton.className = "frame-layer frame-body";
    bodyButton.title = `主图 · 第 ${index + 1} 帧`;
    const bodyImage = document.createElement("img");
    bodyImage.alt = "";
    image(item.asset).then((bitmap) => {
      if (bodyButton.isConnected) bodyImage.src = bitmap.src;
    }).catch(errorMessage);
    const bodyName = document.createElement("span");
    bodyName.textContent = "主图";
    bodyButton.append(bodyImage, bodyName);
    bodyButton.addEventListener("click", () => {
      state.frameIndex = index;
      state.layerId = "";
      state.playing = false;
      refresh();
    });
    const layerButtons = new Map();
    for (const entry of target.layers) {
      const layerButton = document.createElement("button");
      layerButton.type = "button";
      layerButton.className = `frame-layer${entry.id === state.layerId && index === state.frameIndex ? " selected-layer" : ""}`;
      layerButton.title = `${entry.name} · 第 ${index + 1} 帧`;
      const layerImage = document.createElement("img");
      layerImage.alt = "";
      const layerName = document.createElement("span");
      layerName.textContent = entry.name;
      const layerState = entry.instances[item.id];
      layerButton.classList.toggle("empty", !layerState?.asset);
      if (layerState?.asset) image(layerState.asset).then((bitmap) => {
        if (layerButton.isConnected) layerImage.src = bitmap.src;
      }).catch(errorMessage);
      layerButton.append(layerImage, layerName);
      layerButton.addEventListener("click", () => {
        state.frameIndex = index;
        state.layerId = entry.id;
        state.playing = false;
        refresh();
      });
      layerButtons.set(entry.id, layerButton);
    }
    for (const entry of target.layers.filter((entry) => layerBehind(entry, item))) layers.append(layerButtons.get(entry.id));
    layers.append(bodyButton);
    for (const entry of target.layers.filter((entry) => !layerBehind(entry, item))) layers.append(layerButtons.get(entry.id));
    card.append(layers);
    card.addEventListener("dragover", (event) => {
      if (isFrameDrag(event)) {
        previewFrameDrop(event);
        return;
      }
      if (![...event.dataTransfer.items].some((entry) => entry.kind === "file")) return;
      event.preventDefault();
      card.classList.add("image-drag-over");
    });
    card.addEventListener("dragleave", (event) => {
      if (card.contains(event.relatedTarget)) return;
      card.classList.remove("image-drag-over", "frame-drop-before", "frame-drop-after");
    });
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isFrameDrag(event)) {
        finishFrameDrop(event);
        return;
      }
      card.classList.remove("image-drag-over");
      const layerButton = event.target.closest(".frame-layer:not(.frame-body)");
      const files = [...event.dataTransfer.files];
      if (layerButton && files.length === 1 && /\.png$/i.test(files[0].name)) {
        state.layerId = [...layerButtons].find(([, button]) => button === layerButton)?.[0] || state.layerId;
        if (layer()?.kind !== "paint") {
          bindDroppedImage(files[0], item, index).catch(errorMessage);
          return;
        }
      }
      importDroppedFiles(files).catch(errorMessage);
    });
    const preview = document.createElement("canvas");
    preview.width = 96;
    preview.height = 88;
    const context = preview.getContext("2d");
    const { width, height } = state.project.canvas;
    const scale = Math.min(preview.width / width, preview.height / height);
    context.setTransform(scale, 0, 0, scale, (preview.width - width * scale) / 2, (preview.height - height * scale) / 2);
    renderComposition(context, width, height, target, item).then(() => {
      if (card.isConnected) thumbnail.src = preview.toDataURL("image/png");
    }).catch(errorMessage);
    return card;
  });
  for (const [index, card] of cards.entries()) els.filmstrip.append(gaps[index], card);
  els.filmstrip.append(gaps[cards.length]);
  icons();
}

async function bindDroppedImage(file, targetFrame, index) {
  const selected = layer();
  if (!selected || selected.kind === "paint" || !file || !/\.png$/i.test(file.name)) {
    throw new Error("先选择装备或预览图层，再把 PNG 拖到目标帧。");
  }
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const asset = `assets/layers/${selected.id}/${targetFrame.id}_${crypto.randomUUID()}.png`;
  await window.rk.writeAsset(asset, data);
  ensureInstance(selected, targetFrame).asset = asset;
  state.frameIndex = index;
  state.playing = false;
  markDirty();
  refresh();
  toast(`${selected.name} 已绑定到第 ${index + 1} 帧`);
}

async function importDroppedFiles(files) {
  const paths = window.rk.droppedPaths(files);
  if (!paths.length || paths.length !== files.length) throw new Error("无法读取拖入文件的位置。");
  const extensions = paths.map((file) => file.split(".").pop().toLowerCase());
  if (paths.length === 1 && extensions[0] === "rksprite") {
    await openProject(paths[0]);
    return;
  }
  if (paths.length === 1 && ["mp4", "webm", "mov", "m4v", "ogv"].includes(extensions[0])) {
    if (!state.project) return toast("请先新建或打开工程", true);
    if (!$("videoDialog").open) $("videoDialog").showModal();
    await selectVideo(paths[0]);
    return;
  }
  if (extensions.every((extension) => extension === "png" || extension === "json")) {
    if (!state.project) return toast("请先新建或打开工程", true);
    await importPngFrames(paths);
    return;
  }
  throw new Error("可拖入 RK sprite 工程、视频，或 PNG/JSON 序列素材。");
}

async function importLayerSequence(paths = null) {
  const selected = layer();
  const target = animation();
  if (!selected || selected.kind === "paint" || !target?.frames.length) {
    throw new Error("先选择有动画帧的装备或预览图层。");
  }
  const choice = await window.rk.pickSprites(paths);
  if (!choice) return;
  const source = await loadSpriteSource(choice);
  if (!source) return;
  const count = source.kind === "atlas" ? source.frames.length : source.entries.length;
  if (count !== target.frames.length) {
    throw new Error(`动作有 ${target.frames.length} 帧，素材有 ${count} 帧，请选择帧数一致的素材。`);
  }
  if (source.kind === "atlas") {
    for (const entry of source.frames) framePlacement(entry, state.project.canvas);
  }
  const assets = await writeSpriteFrames(source, state.project.canvas, `assets/layers/${selected.id}/${target.id}`);
  for (const [index, keyframe] of target.frames.entries()) {
    ensureInstance(selected, keyframe).asset = assets[index].asset;
  }
  markDirty();
  refresh();
  toast(`${selected.name} 已对应 ${count} 帧${source.kind === "atlas" ? " Atlas" : ""}`);
}

function refreshInspector() {
  const selected = layer();
  const selectedFrame = frame();
  els.inspectorEmpty.hidden = !!selected && !!selectedFrame;
  els.inspectorBody.hidden = !selected || !selectedFrame;
  if (!selected || !selectedFrame) return;
  $("inspectorName").textContent = `${selected.name} · 第 ${state.frameIndex + 1} 帧`;
  $("layerSlot").value = selected.slot || "";
  $("layerSlot").disabled = selected.kind !== "equipment";
  $("layerBehind").checked = layerBehind(selected, selectedFrame);
  const current = instance();
  $("positionX").value = current?.x ?? 0;
  $("positionY").value = current?.y ?? 0;
  $("rotation").value = current?.rotation ?? 0;
  $("scale").value = current?.scale ?? 1;
  $("pivotX").value = Math.round((current?.pivotX ?? 0.5) * 10000) / 100;
  $("pivotY").value = Math.round((current?.pivotY ?? 0.5) * 10000) / 100;
  for (const id of ["positionX", "positionY", "rotation", "scale", "pivotX", "pivotY"]) $(id).disabled = selected.kind === "paint";
  $("copyLayerFrame").disabled = !current?.asset;
  $("loadLayerImage").disabled = selected.kind === "paint";
  $("loadLayerStatic").disabled = selected.kind === "paint";
  $("loadLayerSequence").disabled = selected.kind === "paint";
  $("copyLayerFrame").disabled = selected.kind === "paint" || !current?.asset;
  $("copyFrameLayer").disabled = selected.kind === "paint" || !current?.asset;
  $("pasteFrameLayer").disabled = selected.kind === "paint" || state.layerClipboard?.animationId !== animation()?.id;
  $("clearFrameLayer").disabled = selected.kind === "paint" || !current?.asset;
  $("layerBehind").disabled = selected.kind === "paint";
}

function refresh() {
  if (state.project) {
    els.projectName.textContent = state.project.name;
    $("canvasWidth").value = state.project.canvas.width;
    $("canvasHeight").value = state.project.canvas.height;
    $("fps").value = animation()?.fps || state.project.fps;
    $("playbackSpeed").value = animation()?.playbackSpeed ?? 1;
    $("playbackSpeed").disabled = !animation();
    $("frameDuration").value = frame()?.durationMs || Math.round(1000 / Number($("fps").value || 12));
    $("frameDuration").disabled = !frame();
    $("duplicateFrame").disabled = !frame();
    $("moveFrameLeft").disabled = !frame() || state.frameIndex === 0;
    $("moveFrameRight").disabled = !frame() || state.frameIndex === animation().frames.length - 1;
    $("removeFrame").disabled = !frame();
    $("play").disabled = !animation()?.frames.some((entry) => !entry.disabled);
  }
  const selectedFrame = frame();
  $("frameAlignment").hidden = !selectedFrame;
  if (selectedFrame) {
    $("frameAlignTitle").textContent = `${animation().name} · 第 ${state.frameIndex + 1} 帧`;
    $("bodyOffsetX").value = frameOffset(selectedFrame).x;
    $("bodyOffsetY").value = frameOffset(selectedFrame).y;
    $("frameDisabled").checked = selectedFrame.disabled === true;
  }
  refreshList();
  refreshFilmstrip();
  refreshInspector();
  $("zoomText").textContent = `${Math.round(state.zoom * 100)}%`;
  els.stage.style.width = `${(state.project?.canvas.width || 1) * state.zoom}px`;
  els.stage.style.height = `${(state.project?.canvas.height || 1) * state.zoom}px`;
  updateStageGuides();
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.tool === state.tool);
  });
  $("play").innerHTML = `<i data-lucide="${state.playing ? "pause" : "play"}"></i>`;
  icons();
  draw();
}

function showProject(result) {
  if (!result) return;
  migrateProject(result.project);
  state.project = validateProject(result.project);
  state.file = result.file;
  state.animationId = state.project.animations[0]?.id || "";
  state.frameIndex = 0;
  state.layerId = animation()?.layers[0]?.id || "";
  state.images.clear();
  state.layerClipboard = null;
  history.reset(state.project, selection());
  els.saveStatus.textContent = "";
  syncHistory();
  $("welcome").close();
  refresh();
  fitCanvas();
}

async function save() {
  if (!state.project) return;
  validateProject(state.project);
  const project = structuredClone(state.project);
  await window.rk.saveProject(project);
  history.markSaved(project);
  syncHistory();
  els.saveStatus.textContent = state.dirty ? "" : "已保存";
  toast(state.dirty ? "已保存，编辑中的新修改仍未保存" : "工程已保存");
}

async function beforeSwitch() {
  if (!state.dirty) return true;
  if (await askConfirm("工程有未保存的改动。先保存再切换？")) {
    try { await save(); return true; } catch (error) { errorMessage(error); return false; }
  }
  return askConfirm("放弃当前未保存的改动并继续？");
}

async function openProject(path = null) {
  if (!await beforeSwitch()) return;
  showProject(await window.rk.openProject(path));
}

async function newProject() {
  if (!await beforeSwitch()) return;
  const name = await askName("新建工程", "New sprite");
  if (!name?.trim()) return;
  showProject(await window.rk.newProject(name.trim()));
}

function fitCanvas() {
  if (!state.project) return;
  const bounds = els.stageWrap.getBoundingClientRect();
  state.zoom = Math.max(0.1, Math.min(4, Math.min((bounds.width - 70) / state.project.canvas.width, (bounds.height - 70) / state.project.canvas.height)));
  refresh();
}

let gridResolve = null;
let gridBitmap = null;

function gridOptions() {
  return {
    cellWidth: Number($("cellWidth").value),
    cellHeight: Number($("cellHeight").value),
    marginX: Number($("marginX").value),
    marginY: Number($("marginY").value),
    gapX: Number($("gapX").value),
    gapY: Number($("gapY").value),
    count: Number($("gridCount").value),
  };
}

function updateGridPreview(bitmap) {
  const canvas = $("gridPreview");
  const scale = Math.min(1, 520 / bitmap.width, 260 / bitmap.height);
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const preview = canvas.getContext("2d");
  preview.clearRect(0, 0, canvas.width, canvas.height);
  preview.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  try {
    const frames = gridFrames(bitmap.width, bitmap.height, gridOptions());
    preview.strokeStyle = "#43c6a6";
    preview.lineWidth = 1;
    for (const { crop } of frames) {
      preview.strokeRect(crop.x * scale + .5, crop.y * scale + .5, crop.w * scale - 1, crop.h * scale - 1);
    }
    $("gridStatus").textContent = `${frames.length} 帧`;
    $("gridStatus").style.color = "";
  } catch (error) {
    $("gridStatus").textContent = error.message;
    $("gridStatus").style.color = "#ffa5a4";
  }
}

function chooseGrid(bitmap) {
  gridBitmap = bitmap;
  $("gridSourceSize").textContent = `图集 ${bitmap.width} × ${bitmap.height} px`;
  const guess = Math.min(bitmap.height, bitmap.width);
  $("cellWidth").value = guess;
  $("cellHeight").value = bitmap.height;
  for (const id of ["marginX", "marginY", "gapX", "gapY", "gridCount"]) $(id).value = 0;
  updateGridPreview(bitmap);
  $("gridDialog").showModal();
  return new Promise((resolve) => { gridResolve = resolve; });
}

function closeGrid(value) {
  const resolve = gridResolve;
  gridResolve = null;
  gridBitmap = null;
  $("gridDialog").close();
  resolve?.(value);
}

async function loadSpriteSource(source) {
  if (source.kind === "frames") {
    if (source.files.length > MAX_FRAMES) throw new Error(`最多导入 ${MAX_FRAMES} 帧。`);
    const entries = [];
    for (const file of naturalFiles(source.files)) {
      const asset = await window.rk.importAsset(file);
      const bitmap = await image(asset);
      entries.push({ asset, size: { width: bitmap.width, height: bitmap.height }, durationMs: null });
    }
    return { kind: "frames", entries, canvas: {
      width: Math.max(...entries.map((entry) => entry.size.width)),
      height: Math.max(...entries.map((entry) => entry.size.height)),
    } };
  }
  const asset = await window.rk.importAsset(source.png);
  const bitmap = await image(asset);
  const frames = source.kind === "atlas"
    ? parseAtlas(source.metadata, bitmap.width, bitmap.height)
    : await chooseGrid(bitmap);
  if (!frames) return null;
  const playbackSpeed = source.metadata?.app === "RK sprite" ? source.metadata.playbackSpeed ?? 1 : 1;
  if (!Number.isFinite(playbackSpeed) || playbackSpeed < 0.1 || playbackSpeed > 8) {
    throw new Error("Atlas 动画速度须为 0.1–8 倍。");
  }
  return { kind: "atlas", bitmap, frames, canvas: sourceCanvas(frames), playbackSpeed };
}

async function writeSpriteFrames(source, targetCanvas, prefix) {
  if (source.kind === "frames") {
    const results = [];
    for (const entry of source.entries) {
      if (entry.size.width > targetCanvas.width || entry.size.height > targetCanvas.height) {
        throw new Error("帧图片超过当前工程画布大小，请先调整画布尺寸。");
      }
      if (entry.size.width === targetCanvas.width && entry.size.height === targetCanvas.height) {
        results.push({ asset: entry.asset, durationMs: entry.durationMs });
        continue;
      }
      const output = document.createElement("canvas");
      output.width = targetCanvas.width;
      output.height = targetCanvas.height;
      addImageToCanvas(output.getContext("2d"), await image(entry.asset), output.width, output.height);
      const asset = `${prefix}/${crypto.randomUUID()}.png`;
      await window.rk.writeAsset(asset, output.toDataURL("image/png"));
      results.push({ asset, durationMs: entry.durationMs });
    }
    return results;
  }
  const frames = [];
  for (const item of source.frames) {
    const placement = framePlacement(item, targetCanvas);
    const output = document.createElement("canvas");
    output.width = targetCanvas.width;
    output.height = targetCanvas.height;
    output.getContext("2d").drawImage(
      source.bitmap, item.crop.x, item.crop.y, item.crop.w, item.crop.h,
      placement.x, placement.y, item.output.w, item.output.h
    );
    const asset = `${prefix}/${crypto.randomUUID()}.png`;
    await window.rk.writeAsset(asset, output.toDataURL("image/png"));
    frames.push({ asset, durationMs: item.durationMs });
  }
  return frames;
}

async function importPngFrames(paths = null) {
  if (!state.project) return;
  const selection = await window.rk.pickSprites(paths);
  if (!selection) return;
  const source = await loadSpriteSource(selection);
  if (!source) return;
  const name = await askName("导入动作", "idle");
  if (!name) return;
  const fps = Math.max(1, Math.min(60, Number($("fps").value) || 12));
  const target = makeAnimation(name, fps);
  target.playbackSpeed = source.playbackSpeed ?? 1;
  const firstAction = state.project.animations.length === 0;
  const canvas = firstAction ? source.canvas : state.project.canvas;
  const assets = await writeSpriteFrames(source, canvas, `assets/animations/${target.id}`);
  target.frames = assets.map(({ asset, durationMs }) => makeFrame(asset, durationMs || Math.round(1000 / fps)));
  const replacing = state.project.animations.some((item) => item.id === target.id);
  replaceAnimation(state.project, target);
  if (firstAction) state.project.canvas = canvas;
  state.animationId = target.id;
  state.frameIndex = 0;
  state.layerId = target.layers[0]?.id || "";
  state.playing = false;
  markDirty();
  refresh();
  fitCanvas();
  toast(`${replacing ? "已覆盖" : "已导入"} ${target.frames.length} 帧${source.kind === "atlas" ? " Atlas" : ""}`);
}

function pointOnStage(event) {
  const rect = els.stage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(els.stage.width, (event.clientX - rect.left) * els.stage.width / rect.width)),
    y: Math.max(0, Math.min(els.stage.height, (event.clientY - rect.top) * els.stage.height / rect.height)),
  };
}

function transformPoint(item, bitmap, point) {
  const offset = frameOffset(frame());
  const cx = state.project.canvas.width / 2 + offset.x + item.x;
  const cy = state.project.canvas.height / 2 + offset.y + item.y;
  const theta = -item.rotation * Math.PI / 180;
  const dx = point.x - cx;
  const dy = point.y - cy;
  return {
    x: (dx * Math.cos(theta) - dy * Math.sin(theta)) / item.scale + bitmap.width * item.pivotX,
    y: (dx * Math.sin(theta) + dy * Math.cos(theta)) / item.scale + bitmap.height * item.pivotY,
  };
}

async function stageDown(event) {
  if (!state.project || !frame()) return;
  if (state.playing) {
    state.playing = false;
    playbackLast = 0;
    playbackElapsed = 0;
    refresh();
  }
  const point = pointOnStage(event);
  if (state.tool === "align" || (state.tool === "select" && !layer())) {
    if (state.tool === "select") {
      const bitmap = await currentFrameImage();
      if (!bitmap) return;
      const offset = frameOffset(frame());
      const left = Math.floor((state.project.canvas.width - bitmap.width) / 2) + offset.x;
      const top = state.project.canvas.height - bitmap.height + offset.y;
      if (point.x < left || point.x >= left + bitmap.width
        || point.y < top || point.y >= top + bitmap.height) return;
    }
    const offset = frameOffset(frame());
    state.drag = { kind: "align", origin: point, x: offset.x, y: offset.y, frameId: frame().id };
    els.stage.setPointerCapture(event.pointerId);
    updateStageGuides();
    return;
  }
  const current = instance();
  const chosen = layer();
  if (!chosen || chosen.kind === "paint" || !current?.asset) return;
  const bitmap = await image(current.asset);
  const local = transformPoint(current, bitmap, point);
  if (local.x < 0 || local.y < 0 || local.x > bitmap.width || local.y > bitmap.height) return;
  if (state.tool === "pivot") {
    const pivotX = gridSnapEnabled() ? Math.round(local.x) : local.x;
    const pivotY = gridSnapEnabled() ? Math.round(local.y) : local.y;
    const nextPivotX = pivotX / bitmap.width;
    const nextPivotY = pivotY / bitmap.height;
    const dx = (nextPivotX - current.pivotX) * bitmap.width * current.scale;
    const dy = (nextPivotY - current.pivotY) * bitmap.height * current.scale;
    const theta = current.rotation * Math.PI / 180;
    current.x += dx * Math.cos(theta) - dy * Math.sin(theta);
    current.y += dx * Math.sin(theta) + dy * Math.cos(theta);
    current.pivotX = nextPivotX;
    current.pivotY = nextPivotY;
    markDirty();
    refresh();
    return;
  }
  state.drag = { origin: point, x: current.x, y: current.y, frameId: frame().id, layerId: chosen.id };
  els.stage.setPointerCapture(event.pointerId);
  updateStageGuides();
}

function stageMove(event) {
  const point = pointOnStage(event);
  if (state.drag) {
    if (state.drag.kind === "align") {
      const activeFrame = animation()?.frames.find((entry) => entry.id === state.drag.frameId);
      if (!activeFrame) return;
      activeFrame.offsetX = snapPosition(state.drag.x + point.x - state.drag.origin.x);
      activeFrame.offsetY = snapPosition(state.drag.y + point.y - state.drag.origin.y, state.project.canvas.height / 2);
      $("bodyOffsetX").value = activeFrame.offsetX;
      $("bodyOffsetY").value = activeFrame.offsetY;
      updateStageGuides();
      draw();
      return;
    }
    const active = animation()?.layers.find((entry) => entry.id === state.drag.layerId)?.instances[state.drag.frameId];
    if (!active) return;
    const owner = animation()?.frames.find((entry) => entry.id === state.drag.frameId);
    const offset = frameOffset(owner);
    active.x = snapPosition(state.drag.x + point.x - state.drag.origin.x, offset.x);
    active.y = snapPosition(state.drag.y + point.y - state.drag.origin.y, offset.y);
    refreshInspector();
    updateStageGuides();
    draw();
  }
}

function stageUp() {
  if (state.drag) {
    state.drag = null;
    markDirty();
    refresh();
  }
}

async function transformLayerWithWheel(event) {
  const mode = heldTransformKeys.has("r") ? "rotation" : heldTransformKeys.has("z") ? "scale" : "";
  if (!mode || !animation() || !frame() || !layer() || layer().kind === "paint") return;
  const current = instance();
  if (!current?.asset) return;
  event.preventDefault();
  const bitmap = await image(current.asset);
  const point = transformPoint(current, bitmap, pointOnStage(event));
  if (point.x < 0 || point.y < 0 || point.x >= bitmap.width || point.y >= bitmap.height) return;
  const direction = Math.sign(event.deltaY);
  if (mode === "rotation") current.rotation = Math.round((Number(current.rotation || 0) - direction * 2) * 10) / 10;
  else current.scale = Math.min(20, Math.max(0.01, Math.round(Number(current.scale || 1) * (direction > 0 ? .96 : 1.04) * 1000) / 1000));
  markDirty();
  refreshInspector();
  refreshFilmstrip();
  draw();
}

function animate(now) {
  if (state.playing && animation()?.frames.some((entry) => !entry.disabled)) {
    if (!playbackLast) playbackLast = now;
    const previousIndex = state.frameIndex;
    const advance = advancePlayback(
      animation().frames, state.frameIndex, playbackElapsed, now - playbackLast, animation().playbackSpeed ?? 1
    );
    playbackLast = now;
    playbackElapsed = advance.elapsedMs;
    state.frameIndex = advance.index;
    if (state.frameIndex !== previousIndex) {
      [...els.filmstrip.querySelectorAll(".frame-card")].forEach((card, index) => card.classList.toggle("selected", index === state.frameIndex));
      refreshInspector();
      draw();
    }
  } else {
    playbackLast = 0;
    playbackElapsed = 0;
  }
  requestAnimationFrame(animate);
}

function videoStatus(message, error = false) {
  $("videoStatus").textContent = message;
  $("videoStatus").style.color = error ? "#ffa5a4" : "";
}

function resetVideo() {
  state.candidates = [];
  state.order = [];
  state.previewId = null;
  expandVideoPreview(false);
  showVideoPreview("video");
  renderCandidates();
}

function loadVideoFile(file) {
  if (state.video) URL.revokeObjectURL(state.video);
  state.video = file.url;
  els.sourceVideo.src = file.url;
  $("videoSourceName").textContent = file.name;
  resetVideo();
  videoStatus("");
}

function waitForVideo(eventName) {
  return new Promise((resolve, reject) => {
    const video = els.sourceVideo;
    const timer = setTimeout(() => {
      video.removeEventListener(eventName, loaded);
      reject(new Error("Video decoding timed out. Try another MP4/WebM encoding."));
    }, 12000);
    function loaded() {
      clearTimeout(timer);
      resolve();
    }
    video.addEventListener(eventName, loaded, { once: true });
  });
}

async function seekVideo(time) {
  const video = els.sourceVideo;
  if (Math.abs(video.currentTime - time) < 0.0001 && video.readyState >= 2) return;
  if (Math.abs(video.currentTime - time) < 0.0001 && video.readyState < 2) {
    await waitForVideo("loadeddata");
    if (video.readyState >= 2) return;
  }
  const ready = waitForVideo("seeked");
  video.currentTime = time;
  await ready;
}

async function selectVideo(path = null) {
  const file = await window.rk.pickVideo(path);
  if (!file) return;
  loadVideoFile(file);
  const metadata = waitForVideo("loadedmetadata");
  els.sourceVideo.load();
  await metadata;
  $("trimStart").value = 0;
  $("trimEnd").value = Math.min(els.sourceVideo.duration, 10).toFixed(2);
  videoStatus(`${els.sourceVideo.videoWidth} × ${els.sourceVideo.videoHeight} · ${els.sourceVideo.duration.toFixed(2)} s`);
}

function sourceTimes() {
  const video = els.sourceVideo;
  return sampleTimes({
    start: Number($("trimStart").value),
    end: Number($("trimEnd").value),
    duration: video.duration,
    mode: $("samplingMode").value,
    fps: Number($("sampleFps").value),
    interval: Number($("sampleInterval").value),
    framesPerInterval: Number($("framesPerInterval").value),
    maxFrames: MAX_FRAMES,
  });
}

function showVideoPreview(mode) {
  state.previewMode = mode;
  const showFrame = mode === "frame" && state.previewId !== null;
  els.sourceVideo.hidden = showFrame;
  $("framePreview").hidden = !showFrame;
  $("previewCaption").hidden = !showFrame;
  $("showSourceVideo").classList.toggle("selected", !showFrame);
  $("showFramePreview").classList.toggle("selected", showFrame);
  $("showFramePreview").disabled = state.previewId === null || state.extracting;
}

function expandVideoPreview(expanded) {
  $("videoDialog").classList.toggle("preview-expanded", expanded);
  const button = $("expandVideoPreview");
  button.title = expanded ? "退出放大预览" : "放大预览";
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", String(expanded));
  button.innerHTML = `<i data-lucide="${expanded ? "minimize-2" : "maximize-2"}"></i>`;
  icons();
}

async function previewCandidate(id) {
  if (state.extracting || state.importing) return;
  const candidate = state.candidates[id];
  if (!candidate) return;
  state.previewId = id;
  const video = els.sourceVideo;
  video.pause();
  await seekVideo(candidate.time);
  if (state.previewId !== id) return;
  const canvas = $("framePreview");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  $("previewCaption").textContent = `第 ${id + 1} 帧 · ${candidate.time.toFixed(2)} 秒 · ${canvas.width} × ${canvas.height}`;
  showVideoPreview("frame");
  renderCandidates();
}

async function extractFrames() {
  if (state.extracting) return;
  state.extracting = true;
  $("extractFrames").disabled = true;
  try {
    const times = sourceTimes();
    const source = els.sourceVideo;
    source.pause();
    showVideoPreview("video");
    const preview = els.captureCanvas;
    const ratio = Math.min(1, 320 / source.videoWidth, 200 / source.videoHeight);
    preview.width = Math.max(1, Math.round(source.videoWidth * ratio));
    preview.height = Math.max(1, Math.round(source.videoHeight * ratio));
    resetVideo();
    for (const [index, time] of times.entries()) {
      await seekVideo(time);
      preview.getContext("2d").drawImage(source, 0, 0, preview.width, preview.height);
      state.candidates.push({
        id: index,
        time,
        thumb: preview.toDataURL("image/jpeg", 0.72),
      });
      if ((index + 1) % 8 === 0 || index === times.length - 1) {
        videoStatus(`已提取 ${index + 1} / ${times.length} 张候选帧`);
        renderCandidates();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
    if ($("samplingMode").value === "interval") state.order = state.candidates.map((item) => item.id);
  } catch (error) {
    videoStatus(error.message, true);
  } finally {
    state.extracting = false;
    $("extractFrames").disabled = false;
    renderCandidates();
  }
}

function renderCandidates() {
  const candidates = $("candidates");
  const selected = $("selectedFrames");
  candidates.replaceChildren();
  selected.replaceChildren();
  $("candidateCount").textContent = state.candidates.length;
  $("selectedCount").textContent = state.order.length;
  $("createSequence").disabled = !state.order.length || state.importing;
  for (const item of state.candidates) {
    const card = document.createElement("div");
    card.className = `candidate${state.order.includes(item.id) ? " selected" : ""}${state.previewId === item.id && state.previewMode === "frame" ? " previewing" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "candidate-preview";
    button.title = `预览第 ${item.id + 1} 帧`;
    button.disabled = state.extracting || state.importing;
    const img = document.createElement("img");
    img.src = item.thumb;
    img.alt = `${item.time.toFixed(2)} 秒`;
    const text = document.createElement("span");
    text.innerHTML = `<small>#${item.id + 1}</small><small>${item.time.toFixed(2)} s</small>`;
    button.append(img, text);
    button.addEventListener("click", () => previewCandidate(item.id).catch((error) => videoStatus(error.message, true)));
    const keep = document.createElement("label");
    keep.className = "candidate-keep";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.order.includes(item.id);
    checkbox.disabled = state.importing;
    checkbox.setAttribute("aria-label", `保留第 ${item.id + 1} 帧`);
    checkbox.addEventListener("change", () => {
      const index = state.order.indexOf(item.id);
      if (checkbox.checked && index < 0) state.order.push(item.id);
      else if (!checkbox.checked && index >= 0) state.order.splice(index, 1);
      renderCandidates();
    });
    keep.append(checkbox, document.createTextNode("保留"));
    card.append(button, keep);
    candidates.append(card);
  }
  state.order.forEach((id, index) => {
    const item = state.candidates[id];
    const row = document.createElement("div");
    row.className = `selected-row${state.previewId === id && state.previewMode === "frame" ? " previewing" : ""}`;
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "selected-preview";
    preview.title = `预览第 ${id + 1} 帧`;
    preview.disabled = state.extracting || state.importing;
    const image = document.createElement("img");
    image.src = item.thumb;
    image.alt = "";
    preview.append(image);
    preview.addEventListener("click", () => previewCandidate(id).catch((error) => videoStatus(error.message, true)));
    const text = document.createElement("span");
    text.textContent = `#${index + 1} · ${item.time.toFixed(2)} s`;
    const up = iconButton("arrow-up", "前移", () => {
      [state.order[index - 1], state.order[index]] = [state.order[index], state.order[index - 1]];
      renderCandidates();
    }, index === 0);
    const down = iconButton("arrow-down", "后移", () => {
      [state.order[index + 1], state.order[index]] = [state.order[index], state.order[index + 1]];
      renderCandidates();
    }, index === state.order.length - 1);
    row.append(preview, text, up, down);
    selected.append(row);
  });
  icons();
}

async function createSequence() {
  if (state.importing || !state.project) return;
  const name = $("newAnimationName").value.trim();
  const fps = Number($("newAnimationFps").value);
  if (state.order.length === 0) return videoStatus("请先选择要保留的帧", true);
  let target;
  try {
    target = makeAnimation(name, fps);
  } catch (error) {
    return videoStatus(error.message, true);
  }
  state.importing = true;
  renderCandidates();
  try {
    const source = els.sourceVideo;
    const width = source.videoWidth;
    const height = source.videoHeight;
    if (width < 1 || height < 1 || width > 8192 || height > 8192) throw new Error("Video frame dimensions are unsupported.");
    const targetCanvas = els.captureCanvas;
    targetCanvas.width = width;
    targetCanvas.height = height;
    const saved = [];
    const uniform = Math.round(1000 / fps);
    for (const [index, id] of state.order.entries()) {
      const candidate = state.candidates[id];
      videoStatus(`写入原尺寸帧 ${index + 1} / ${state.order.length}`);
      await seekVideo(candidate.time);
      targetCanvas.getContext("2d").drawImage(source, 0, 0, width, height);
      const frameId = crypto.randomUUID();
      const asset = `assets/animations/${target.id}/${frameId}.png`;
      await window.rk.writeAsset(asset, targetCanvas.toDataURL("image/png"));
      const next = state.candidates[state.order[index + 1]];
      const gap = next && next.time > candidate.time ? Math.round((next.time - candidate.time) * 1000) : uniform;
      saved.push({ id: frameId, asset, durationMs: $("timingMode").value === "source" ? Math.max(1, Math.min(60000, gap)) : uniform, timeMs: Math.round(candidate.time * 1000) });
    }
    target.frames = saved;
    const firstAnimation = state.project.animations.length === 0;
    const replacing = state.project.animations.some((item) => item.id === target.id);
    replaceAnimation(state.project, target);
    if (firstAnimation) state.project.canvas = { width, height };
    state.animationId = target.id;
    state.frameIndex = 0;
    state.layerId = target.layers[0]?.id || "";
    state.playing = false;
    state.images.clear();
    markDirty();
    $("videoDialog").close();
    refresh();
    fitCanvas();
    toast(`${replacing ? "已覆盖" : "已生成"} ${target.name} · ${saved.length} 帧`);
  } catch (error) {
    videoStatus(error.message, true);
  } finally {
    state.importing = false;
    renderCandidates();
  }
}

function safeName(value) {
  return cleanId(value) || "layer";
}

function naturalFiles(files) {
  return [...files].sort(new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare);
}

async function buildAtlasItems() {
  const columns = 8;
  const plan = exportPlan(state.project, columns);
  const items = [];
  for (const { animation: action, layer: target, sheetWidth, sheetHeight, frames: activeFrames } of plan) {
    const atlas = document.createElement("canvas");
    atlas.width = sheetWidth;
    atlas.height = sheetHeight;
    const context = atlas.getContext("2d");
    const { width, height } = state.project.canvas;
    const frames = [];
    for (const [index, keyframe] of activeFrames.entries()) {
      const tile = document.createElement("canvas");
      tile.width = width;
      tile.height = height;
      await renderComposition(tile.getContext("2d"), width, height, action, keyframe, target);
      const x = (index % columns) * width;
      const y = Math.floor(index / columns) * height;
      context.drawImage(tile, x, y);
      frames.push({
        index, sourceIndex: action.frames.indexOf(keyframe), x, y, w: width, h: height, frameId: keyframe.id,
        durationMs: keyframe.durationMs, sourceTimeMs: keyframe.timeMs,
        behind: target.id !== "body" && layerBehind(target, keyframe),
        present: target.id === "body" || !!target.instances[keyframe.id]?.asset,
        origin: { x: width / 2, y: height },
      });
    }
    items.push({
      name: `${safeName(action.id)}_${safeName(target.id === "body" ? "body" : target.name + "_" + target.id.slice(0, 8))}`,
      image: atlas.toDataURL("image/png"),
      metadata: {
        app: "RK sprite", schemaVersion: 1, animation: action.id, playbackSpeed: action.playbackSpeed ?? 1,
        layer: target.id, name: target.name, kind: target.kind, slot: target.slot || null,
        visible: target.visible !== false, behind: target.behind === true,
        sheet: { width: sheetWidth, height: sheetHeight, columns, image: "" },
        canvas: state.project.canvas, frames,
      },
    });
    items.at(-1).metadata.sheet.image = `${items.at(-1).name}.png`;
  }
  return items;
}

async function exportAtlases() {
  if (!state.project) return;
  const directory = await window.rk.exportDirectory();
  if (!directory) return;
  const items = await buildAtlasItems();
  const folder = await window.rk.exportItems(directory, items);
  toast(`已导出 ${items.length} 组分层图集：${folder}`);
}

async function syncGodotProject() {
  if (!state.project) return toast("请先新建或打开工程", true);
  if (state.dirty) await save();
  const target = await window.rk.pickGodotProject();
  if (!target) return;
  const items = await buildAtlasItems();
  const result = await window.rk.syncGodot(target.directory, state.project, items);
  toast(`已同步到 Godot：${result.scene}`);
}

function bindEvents() {
  els.filmstrip.addEventListener("dragover", (event) => {
    if (isFrameDrag(event)) previewFrameDrop(event);
  });
  els.filmstrip.addEventListener("drop", (event) => {
    if (!isFrameDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    finishFrameDrop(event);
  });
  els.filmstrip.addEventListener("dragleave", (event) => {
    if (!els.filmstrip.contains(event.relatedTarget)) {
      clearFrameDropIndicators();
      els.filmstrip.querySelectorAll(".frame-insertion-gap.active").forEach((gap) => gap.classList.remove("active"));
    }
  });
  window.addEventListener("dragover", (event) => {
    if ([...event.dataTransfer.items].some((item) => item.kind === "file")) event.preventDefault();
  });
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    if (event.target.closest(".frame-card")) return;
    const files = [...event.dataTransfer.files];
    const extensions = files.map((file) => file.name.split(".").pop().toLowerCase());
    if (event.target.closest(".inspector, #layerList")
      && files.length && extensions.every((extension) => extension === "png" || extension === "json")) {
      const paths = window.rk.droppedPaths(files);
      importLayerSequence(paths).catch(errorMessage);
    } else {
      importDroppedFiles(files).catch(errorMessage);
    }
  });
  $("newProject").addEventListener("click", () => newProject().catch(errorMessage));
  $("openProject").addEventListener("click", () => openProject().catch(errorMessage));
  $("welcomeNew").addEventListener("click", () => newProject().catch(errorMessage));
  $("welcomeOpen").addEventListener("click", () => openProject().catch(errorMessage));
  $("saveProject").addEventListener("click", () => save().catch(errorMessage));
  $("undo").addEventListener("click", () => restoreHistory(history.undo()));
  $("redo").addEventListener("click", () => restoreHistory(history.redo()));
  $("pngImport").addEventListener("click", () => importPngFrames().catch(errorMessage));
  $("exportAtlas").addEventListener("click", () => exportAtlases().catch(errorMessage));
  $("syncGodot").addEventListener("click", () => syncGodotProject().catch(errorMessage));
  $("addAnimation").addEventListener("click", () => {
    if (!state.project) return;
    askName("新建动作", "idle").then((name) => {
    if (!name) return;
    try {
      const created = addAnimation(state.project, name, state.project.fps);
      state.animationId = created.id;
      state.frameIndex = 0;
      state.layerId = "";
      markDirty();
      refresh();
    } catch (error) { errorMessage(error); }
    });
  });
  $("addLayer").addEventListener("click", () => {
    if (!animation()) return toast("请先新建或导入一个动作", true);
    openLayerEditor();
  });
  $("newLayerKind").addEventListener("change", () => $("newSlotRow").hidden = $("newLayerKind").value !== "equipment");
  $("cancelLayer").addEventListener("click", () => $("layerDialog").close());
  $("layerDialog").addEventListener("close", () => { state.editingLayerId = ""; });
  $("layerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const created = state.editingLayerId
        ? editLayer(animation(), state.editingLayerId, {
          name: $("newLayerName").value, kind: $("newLayerKind").value, slot: $("newLayerSlot").value,
        })
        : addLayer(animation(), $("newLayerName").value, $("newLayerKind").value, $("newLayerSlot").value);
      state.layerId = created.id;
      $("layerDialog").close();
      markDirty();
      refresh();
    } catch (error) { errorMessage(error); }
  });
  $("videoImport").addEventListener("click", () => {
    if (!state.project) return toast("请先新建或打开工程", true);
    $("videoDialog").showModal();
  });
  $("closeVideo").addEventListener("click", () => $("videoDialog").close());
  $("videoDialog").addEventListener("cancel", (event) => {
    if (state.extracting || state.importing) event.preventDefault();
  });
  $("selectVideo").addEventListener("click", () => selectVideo().catch((error) => videoStatus(error.message, true)));
  $("samplingMode").addEventListener("change", () => {
    const interval = $("samplingMode").value === "interval";
    $("sampleIntervalField").hidden = !interval;
    $("sampleFpsField").hidden = interval;
  });
  $("showSourceVideo").addEventListener("click", () => showVideoPreview("video"));
  $("showFramePreview").addEventListener("click", () => {
    if (state.previewId !== null) showVideoPreview("frame");
  });
  $("expandVideoPreview").addEventListener("click", () => {
    expandVideoPreview(!$("videoDialog").classList.contains("preview-expanded"));
  });
  $("extractFrames").addEventListener("click", extractFrames);
  $("selectAllFrames").addEventListener("click", () => { state.order = state.candidates.map((item) => item.id); renderCandidates(); });
  $("clearFrames").addEventListener("click", () => { state.order = []; renderCandidates(); });
  $("createSequence").addEventListener("click", createSequence);
  document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => {
    state.tool = button.dataset.tool;
    refresh();
  }));
  $("zoomIn").addEventListener("click", () => { state.zoom = Math.min(8, state.zoom * 1.25); refresh(); });
  $("zoomOut").addEventListener("click", () => { state.zoom = Math.max(0.1, state.zoom / 1.25); refresh(); });
  $("fitCanvas").addEventListener("click", fitCanvas);
  $("onionSkin").addEventListener("change", draw);
  $("showAxes").addEventListener("change", updateStageGuides);
  $("showPixelGrid").addEventListener("change", () => {
    updateStageGuides();
  });
  $("snapGrid").addEventListener("change", updateStageGuides);
  $("gridStep").addEventListener("change", () => {
    $("gridStep").value = gridLayout($("gridStep").value, state.zoom).step;
    updateStageGuides();
  });
  for (const [id, key] of [["bodyOffsetX", "offsetX"], ["bodyOffsetY", "offsetY"]]) {
    $(id).addEventListener("change", () => {
      const value = Number($(id).value);
      if (!frame() || !Number.isFinite(value) || Math.abs(value) > 8192) return refresh();
      frame()[key] = snapPosition(value, key === "offsetY" ? state.project.canvas.height / 2 : 0);
      markDirty();
      refresh();
    });
  }
  $("resetAlignment").addEventListener("click", () => {
    if (!frame()) return;
    frame().offsetX = 0;
    frame().offsetY = 0;
    markDirty();
    refresh();
  });
  $("frameDisabled").addEventListener("change", () => {
    if (!frame()) return;
    frame().disabled = $("frameDisabled").checked;
    state.playing = false;
    markDirty();
    refresh();
  });
  $("play").addEventListener("click", () => { state.playing = !state.playing; refresh(); });
  $("playbackSpeed").addEventListener("change", () => {
    const speed = Number($("playbackSpeed").value);
    const target = animation();
    if (!target) return;
    if (!Number.isFinite(speed) || speed < 0.1 || speed > 8) {
      $("playbackSpeed").value = target.playbackSpeed ?? 1;
      return errorMessage(new Error("动画速度须为 0.1–8 倍。"));
    }
    target.playbackSpeed = speed;
    markDirty();
    refresh();
  });
  $("duplicateFrame").addEventListener("click", () => {
    const current = frame();
    if (!current) return;
    if (animation().frames.length >= MAX_FRAMES) return errorMessage(new Error("Maximum frame count reached."));
    const duplicate = { ...current, id: crypto.randomUUID() };
    animation().frames.splice(state.frameIndex + 1, 0, duplicate);
    for (const target of animation().layers) {
      if (target.instances[current.id]) target.instances[duplicate.id] = { ...target.instances[current.id] };
    }
    state.frameIndex++;
    markDirty();
    refresh();
  });
  for (const [id, direction] of [["moveFrameLeft", -1], ["moveFrameRight", 1]]) {
    $(id).addEventListener("click", () => {
      const frames = animation()?.frames;
      if (!frames || !frames[state.frameIndex] || !frames[state.frameIndex + direction]) return;
      const next = state.frameIndex + direction;
      [frames[state.frameIndex], frames[next]] = [frames[next], frames[state.frameIndex]];
      state.frameIndex = next;
      markDirty();
      refresh();
    });
  }
  $("removeFrame").addEventListener("click", async () => {
    const target = animation();
    const current = frame();
    if (!target || !current || !await askConfirm(`从 ${target.name} 中移除第 ${state.frameIndex + 1} 帧？原始素材不会删除。`)) return;
    target.frames.splice(state.frameIndex, 1);
    for (const item of target.layers) delete item.instances[current.id];
    state.frameIndex = Math.min(state.frameIndex, target.frames.length - 1);
    state.frameIndex = Math.max(0, state.frameIndex);
    state.playing = false;
    markDirty();
    refresh();
  });
  $("fps").addEventListener("change", () => {
    const next = Number($("fps").value);
    if (animation() && Number.isInteger(next) && next >= 1 && next <= 60) {
      animation().fps = next;
      markDirty();
      refresh();
    }
  });
  $("frameDuration").addEventListener("change", () => {
    const current = frame();
    const next = Number($("frameDuration").value);
    if (current && Number.isInteger(next) && next >= 1 && next <= 60000) {
      current.durationMs = next;
      markDirty();
      refresh();
    }
  });
  for (const [id, key, multiplier] of [
    ["positionX", "x", 1], ["positionY", "y", 1], ["rotation", "rotation", 1],
    ["scale", "scale", 1], ["pivotX", "pivotX", 0.01], ["pivotY", "pivotY", 0.01],
  ]) {
    $(id).addEventListener("change", () => {
      const value = Number($(id).value) * multiplier;
      if (!Number.isFinite(value) || (key === "scale" && (value < 0.01 || value > 20))
        || ((key === "pivotX" || key === "pivotY") && (value < 0 || value > 1))) return refreshInspector();
      ensureInstance()[key] = (key === "x" || key === "y") ? snapPosition(value, frameOffset(frame())[key]) : value;
      markDirty();
      if (key === "x" || key === "y") refreshInspector();
      refreshFilmstrip();
      draw();
    });
  }
  $("layerSlot").addEventListener("change", () => {
    const selected = layer();
    if (!selected || selected.kind !== "equipment") return;
    selected.slot = $("layerSlot").value.trim() || "outfit";
    markDirty();
  });
  $("layerBehind").addEventListener("change", () => {
    const selected = layer();
    if (!selected || !frame()) return;
    ensureInstance().behind = $("layerBehind").checked;
    markDirty();
    refreshFilmstrip();
    draw();
  });
  $("loadLayerImage").addEventListener("click", async () => {
    try {
      const selected = layer();
      if (!selected || selected.kind === "paint" || !frame()) return;
      const files = await window.rk.pickImages();
      if (!files.length) return;
      if (files.length !== 1) throw new Error("当前帧只能选择一张 PNG；逐帧素材请使用“逐帧序列 / Atlas”。");
      ensureInstance().asset = await window.rk.importAsset(files[0]);
      markDirty();
      refresh();
    } catch (error) { errorMessage(error); }
  });
  $("loadLayerStatic").addEventListener("click", async () => {
    try {
      const selected = layer();
      const target = animation();
      if (!selected || selected.kind === "paint" || !target?.frames.length) return;
      const files = await window.rk.pickImages();
      if (!files.length) return;
      if (files.length !== 1) throw new Error("固定装备只能选择一张 PNG；逐帧素材请使用“逐帧序列 / Atlas”。");
      const asset = await window.rk.importAsset(files[0]);
      for (const keyframe of target.frames) {
        ensureInstance(selected, keyframe).asset = asset;
      }
      markDirty();
      refresh();
      toast(`${selected.name} 已绑定到 ${target.frames.length} 帧`);
    } catch (error) { errorMessage(error); }
  });
  $("loadLayerSequence").addEventListener("click", () => importLayerSequence().catch(errorMessage));
  $("copyLayerFrame").addEventListener("click", async () => {
    const selected = layer();
    const source = instance();
    if (!selected || selected.kind === "paint" || !source?.asset || !animation()) return;
    if (!await askConfirm(`把 ${selected.name} 的当前素材与位置应用到 ${animation().frames.length} 帧？`)) return;
    for (const item of animation().frames) selected.instances[item.id] = { ...source };
    markDirty();
    refresh();
  });
  $("copyLayerTransform").addEventListener("click", () => {
    if (!layer() || !frame()) return;
    const count = copyLayerTransform(animation(), layer(), frame());
    if (!count) return toast("其他帧尚未绑定素材", true);
    markDirty();
    refresh();
    toast(`已将位置、旋转与锚点应用到 ${count} 帧；素材未更改`);
  });
  $("copyFrameLayer").addEventListener("click", () => {
    const source = instance();
    if (!source?.asset || layer()?.kind === "paint") return;
    state.layerClipboard = { animationId: animation().id, value: structuredClone(source) };
    refreshInspector();
    toast("已复制本帧图层");
  });
  $("pasteFrameLayer").addEventListener("click", () => {
    const target = layer();
    const current = frame();
    if (!target || !current || target.kind === "paint" || state.layerClipboard?.animationId !== animation()?.id) return;
    target.instances[current.id] = structuredClone(state.layerClipboard.value);
    markDirty();
    refresh();
  });
  $("clearFrameLayer").addEventListener("click", async () => {
    const target = layer();
    const current = frame();
    if (!target || !current || target.kind === "paint" || !target.instances[current.id]?.asset) return;
    if (!await askConfirm(`移除 ${target.name} 在第 ${state.frameIndex + 1} 帧的素材？其他帧不变。`)) return;
    delete target.instances[current.id];
    markDirty();
    refresh();
  });
  for (const id of ["cellWidth", "cellHeight", "marginX", "marginY", "gapX", "gapY", "gridCount"]) {
    $(id).addEventListener("input", () => {
      if ($("gridDialog").open && gridBitmap) updateGridPreview(gridBitmap);
    });
  }
  $("gridForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!gridBitmap) return;
    try {
      closeGrid(gridFrames(gridBitmap.width, gridBitmap.height, gridOptions()));
    } catch (error) {
      $("gridStatus").textContent = error.message;
      $("gridStatus").style.color = "#ffa5a4";
    }
  });
  $("cancelGrid").addEventListener("click", () => closeGrid(null));
  $("gridDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeGrid(null);
  });
  for (const [id, key] of [["canvasWidth", "width"], ["canvasHeight", "height"]]) {
    $(id).addEventListener("change", () => {
      const value = Number($(id).value);
      if (!Number.isInteger(value) || value < 1 || value > 8192 || !state.project) return refresh();
      state.project.canvas[key] = value;
      markDirty();
      refresh();
      fitCanvas();
    });
  }
  els.stage.addEventListener("pointerdown", (event) => stageDown(event).catch(errorMessage));
  els.stage.addEventListener("pointermove", stageMove);
  els.stage.addEventListener("pointerup", stageUp);
  els.stage.addEventListener("pointercancel", stageUp);
  els.stage.addEventListener("wheel", (event) => transformLayerWithWheel(event).catch(errorMessage), { passive: false });
  window.addEventListener("keydown", (event) => {
    if (!event.target.closest("input, select, textarea") && ["r", "z"].includes(event.key.toLowerCase())) {
      heldTransformKeys.add(event.key.toLowerCase());
    }
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && key === "s") {
      event.preventDefault();
      save().catch(errorMessage);
    }
    if (modifier && (key === "z" || key === "y") && !document.querySelector("dialog[open]")
      && !event.target.closest('input[type="text"], textarea, [contenteditable="true"]')) {
      event.preventDefault();
      if (key === "y" || event.shiftKey) restoreHistory(history.redo());
      else restoreHistory(history.undo());
    }
    if (event.code === "Space" && !event.target.closest("input, select, dialog")) {
      event.preventDefault();
      $("play").click();
    }
  });
  window.addEventListener("keyup", (event) => heldTransformKeys.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => heldTransformKeys.clear());
  $("nameForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const value = $("nameInput").value.trim();
    if (!value) return;
    $("nameDialog").close();
    nameResolve?.(value);
    nameResolve = null;
  });
  $("cancelName").addEventListener("click", () => $("nameDialog").close());
  $("nameDialog").addEventListener("close", () => { nameResolve?.(null); nameResolve = null; });
  $("confirmCancel").addEventListener("click", () => $("confirmDialog").close());
  $("confirmAccept").addEventListener("click", () => {
    $("confirmDialog").close();
    confirmResolve?.(true);
    confirmResolve = null;
  });
  $("confirmDialog").addEventListener("close", () => { confirmResolve?.(false); confirmResolve = null; });
  window.rk.onCloseRequested(() => {
    if (!state.dirty && !state.importing && !state.extracting) {
      window.rk.completeClose().catch(errorMessage);
      return;
    }
    if (!$("closeDialog").open) $("closeDialog").showModal();
  });
  $("cancelClose").addEventListener("click", async () => {
    try {
      await window.rk.cancelClose();
      $("closeDialog").close();
    } catch (error) { errorMessage(error); }
  });
  $("closeDialog").addEventListener("close", () => window.rk.cancelClose().catch(errorMessage));
  $("discardClose").addEventListener("click", () => window.rk.completeClose().catch(errorMessage));
  $("saveAndClose").addEventListener("click", async () => {
    if (state.importing || state.extracting) return errorMessage(new Error("请等待视频操作完成再保存退出。"));
    $("saveAndClose").disabled = true;
    try {
      await save();
      await window.rk.completeClose();
    } catch (error) {
      errorMessage(error);
      $("saveAndClose").disabled = false;
    }
  });
}

bindEvents();
new ResizeObserver(updateStageGuides).observe(els.stageWrap);
icons();
$("welcome").showModal();
requestAnimationFrame(animate);
