(() => {
const { decodeGB7, encodeGB7, GB7Error } = window.GB7Codec;
const { detectImageFormat, readRasterMetadata } = window.ImageMetadata;
const { rgbToLab, rgbToHex } = window.ColorSpaces;
const { listChannels, applyChannels, isolateChannel } = window.ImageChannels;
const {
  MIN_GAMMA,
  MAX_GAMMA,
  createDefaultSettings,
  calculateHistogram,
  applyLevels,
  gammaToPosition,
  positionToGamma,
} = window.ImageLevels;

const MAX_RASTER_PIXELS = 64_000_000;
const FORMAT_LABELS = { png: "PNG", jpeg: "JPEG", gb7: "GrayBit-7" };
const EXPORT_COPY = {
  png: "PNG сохраняет прозрачность без потерь.",
  jpeg: "JPG не поддерживает прозрачность: прозрачные области станут белыми.",
  gb7: "GB7 хранит 7 бит яркости и, если нужно, 1 бит двоичной маски.",
};

const elements = {
  canvas: document.querySelector("#image-canvas"),
  canvasPlane: document.querySelector("#canvas-plane"),
  viewport: document.querySelector("#canvas-viewport"),
  emptyState: document.querySelector("#empty-state"),
  dropOverlay: document.querySelector("#drop-overlay"),
  fileInput: document.querySelector("#file-input"),
  openButton: document.querySelector("#open-button"),
  emptyOpenButton: document.querySelector("#empty-open-button"),
  currentFile: document.querySelector("#current-file"),
  format: document.querySelector("#property-format"),
  dimensions: document.querySelector("#property-dimensions"),
  depth: document.querySelector("#property-depth"),
  fileSize: document.querySelector("#property-filesize"),
  statusMessage: document.querySelector("#status-message"),
  statusDimensions: document.querySelector("#status-dimensions"),
  statusDepth: document.querySelector("#status-depth"),
  exportFormat: document.querySelector("#export-format"),
  exportHint: document.querySelector("#export-hint"),
  downloadButton: document.querySelector("#download-button"),
  qualityField: document.querySelector("#quality-field"),
  qualityRange: document.querySelector("#jpeg-quality"),
  qualityOutput: document.querySelector("#quality-output"),
  zoomRange: document.querySelector("#zoom-range"),
  zoomValue: document.querySelector("#zoom-value"),
  zoomIn: document.querySelector("#zoom-in"),
  zoomOut: document.querySelector("#zoom-out"),
  fitButton: document.querySelector("#fit-button"),
  actualSizeButton: document.querySelector("#actual-size-button"),
  eyedropperButton: document.querySelector("#eyedropper-button"),
  levelsButton: document.querySelector("#levels-button"),
  channelList: document.querySelector("#channel-list"),
  channelsEmpty: document.querySelector("#channels-empty"),
  resetChannels: document.querySelector("#reset-channels"),
  colorEmpty: document.querySelector("#color-empty"),
  colorReadout: document.querySelector("#color-readout"),
  colorSwatch: document.querySelector("#color-swatch"),
  colorHex: document.querySelector("#color-hex"),
  colorCoordinates: document.querySelector("#color-coordinates"),
  colorRgb: document.querySelector("#color-rgb"),
  colorLab: document.querySelector("#color-lab"),
  levelsDialog: document.querySelector("#levels-dialog"),
  levelsClose: document.querySelector("#levels-close"),
  levelsChannel: document.querySelector("#levels-channel"),
  histogramLog: document.querySelector("#histogram-log"),
  histogramCanvas: document.querySelector("#histogram-canvas"),
  histogramMidLabel: document.querySelector("#histogram-mid-label"),
  histogramMaxLabel: document.querySelector("#histogram-max-label"),
  levelsRangeLabel: document.querySelector("#levels-range-label"),
  blackSlider: document.querySelector("#level-black-slider"),
  gammaSlider: document.querySelector("#level-gamma-slider"),
  whiteSlider: document.querySelector("#level-white-slider"),
  blackValue: document.querySelector("#level-black-value"),
  gammaValue: document.querySelector("#level-gamma-value"),
  whiteValue: document.querySelector("#level-white-value"),
  levelsPreview: document.querySelector("#levels-preview"),
  levelsReset: document.querySelector("#levels-reset"),
  levelsCancel: document.querySelector("#levels-cancel"),
  levelsApply: document.querySelector("#levels-apply"),
  toast: document.querySelector("#toast"),
};

const context = elements.canvas.getContext("2d", { willReadFrequently: true });
const sourceCanvas = document.createElement("canvas");
const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
const state = {
  document: null,
  originalPixels: null,
  previewPixels: null,
  channelModel: null,
  activeChannels: new Set(),
  activeTool: "view",
  levelsSession: null,
  zoom: 1,
  zoomMode: "fit",
  busy: false,
  dragDepth: 0,
  toastTimer: null,
};

function openFilePicker() {
  if (!state.busy) elements.fileInput.click();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
}

function baseName(fileName) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  return withoutExtension || "image";
}

function showToast(message, isError = false) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", isError);
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3600);
}

