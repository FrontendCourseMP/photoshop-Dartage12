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
const {
  METHODS: INTERPOLATION_METHODS,
  resizePixels,
  calculateFitScale,
  scaledDimensions,
} = window.ImageInterpolation;

const MAX_RASTER_PIXELS = 64_000_000;
const MAX_IMAGE_DIMENSION = 16_384;
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
  statusZoom: document.querySelector("#status-zoom"),
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
  resizeButton: document.querySelector("#resize-button"),
  resizePanelButton: document.querySelector("#resize-panel-button"),
  scaleMethod: document.querySelector("#scale-method"),
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
  resizeDialog: document.querySelector("#resize-dialog"),
  resizeForm: document.querySelector("#resize-form"),
  resizeClose: document.querySelector("#resize-close"),
  resizeUnits: document.querySelector("#resize-units"),
  resizeWidth: document.querySelector("#resize-width"),
  resizeHeight: document.querySelector("#resize-height"),
  resizeWidthUnit: document.querySelector("#resize-width-unit"),
  resizeHeightUnit: document.querySelector("#resize-height-unit"),
  resizeProportions: document.querySelector("#resize-proportions"),
  resizeMethod: document.querySelector("#resize-method"),
  algorithmHelp: document.querySelector("#algorithm-help"),
  algorithmTooltip: document.querySelector("#algorithm-tooltip"),
  pixelsBefore: document.querySelector("#pixels-before"),
  pixelsAfter: document.querySelector("#pixels-after"),
  resizeError: document.querySelector("#resize-error"),
  resizeCancel: document.querySelector("#resize-cancel"),
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
  resizeSession: null,
  interpolationMethod: "bilinear",
  renderFrame: 0,
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
  elements.resizeButton.disabled = isBusy || !state.document;
  elements.resizePanelButton.disabled = isBusy || !state.document;
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
    new ImageData(state.originalPixels, sourceCanvas.width, sourceCanvas.height),
    0,
    0,
  );
}

function renderVisibleChannels() {
  if (!state.document || !state.originalPixels) return;
  const sourcePixels = state.previewPixels || state.originalPixels;
  const visiblePixels = applyChannels(sourcePixels, state.channelModel, state.activeChannels);
  const displaySize = scaledDimensions(state.document.width, state.document.height, state.zoom);
  const displayPixels = resizePixels(
    visiblePixels,
    state.document.width,
    state.document.height,
    displaySize.width,
    displaySize.height,
    state.interpolationMethod,
  );

  elements.canvas.width = displaySize.width;
  elements.canvas.height = displaySize.height;
  elements.canvas.style.width = `${displaySize.width}px`;
  elements.canvas.style.height = `${displaySize.height}px`;
  elements.canvas.classList.toggle("is-pixelated", state.interpolationMethod === "nearest");
  context.putImageData(new ImageData(displayPixels, displaySize.width, displaySize.height), 0, 0);
}

function scheduleCanvasRender() {
  if (state.renderFrame) return;
  state.renderFrame = requestAnimationFrame(() => {
    state.renderFrame = 0;
    renderVisibleChannels();
  });
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
  state.interpolationMethod = "bilinear";
  state.zoom = calculateFitScale(
    documentData.width,
    documentData.height,
    elements.viewport.clientWidth,
    elements.viewport.clientHeight,
  );
  state.zoomMode = "fit";
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
  elements.resizeButton.disabled = false;
  elements.resizePanelButton.disabled = false;
  elements.zoomRange.disabled = false;
  [elements.zoomIn, elements.zoomOut, elements.fitButton, elements.actualSizeButton].forEach((button) => {
    button.disabled = false;
  });
  setStatus(`${FORMAT_LABELS[documentData.format]} загружен`);

  requestAnimationFrame(fitImage);
}

function clampZoom(value) {
  return Math.min(3, Math.max(0.12, Number(value) || 1));
}

function safeZoomForDocument(value) {
  if (!state.document) return clampZoom(value);
  const pixelLimit = Math.sqrt(MAX_RASTER_PIXELS / (state.document.width * state.document.height));
  const widthLimit = MAX_IMAGE_DIMENSION / state.document.width;
  const heightLimit = MAX_IMAGE_DIMENSION / state.document.height;
  const safeMaximum = Math.min(3, pixelLimit, widthLimit, heightLimit);
  return Math.max(0.12, Math.min(clampZoom(value), Math.floor(safeMaximum * 100) / 100));
}

