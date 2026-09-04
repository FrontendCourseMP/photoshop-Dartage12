(() => {
const { decodeGB7, encodeGB7, GB7Error } = window.GB7Codec;
const { detectImageFormat, readRasterMetadata } = window.ImageMetadata;

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
  toast: document.querySelector("#toast"),
};

const context = elements.canvas.getContext("2d", { willReadFrequently: true });
const state = {
  document: null,
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
  elements.canvas.width = decoded.width;
  elements.canvas.height = decoded.height;
  context.putImageData(new ImageData(decoded.rgba, decoded.width, decoded.height), 0, 0);

  commitDocument({
    name: fileName,
    format: "gb7",
    width: decoded.width,
    height: decoded.height,
    depthLabel: decoded.hasMask ? "7 бит + 1 бит маски" : "7 бит",
    shortDepth: decoded.hasMask ? "7 бит + маска" : "7 бит",
    fileSize,
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
  source.release();

  commitDocument({
    name: fileName,
    format,
    width: source.width,
    height: source.height,
    depthLabel: metadata.depthLabel,
    shortDepth: `${metadata.bitsPerPixel} бит`,
    fileSize,
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

function commitDocument(documentData) {
  state.document = documentData;
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