function setStatus(message, isError = false) {
  elements.statusMessage.lastChild.textContent = ` ${message}`;
  elements.statusMessage.classList.toggle("is-error", isError);
}

function setBusy(isBusy) {
  state.busy = isBusy;
  elements.openButton.disabled = isBusy;
  elements.emptyOpenButton.disabled = isBusy;
  document.querySelectorAll(".sample-button").forEach((button) => {
    button.disabled = isBusy;
  });
  elements.downloadButton.disabled = isBusy || !state.document;
  elements.eyedropperButton.disabled = isBusy || !state.document;
  elements.levelsButton.disabled = isBusy || !state.document;
  if (isBusy) setStatus("Обработка изображения…");
}

async function loadFile(file) {
  if (!file) return;
  const buffer = await file.arrayBuffer();
  await loadImageBuffer(buffer, file.name, file.size);
}

async function loadImageBuffer(buffer, fileName, fileSize = buffer.byteLength) {
  setBusy(true);

  try {
    const bytes = new Uint8Array(buffer);
    const format = detectImageFormat(bytes);

    if (!format) {
      throw new Error("Формат не распознан. Выберите PNG, JPG, JPEG или корректный файл GB7.");
    }

    if (format === "gb7") {
      loadGB7(buffer, fileName, fileSize);
    } else {
      await loadRaster(buffer, fileName, fileSize, format, bytes);
    }

    showToast(`${fileName} открыт`);
  } catch (error) {
    const message = error instanceof GB7Error ? error.message : (error.message || "Не удалось открыть изображение.");
    setStatus("Ошибка загрузки", true);
    showToast(message, true);
  } finally {
    setBusy(false);
    elements.fileInput.value = "";
  }
}

function loadGB7(buffer, fileName, fileSize) {
  const decoded = decodeGB7(buffer);
  setOriginalImage(new ImageData(decoded.rgba, decoded.width, decoded.height));

  commitDocument({
    name: fileName,
    format: "gb7",
    width: decoded.width,
    height: decoded.height,
    depthLabel: decoded.hasMask ? "7 бит + 1 бит маски" : "7 бит",
    shortDepth: decoded.hasMask ? "7 бит + маска" : "7 бит",
    fileSize,
    channelModel: decoded.hasMask ? "gray-alpha" : "gray",
  });
}

async function loadRaster(buffer, fileName, fileSize, format, bytes) {
  const metadata = readRasterMetadata(bytes, format);
  if (metadata.width * metadata.height > MAX_RASTER_PIXELS) {
    throw new Error("Изображение слишком большое для безопасной обработки в браузере.");
  }

  const mimeType = format === "png" ? "image/png" : "image/jpeg";
  const blob = new Blob([buffer], { type: mimeType });
  const source = await decodeBrowserImage(blob);

  elements.canvas.width = source.width;
  elements.canvas.height = source.height;
  context.clearRect(0, 0, source.width, source.height);
  context.drawImage(source.drawable, 0, 0);
  const imageData = context.getImageData(0, 0, source.width, source.height);
  source.release();
  setOriginalImage(imageData);

  commitDocument({
    name: fileName,
    format,
    width: source.width,
    height: source.height,
    depthLabel: metadata.depthLabel,
    shortDepth: `${metadata.bitsPerPixel} бит`,
    fileSize,
    channelModel: resolveRasterChannelModel(format, metadata, imageData.data),
  });
}