function setZoom(value, mode = "manual") {
  if (!state.document) return;
  const requestedZoom = clampZoom(value);
  state.zoom = safeZoomForDocument(requestedZoom);
  state.zoomMode = mode;

  const displaySize = scaledDimensions(state.document.width, state.document.height, state.zoom);

  const padding = 100;
  elements.canvasPlane.style.width = `${Math.max(elements.viewport.clientWidth, displaySize.width + padding)}px`;
  elements.canvasPlane.style.height = `${Math.max(elements.viewport.clientHeight, displaySize.height + padding)}px`;

  const roundedPercent = Math.round(state.zoom * 100);
  elements.zoomRange.value = String(roundedPercent);
  elements.zoomValue.textContent = `${roundedPercent}%`;
  elements.statusZoom.textContent = `Масштаб: ${roundedPercent}%`;
  elements.scaleMethod.textContent = INTERPOLATION_METHODS[state.interpolationMethod].label;
  scheduleCanvasRender();

  if (mode === "manual" && state.zoom < requestedZoom) {
    setStatus("Масштаб ограничен безопасным размером canvas");
  }
}

function fitImage() {
  if (!state.document) return;
  const scale = calculateFitScale(
    state.document.width,
    state.document.height,
    elements.viewport.clientWidth,
    elements.viewport.clientHeight,
  );
  setZoom(scale, "fit");
  elements.viewport.scrollTo({ left: 0, top: 0 });
}

function changeZoom(factor) {
  if (!state.document) return;
  setZoom(state.zoom * factor);
}

function formatPixelCount(pixelCount) {
  if (pixelCount >= 1_000_000) return `${(pixelCount / 1_000_000).toFixed(2)} Мп`;
  return `${pixelCount.toLocaleString("ru-RU")} пикс.`;
}

function compactNumber(value) {
  return String(Number(value.toFixed(2)));
}

function readResizeFields(units = state.resizeSession?.units) {
  const widthValue = Number(elements.resizeWidth.value);
  const heightValue = Number(elements.resizeHeight.value);
  if (!Number.isFinite(widthValue) || !Number.isFinite(heightValue)) return null;

  if (units === "percent") {
    return {
      width: Math.max(1, Math.round(state.document.width * widthValue / 100)),
      height: Math.max(1, Math.round(state.document.height * heightValue / 100)),
      widthValue,
      heightValue,
    };
  }

  return {
    width: Math.round(widthValue),
    height: Math.round(heightValue),
    widthValue,
    heightValue,
  };
}

function validateResizeFields() {
  const dimensions = readResizeFields();
  const units = state.resizeSession?.units;
  const minimum = 1;
  const maximum = units === "percent" ? 1000 : MAX_IMAGE_DIMENSION;

  if (!dimensions || dimensions.widthValue < minimum || dimensions.heightValue < minimum) {
    return { valid: false, message: "Ширина и высота должны быть положительными числами." };
  }
  if (dimensions.widthValue > maximum || dimensions.heightValue > maximum) {
    const limit = units === "percent" ? "1000%" : "16 384 px";
    return { valid: false, message: `Ширина и высота не должны превышать ${limit}.` };
  }
  if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
    return { valid: false, message: "Итоговая сторона изображения не должна превышать 16 384 px." };
  }
  if (dimensions.width * dimensions.height > MAX_RASTER_PIXELS) {
    return { valid: false, message: "Итоговое изображение не должно превышать 64 мегапикселя." };
  }
  return { valid: true, dimensions };
}

function showResizeValidation(result) {
  elements.resizeError.hidden = result.valid;
  elements.resizeError.textContent = result.valid ? "" : result.message;
  elements.resizeWidth.setAttribute("aria-invalid", String(!result.valid));
  elements.resizeHeight.setAttribute("aria-invalid", String(!result.valid));
  elements.pixelsBefore.textContent = formatPixelCount(state.document.width * state.document.height);
  elements.pixelsAfter.textContent = result.valid
    ? formatPixelCount(result.dimensions.width * result.dimensions.height)
    : "Некорректный размер";
}

function updateResizeSummary() {
  const result = validateResizeFields();
  if (result.valid && state.resizeSession) {
    state.resizeSession.lastValidWidth = result.dimensions.width;
    state.resizeSession.lastValidHeight = result.dimensions.height;
  }
  showResizeValidation(result);
  return result;
}

function writeResizeFields(width, height, units = state.resizeSession.units) {
  if (units === "percent") {
    elements.resizeWidth.value = compactNumber(width / state.document.width * 100);
    elements.resizeHeight.value = compactNumber(height / state.document.height * 100);
  } else {
    elements.resizeWidth.value = String(Math.round(width));
    elements.resizeHeight.value = String(Math.round(height));
  }
}

function configureResizeFieldUnits(units) {
  const isPercent = units === "percent";
  const unitLabel = isPercent ? "%" : "px";
  const maximum = isPercent ? 1000 : MAX_IMAGE_DIMENSION;
  const step = isPercent ? 0.1 : 1;

  [elements.resizeWidth, elements.resizeHeight].forEach((input) => {
    input.max = String(maximum);
    input.step = String(step);
  });
  elements.resizeWidthUnit.textContent = unitLabel;
  elements.resizeHeightUnit.textContent = unitLabel;
}

function handleResizeDimension(axis) {
  if (!state.resizeSession) return;
  const value = Number(axis === "width" ? elements.resizeWidth.value : elements.resizeHeight.value);
  if (elements.resizeProportions.checked && Number.isFinite(value) && value > 0) {
    if (state.resizeSession.units === "percent") {
      if (axis === "width") elements.resizeHeight.value = String(value);
      else elements.resizeWidth.value = String(value);
    } else {
      const aspectRatio = state.document.width / state.document.height;
      if (axis === "width") elements.resizeHeight.value = String(Math.max(1, Math.round(value / aspectRatio)));
      else elements.resizeWidth.value = String(Math.max(1, Math.round(value * aspectRatio)));
    }
  }
  updateResizeSummary();
}

function changeResizeUnits() {
  if (!state.resizeSession) return;
  const previousDimensions = readResizeFields(state.resizeSession.units) || {
    width: state.resizeSession.lastValidWidth,
    height: state.resizeSession.lastValidHeight,
  };
  state.resizeSession.units = elements.resizeUnits.value;
  configureResizeFieldUnits(state.resizeSession.units);
  writeResizeFields(previousDimensions.width, previousDimensions.height);
  updateResizeSummary();
}

function updateAlgorithmTooltip() {
  const method = INTERPOLATION_METHODS[elements.resizeMethod.value];
  elements.algorithmTooltip.textContent = method.description;
  elements.algorithmHelp.setAttribute("aria-label", `Описание алгоритма: ${method.label}`);
}

function openResizeDialog() {
  if (!state.document || state.busy || elements.resizeDialog.open || elements.levelsDialog.open) return;
  setActiveTool("view");
  state.resizeSession = {
    units: "pixels",
    lastValidWidth: state.document.width,
    lastValidHeight: state.document.height,
  };
  elements.resizeUnits.value = "pixels";
  elements.resizeProportions.checked = true;
  elements.resizeMethod.value = state.interpolationMethod;
  configureResizeFieldUnits("pixels");
  writeResizeFields(state.document.width, state.document.height);
  updateAlgorithmTooltip();
  updateResizeSummary();
  elements.resizeDialog.showModal();
  elements.resizeWidth.focus();
  elements.resizeWidth.select();
}

function closeResizeDialog() {
  if (!state.resizeSession) return;
  state.resizeSession = null;
  elements.resizeDialog.close();
  setStatus("Изменение размера отменено");
}