async function decodeBrowserImage(blob) {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return {
      drawable: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;

  try {
    await image.decode();
    return {
      drawable: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function hasTransparency(pixels) {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) return true;
  }
  return false;
}

function resolveRasterChannelModel(format, metadata, pixels) {
  if (format === "jpeg") return metadata.channels === 1 ? "gray" : "rgb";
  if (metadata.colorType === 0) return "gray";
  if (metadata.colorType === 4) return "gray-alpha";
  if (metadata.colorType === 6) return "rgba";
  if (metadata.colorType === 3) return hasTransparency(pixels) ? "rgba" : "rgb";
  return "rgb";
}

function setOriginalImage(imageData) {
  state.originalPixels = new Uint8ClampedArray(imageData.data);
  state.previewPixels = null;

  elements.canvas.width = imageData.width;
  elements.canvas.height = imageData.height;
  sourceCanvas.width = imageData.width;
  sourceCanvas.height = imageData.height;
  syncSourceCanvas();
}

function syncSourceCanvas() {
  sourceContext.putImageData(
    new ImageData(state.originalPixels, elements.canvas.width, elements.canvas.height),
    0,
    0,
  );
}

function renderVisibleChannels() {
  if (!state.document || !state.originalPixels) return;
  const sourcePixels = state.previewPixels || state.originalPixels;
  const pixels = applyChannels(sourcePixels, state.channelModel, state.activeChannels);
  context.putImageData(new ImageData(pixels, state.document.width, state.document.height), 0, 0);
}

function drawChannelThumbnail(canvas, channelKey) {
  const previewContext = canvas.getContext("2d", { willReadFrequently: true });
  const scale = Math.min(canvas.width / sourceCanvas.width, canvas.height / sourceCanvas.height);
  const width = Math.max(1, Math.round(sourceCanvas.width * scale));
  const height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const x = Math.floor((canvas.width - width) / 2);
  const y = Math.floor((canvas.height - height) / 2);

  previewContext.clearRect(0, 0, canvas.width, canvas.height);
  previewContext.drawImage(sourceCanvas, x, y, width, height);
  const preview = previewContext.getImageData(0, 0, canvas.width, canvas.height);
  const isolated = isolateChannel(preview.data, channelKey);
  previewContext.putImageData(new ImageData(isolated, canvas.width, canvas.height), 0, 0);
}

function updateChannelButtons() {
  elements.channelList.querySelectorAll(".channel-button").forEach((button) => {
    const isActive = state.activeChannels.has(button.dataset.channel);
    button.setAttribute("aria-pressed", String(isActive));
    button.setAttribute(
      "aria-label",
      `${button.querySelector("strong").textContent} канал, ${isActive ? "включён" : "выключен"}`,
    );
    button.querySelector(".channel-state").textContent = isActive ? "Вкл" : "Выкл";
  });
}

function renderChannelPanel() {
  elements.channelList.replaceChildren();
  const definitions = listChannels(state.channelModel);

  definitions.forEach((channel) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "channel-button";
    button.dataset.channel = channel.key;
    button.setAttribute("aria-pressed", "true");
    button.setAttribute("aria-label", `${channel.label} канал, включён`);

    const preview = document.createElement("canvas");
    preview.className = "channel-preview";
    preview.width = 72;
    preview.height = 44;
    preview.setAttribute("aria-hidden", "true");
    drawChannelThumbnail(preview, channel.key);

    const copy = document.createElement("span");
    copy.className = "channel-copy";
    const name = document.createElement("strong");
    name.textContent = channel.label;
    const code = document.createElement("span");
    code.textContent = `Канал ${channel.shortLabel}`;
    copy.append(name, code);

    const channelState = document.createElement("span");
    channelState.className = "channel-state";
    channelState.textContent = "Вкл";

    button.append(preview, copy, channelState);
    button.addEventListener("click", () => toggleChannel(channel.key));
    elements.channelList.append(button);
  });

  elements.channelsEmpty.hidden = true;
  elements.resetChannels.disabled = false;
}

function toggleChannel(channelKey) {
  if (state.activeChannels.has(channelKey)) state.activeChannels.delete(channelKey);
  else state.activeChannels.add(channelKey);

  updateChannelButtons();
  renderVisibleChannels();

  const activeLabels = listChannels(state.channelModel)
    .filter((channel) => state.activeChannels.has(channel.key))
    .map((channel) => channel.shortLabel);
  setStatus(activeLabels.length ? `Каналы: ${activeLabels.join(" + ")}` : "Все каналы выключены");
}

function resetChannels() {
  state.activeChannels = new Set(listChannels(state.channelModel).map((channel) => channel.key));
  updateChannelButtons();
  renderVisibleChannels();
  setStatus("Все каналы включены");
}

function configureChannels(model) {
  state.channelModel = model;
  state.activeChannels = new Set(listChannels(model).map((channel) => channel.key));
  renderChannelPanel();
  renderVisibleChannels();
}

function resetColorSample() {
  elements.colorReadout.hidden = true;
  elements.colorEmpty.hidden = false;
}

function commitDocument(documentData) {
  state.document = documentData;
  configureChannels(documentData.channelModel);
  resetColorSample();
  elements.emptyState.classList.add("is-hidden");
  elements.canvas.classList.add("is-visible");
  elements.currentFile.textContent = documentData.name;
  elements.currentFile.title = documentData.name;
  elements.format.textContent = FORMAT_LABELS[documentData.format];
  elements.dimensions.textContent = `${documentData.width} × ${documentData.height} px`;
  elements.depth.textContent = documentData.depthLabel;
  elements.fileSize.textContent = formatBytes(documentData.fileSize);
  elements.statusDimensions.textContent = `${documentData.width} × ${documentData.height} px`;
  elements.statusDepth.textContent = `Глубина: ${documentData.shortDepth}`;
  elements.downloadButton.disabled = false;
  elements.eyedropperButton.disabled = false;
  elements.levelsButton.disabled = false;
  elements.zoomRange.disabled = false;
  [elements.zoomIn, elements.zoomOut, elements.fitButton, elements.actualSizeButton].forEach((button) => {
    button.disabled = false;
  });
  setStatus(`${FORMAT_LABELS[documentData.format]} загружен`);

  state.zoomMode = "fit";
  requestAnimationFrame(fitImage);
}

function clampZoom(value) {
  return Math.min(4, Math.max(0.05, value));
}

function setZoom(value, mode = "manual") {
  if (!state.document) return;
  state.zoom = clampZoom(value);
  state.zoomMode = mode;

  const displayWidth = Math.max(1, Math.round(state.document.width * state.zoom));
  const displayHeight = Math.max(1, Math.round(state.document.height * state.zoom));
  elements.canvas.style.width = `${displayWidth}px`;
  elements.canvas.style.height = `${displayHeight}px`;
  elements.canvas.classList.toggle("is-pixelated", state.zoom >= 2);

  const horizontalPadding = 80;
  const verticalPadding = 80;
  elements.canvasPlane.style.width = `${Math.max(elements.viewport.clientWidth, displayWidth + horizontalPadding)}px`;
  elements.canvasPlane.style.height = `${Math.max(elements.viewport.clientHeight, displayHeight + verticalPadding)}px`;

  const roundedPercent = Math.round(state.zoom * 100);
  elements.zoomRange.value = String(roundedPercent);
  elements.zoomValue.textContent = `${roundedPercent}%`;
}

function fitImage() {
  if (!state.document) return;
  const padding = elements.viewport.clientWidth < 600 ? 44 : 92;
  const availableWidth = Math.max(1, elements.viewport.clientWidth - padding);
  const availableHeight = Math.max(1, elements.viewport.clientHeight - padding);
  const scale = Math.min(availableWidth / state.document.width, availableHeight / state.document.height, 1);
  setZoom(scale, "fit");
  elements.viewport.scrollTo({ left: 0, top: 0 });
}

function changeZoom(factor) {
  if (!state.document) return;
  setZoom(state.zoom * factor);
}

function setActiveTool(tool) {
  state.activeTool = tool;
  const isEyedropper = tool === "eyedropper";
  elements.eyedropperButton.setAttribute("aria-pressed", String(isEyedropper));
  elements.canvas.classList.toggle("is-eyedropper", isEyedropper);

  if (isEyedropper) setStatus("Пипетка активна: выберите пиксель");
  else if (state.document) setStatus("Пипетка выключена");
}

function imageCoordinatesFromPointer(event) {
  const rect = elements.canvas.getBoundingClientRect();
  const style = getComputedStyle(elements.canvas);
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
  const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
  const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
  const displayWidth = rect.width - borderLeft - borderRight;
  const displayHeight = rect.height - borderTop - borderBottom;
  const localX = event.clientX - rect.left - borderLeft;
  const localY = event.clientY - rect.top - borderTop;

  if (localX < 0 || localY < 0 || localX >= displayWidth || localY >= displayHeight) return null;

  return {
    x: Math.min(elements.canvas.width - 1, Math.floor((localX / displayWidth) * elements.canvas.width)),
    y: Math.min(elements.canvas.height - 1, Math.floor((localY / displayHeight) * elements.canvas.height)),
  };
}

function samplePixel(event) {
  if (state.activeTool !== "eyedropper" || !state.document || event.button !== 0) return;
  const coordinates = imageCoordinatesFromPointer(event);
  if (!coordinates) return;

  const index = (coordinates.y * state.document.width + coordinates.x) * 4;
  const red = state.originalPixels[index];
  const green = state.originalPixels[index + 1];
  const blue = state.originalPixels[index + 2];
  const lab = rgbToLab(red, green, blue);

  elements.colorSwatch.style.backgroundColor = `rgb(${red} ${green} ${blue})`;
  elements.colorHex.textContent = rgbToHex(red, green, blue);
  elements.colorCoordinates.textContent = `X: ${coordinates.x}, Y: ${coordinates.y}`;
  elements.colorRgb.textContent = `${red}, ${green}, ${blue}`;
  elements.colorLab.textContent = `L*: ${lab.l.toFixed(1)}, a*: ${lab.a.toFixed(1)}, b*: ${lab.b.toFixed(1)}`;
  elements.colorEmpty.hidden = true;
  elements.colorReadout.hidden = false;
  setStatus(`Пиксель ${coordinates.x}, ${coordinates.y}: RGB ${red}, ${green}, ${blue}`);
}

function levelChannelDefinitions() {
  const isGray = state.channelModel === "gray" || state.channelModel === "gray-alpha";
  const definitions = [{ key: "master", label: isGray ? "Master" : "Master (RGB)" }];
  if (isGray) {
    definitions.push({ key: "gray", label: "Серый" });
  } else {
    definitions.push(
      { key: "red", label: "Красный" },
      { key: "green", label: "Зелёный" },
      { key: "blue", label: "Синий" },
    );
  }
  if (state.channelModel === "gray-alpha" || state.channelModel === "rgba") {
    definitions.push({ key: "alpha", label: "Альфа" });
  }
  return definitions;
}

function populateLevelChannels() {
  elements.levelsChannel.replaceChildren();
  levelChannelDefinitions().forEach((channel) => {
    const option = document.createElement("option");
    option.value = channel.key;
    option.textContent = channel.label;
    elements.levelsChannel.append(option);
  });
}

function currentLevelSettings() {
  return state.levelsSession.settings[elements.levelsChannel.value];
}

function syncLevelControls() {
  const settings = currentLevelSettings();
  const maxValue = state.levelsSession.maxValue;
  const gammaPosition = gammaToPosition(settings.gamma, settings.black, settings.white);

  elements.blackSlider.value = String(settings.black);
  elements.gammaSlider.value = String(gammaPosition);
  elements.whiteSlider.value = String(settings.white);
  elements.blackValue.value = String(settings.black);
  elements.gammaValue.value = settings.gamma.toFixed(2);
  elements.whiteValue.value = String(settings.white);
  elements.blackValue.max = String(settings.white - 1);
  elements.whiteValue.min = String(settings.black + 1);
  elements.gammaSlider.setAttribute(
    "aria-valuetext",
    `Гамма ${settings.gamma.toFixed(2)}, уровень ${gammaPosition.toFixed(1)} из ${maxValue}`,
  );
}

function histogramColor(channel) {
  if (channel === "red") return "#ff7474";
  if (channel === "green") return "#72dc96";
  if (channel === "blue") return "#6ea8ff";
  if (channel === "alpha") return "#d7dbe2";
  if (channel === "gray") return "#c8cdd6";
  return "#8fe1ab";
}

function drawHistogram() {
  if (!state.levelsSession) return;
  const histogramContext = elements.histogramCanvas.getContext("2d");
  const { width, height } = elements.histogramCanvas;
  const channel = elements.levelsChannel.value;
  const histogram = calculateHistogram(
    state.levelsSession.basePixels,
    channel,
    state.levelsSession.maxValue,
  );
  const maxCount = Math.max(1, ...histogram);
  const logarithmic = elements.histogramLog.checked;
  const chartTop = 8;
  const chartBottom = height - 7;
  const chartHeight = chartBottom - chartTop;
  const barWidth = width / histogram.length;

  histogramContext.clearRect(0, 0, width, height);
  histogramContext.fillStyle = "#090a0d";
  histogramContext.fillRect(0, 0, width, height);
  histogramContext.strokeStyle = "#1e2229";
  histogramContext.lineWidth = 1;

  for (let row = 1; row < 4; row += 1) {
    const y = chartTop + (chartHeight * row) / 4;
    histogramContext.beginPath();
    histogramContext.moveTo(0, y + 0.5);
    histogramContext.lineTo(width, y + 0.5);
    histogramContext.stroke();
  }

  histogramContext.fillStyle = histogramColor(channel);
  for (let index = 0; index < histogram.length; index += 1) {
    const ratio = logarithmic
      ? Math.log1p(histogram[index]) / Math.log1p(maxCount)
      : histogram[index] / maxCount;
    const barHeight = Math.max(histogram[index] > 0 ? 1 : 0, ratio * chartHeight);
    histogramContext.fillRect(
      index * barWidth,
      chartBottom - barHeight,
      Math.max(1, Math.ceil(barWidth)),
      barHeight,
    );
  }
}

function scheduleLevelsPreview() {
  if (!state.levelsSession || state.levelsSession.frameRequest) return;
  state.levelsSession.frameRequest = requestAnimationFrame(() => {
    state.levelsSession.frameRequest = 0;
    state.previewPixels = elements.levelsPreview.checked
      ? applyLevels(
        state.levelsSession.basePixels,
        state.channelModel,
        state.levelsSession.settings,
        state.levelsSession.maxValue,
      )
      : null;
    renderVisibleChannels();
  });
}

function updateBlackLevel(value) {
  const settings = currentLevelSettings();
  const maxValue = state.levelsSession.maxValue;
  settings.black = Math.min(settings.white - 1, Math.max(0, Math.round(Number(value) || 0)));
  settings.black = Math.min(settings.black, maxValue - 1);
  syncLevelControls();
  scheduleLevelsPreview();
}

function updateWhiteLevel(value) {
  const settings = currentLevelSettings();
  const maxValue = state.levelsSession.maxValue;
  settings.white = Math.max(settings.black + 1, Math.min(maxValue, Math.round(Number(value) || maxValue)));
  syncLevelControls();
  scheduleLevelsPreview();
}

function updateGammaFromPosition(value) {
  const settings = currentLevelSettings();
  const position = Math.min(settings.white, Math.max(settings.black, Number(value)));
  settings.gamma = positionToGamma(position, settings.black, settings.white);
  syncLevelControls();
  scheduleLevelsPreview();
}

function updateGammaValue(value) {
  const settings = currentLevelSettings();
  settings.gamma = Math.min(MAX_GAMMA, Math.max(MIN_GAMMA, Number(value) || 1));
  syncLevelControls();
  scheduleLevelsPreview();
}

function resetLevelSettings() {
  levelChannelDefinitions().forEach((channel) => {
    state.levelsSession.settings[channel.key] = createDefaultSettings(state.levelsSession.maxValue);
  });
  syncLevelControls();
  scheduleLevelsPreview();
  setStatus("Настройки уровней сброшены");
}

function closeLevels({ applyChanges = false } = {}) {
  if (!state.levelsSession) return;
  if (state.levelsSession.frameRequest) cancelAnimationFrame(state.levelsSession.frameRequest);

  if (applyChanges) {
    state.originalPixels = applyLevels(
      state.levelsSession.basePixels,
      state.channelModel,
      state.levelsSession.settings,
      state.levelsSession.maxValue,
    );
    state.previewPixels = null;
    syncSourceCanvas();
    state.levelsSession = null;
    renderChannelPanel();
    updateChannelButtons();
    renderVisibleChannels();
    elements.levelsDialog.close();
    setStatus("Уровни применены");
    showToast("Градационная коррекция применена");
    return;
  }

  state.previewPixels = null;
  state.levelsSession = null;
  renderVisibleChannels();
  elements.levelsDialog.close();
  setStatus("Изменения уровней отменены");
}

function openLevels() {
  if (!state.document || elements.levelsDialog.open) return;
  setActiveTool("view");
  const maxValue = state.document.format === "gb7" ? 127 : 255;
  const settings = {};
  levelChannelDefinitions().forEach((channel) => {
    settings[channel.key] = createDefaultSettings(maxValue);
  });

  state.levelsSession = {
    basePixels: new Uint8ClampedArray(state.originalPixels),
    settings,
    maxValue,
    frameRequest: 0,
  };

  populateLevelChannels();
  [elements.blackSlider, elements.gammaSlider, elements.whiteSlider].forEach((slider) => {
    slider.max = String(maxValue);
  });
  elements.blackValue.max = String(maxValue - 1);
  elements.whiteValue.max = String(maxValue);
  elements.histogramMidLabel.textContent = String(Math.round(maxValue / 2));
  elements.histogramMaxLabel.textContent = String(maxValue);
  elements.levelsRangeLabel.textContent = `0…${maxValue}`;
  elements.histogramLog.checked = false;
  elements.levelsPreview.checked = true;
  elements.levelsChannel.value = "master";
  syncLevelControls();
  drawHistogram();
  elements.levelsDialog.showModal();
  scheduleLevelsPreview();
}

function updateExportControls() {
  const format = elements.exportFormat.value;
  elements.qualityField.classList.toggle("is-hidden", format !== "jpeg");
  elements.exportHint.textContent = EXPORT_COPY[format];
  elements.downloadButton.lastChild.textContent = ` Скачать ${format === "jpeg" ? "JPG" : format.toUpperCase()}`;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Браузер не смог сформировать файл изображения."));
    }, type, quality);
  });
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadCurrentImage() {
  if (!state.document || state.busy) return;
  setBusy(true);

  try {
    const format = elements.exportFormat.value;
    const name = baseName(state.document.name);
    let blob;
    let fileName;

    if (format === "gb7") {
      const imageData = context.getImageData(0, 0, elements.canvas.width, elements.canvas.height);
      const encoded = encodeGB7(imageData);
      blob = new Blob([encoded.bytes], { type: "application/octet-stream" });
      fileName = `${name}.gb7`;
    } else if (format === "jpeg") {
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = elements.canvas.width;
      exportCanvas.height = elements.canvas.height;
      const exportContext = exportCanvas.getContext("2d");
      exportContext.fillStyle = "#ffffff";
      exportContext.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      exportContext.drawImage(elements.canvas, 0, 0);
      const quality = Number(elements.qualityRange.value) / 100;
      blob = await canvasToBlob(exportCanvas, "image/jpeg", quality);
      fileName = `${name}.jpg`;
    } else {
      blob = await canvasToBlob(elements.canvas, "image/png");
      fileName = `${name}.png`;
    }

    triggerDownload(blob, fileName);
    setStatus(`${fileName} сохранён`);
    showToast(`${fileName} скачан`);
  } catch (error) {
    const message = error instanceof GB7Error ? error.message : (error.message || "Не удалось сохранить файл.");
    setStatus("Ошибка сохранения", true);
    showToast(message, true);
  } finally {
    setBusy(false);
  }
}