async function applyResize(event) {
  event.preventDefault();
  if (!state.resizeSession || state.busy) return;
  const result = updateResizeSummary();
  if (!result.valid) {
    elements.resizeWidth.focus();
    return;
  }

  const { width, height } = result.dimensions;
  const sourceWidth = state.document.width;
  const sourceHeight = state.document.height;
  const method = elements.resizeMethod.value;
  state.resizeSession = null;
  elements.resizeDialog.close();
  setBusy(true);
  setStatus("Изменение размера изображения…");

  await new Promise((resolve) => requestAnimationFrame(resolve));

  try {
    const resizedPixels = resizePixels(
      state.originalPixels,
      sourceWidth,
      sourceHeight,
      width,
      height,
      method,
    );
    state.originalPixels = resizedPixels;
    state.previewPixels = null;
    state.document.width = width;
    state.document.height = height;
    state.interpolationMethod = method;
    state.zoom = safeZoomForDocument(state.zoom);
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    syncSourceCanvas();
    configureChannels(state.channelModel);
    resetColorSample();
    elements.dimensions.textContent = `${width} × ${height} px`;
    elements.statusDimensions.textContent = `${width} × ${height} px`;
    setZoom(state.zoom);
    setStatus(`Размер изменён: ${width} × ${height} px`);
    showToast(`Новый размер: ${width} × ${height} px`);
  } catch (error) {
    setStatus("Ошибка изменения размера", true);
    showToast(error.message || "Не удалось изменить размер изображения.", true);
  } finally {
    setBusy(false);
  }
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
    x: Math.min(state.document.width - 1, Math.floor((localX / displayWidth) * state.document.width)),
    y: Math.min(state.document.height - 1, Math.floor((localY / displayHeight) * state.document.height)),
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
  if (!state.document || state.busy || elements.levelsDialog.open || elements.resizeDialog.open) return;
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

function createDocumentCanvas() {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = state.document.width;
  exportCanvas.height = state.document.height;
  const exportContext = exportCanvas.getContext("2d");
  const visiblePixels = applyChannels(state.originalPixels, state.channelModel, state.activeChannels);
  exportContext.putImageData(
    new ImageData(visiblePixels, state.document.width, state.document.height),
    0,
    0,
  );
  return exportCanvas;
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
    const documentCanvas = createDocumentCanvas();

    if (format === "gb7") {
      const imageData = documentCanvas.getContext("2d").getImageData(
        0,
        0,
        state.document.width,
        state.document.height,
      );
      const encoded = encodeGB7(imageData);
      blob = new Blob([encoded.bytes], { type: "application/octet-stream" });
      fileName = `${name}.gb7`;
    } else if (format === "jpeg") {
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = state.document.width;
      exportCanvas.height = state.document.height;
      const exportContext = exportCanvas.getContext("2d");
      exportContext.fillStyle = "#ffffff";
      exportContext.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      exportContext.drawImage(documentCanvas, 0, 0);
      const quality = Number(elements.qualityRange.value) / 100;
      blob = await canvasToBlob(exportCanvas, "image/jpeg", quality);
      fileName = `${name}.jpg`;
    } else {
      blob = await canvasToBlob(documentCanvas, "image/png");
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
elements.resizeButton.addEventListener("click", openResizeDialog);
elements.resizePanelButton.addEventListener("click", openResizeDialog);
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
elements.resizeUnits.addEventListener("change", changeResizeUnits);
elements.resizeWidth.addEventListener("input", () => handleResizeDimension("width"));
elements.resizeHeight.addEventListener("input", () => handleResizeDimension("height"));
elements.resizeProportions.addEventListener("change", () => {
  if (elements.resizeProportions.checked) handleResizeDimension("width");
});
elements.resizeMethod.addEventListener("change", updateAlgorithmTooltip);
elements.resizeForm.addEventListener("submit", applyResize);
elements.resizeCancel.addEventListener("click", closeResizeDialog);
elements.resizeClose.addEventListener("click", closeResizeDialog);
elements.resizeDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeResizeDialog();
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
  const isEditing = event.target instanceof HTMLElement
    && event.target.matches("input, select, textarea");
  if (commandKey && event.key.toLowerCase() === "o") {
    event.preventDefault();
    openFilePicker();
  }
  if (commandKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    downloadCurrentImage();
  }
  if (!commandKey && !isEditing && event.key.toLowerCase() === "i" && state.document
    && !elements.levelsDialog.open && !elements.resizeDialog.open) {
    setActiveTool(state.activeTool === "eyedropper" ? "view" : "eyedropper");
  }
  if (!commandKey && !isEditing && event.key.toLowerCase() === "l" && state.document
    && !elements.levelsDialog.open && !elements.resizeDialog.open) {
    openLevels();
  }
  if (!commandKey && !isEditing && event.key.toLowerCase() === "r" && state.document
    && !elements.resizeDialog.open && !elements.levelsDialog.open) {
    openResizeDialog();
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
elements.resizeButton.disabled = true;
elements.resizePanelButton.disabled = true;
})();