async function loadSample(fileName) {
  if (window.location.protocol === "file:") {
    setStatus("Выберите файл примера вручную");
    showToast("Для локального запуска откройте пример кнопкой «Открыть».");
    openFilePicker();
    return;
  }

  setBusy(true);
  try {
    const response = await fetch(new URL(fileName, window.location.href));
    if (!response.ok) throw new Error(`Не удалось получить пример: HTTP ${response.status}.`);
    const buffer = await response.arrayBuffer();
    await loadImageBuffer(buffer, fileName, buffer.byteLength);
  } catch (error) {
    setStatus("Ошибка загрузки", true);
    showToast(error.message || "Не удалось загрузить пример.", true);
  } finally {
    setBusy(false);
  }
}

elements.openButton.addEventListener("click", openFilePicker);
elements.emptyOpenButton.addEventListener("click", openFilePicker);
elements.fileInput.addEventListener("change", () => loadFile(elements.fileInput.files[0]));
elements.exportFormat.addEventListener("change", updateExportControls);
elements.downloadButton.addEventListener("click", downloadCurrentImage);
elements.qualityRange.addEventListener("input", () => {
  elements.qualityOutput.value = `${elements.qualityRange.value}%`;
});

elements.zoomRange.addEventListener("input", () => setZoom(Number(elements.zoomRange.value) / 100));
elements.zoomIn.addEventListener("click", () => changeZoom(1.25));
elements.zoomOut.addEventListener("click", () => changeZoom(0.8));
elements.fitButton.addEventListener("click", fitImage);
elements.actualSizeButton.addEventListener("click", () => setZoom(1));
elements.eyedropperButton.addEventListener("click", () => {
  setActiveTool(state.activeTool === "eyedropper" ? "view" : "eyedropper");
});
elements.levelsButton.addEventListener("click", openLevels);
elements.resetChannels.addEventListener("click", resetChannels);
elements.canvas.addEventListener("pointerdown", samplePixel);
elements.levelsChannel.addEventListener("change", () => {
  syncLevelControls();
  drawHistogram();
});
elements.histogramLog.addEventListener("change", drawHistogram);
elements.blackSlider.addEventListener("input", () => updateBlackLevel(elements.blackSlider.value));
elements.whiteSlider.addEventListener("input", () => updateWhiteLevel(elements.whiteSlider.value));
elements.gammaSlider.addEventListener("input", () => updateGammaFromPosition(elements.gammaSlider.value));
elements.blackValue.addEventListener("input", () => updateBlackLevel(elements.blackValue.value));
elements.whiteValue.addEventListener("input", () => updateWhiteLevel(elements.whiteValue.value));
elements.gammaValue.addEventListener("input", () => updateGammaValue(elements.gammaValue.value));
elements.levelsPreview.addEventListener("change", scheduleLevelsPreview);
elements.levelsReset.addEventListener("click", resetLevelSettings);
elements.levelsCancel.addEventListener("click", () => closeLevels());
elements.levelsClose.addEventListener("click", () => closeLevels());
elements.levelsApply.addEventListener("click", () => closeLevels({ applyChanges: true }));
elements.levelsDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeLevels();
});

document.querySelectorAll(".sample-button").forEach((button) => {
  button.addEventListener("click", () => loadSample(button.dataset.sample));
});

elements.viewport.addEventListener("dragenter", (event) => {
  event.preventDefault();
  state.dragDepth += 1;
  elements.dropOverlay.classList.add("is-visible");
});

elements.viewport.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});

elements.viewport.addEventListener("dragleave", (event) => {
  event.preventDefault();
  state.dragDepth = Math.max(0, state.dragDepth - 1);
  if (state.dragDepth === 0) elements.dropOverlay.classList.remove("is-visible");
});

elements.viewport.addEventListener("drop", (event) => {
  event.preventDefault();
  state.dragDepth = 0;
  elements.dropOverlay.classList.remove("is-visible");
  loadFile(event.dataTransfer?.files?.[0]);
});

window.addEventListener("keydown", (event) => {
  const commandKey = event.metaKey || event.ctrlKey;
  if (commandKey && event.key.toLowerCase() === "o") {
    event.preventDefault();
    openFilePicker();
  }
  if (commandKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    downloadCurrentImage();
  }
  if (!commandKey && event.key.toLowerCase() === "i" && state.document) {
    setActiveTool(state.activeTool === "eyedropper" ? "view" : "eyedropper");
  }
  if (!commandKey && event.key.toLowerCase() === "l" && state.document && !elements.levelsDialog.open) {
    openLevels();
  }
  if (event.key === "Escape" && state.activeTool === "eyedropper") setActiveTool("view");
});

const viewportObserver = new ResizeObserver(() => {
  if (state.zoomMode === "fit") fitImage();
  else if (state.document) setZoom(state.zoom);
});
viewportObserver.observe(elements.viewport);

updateExportControls();
[elements.zoomIn, elements.zoomOut, elements.fitButton, elements.actualSizeButton].forEach((button) => {
  button.disabled = true;
});
})();
