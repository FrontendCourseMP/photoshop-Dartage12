((scope) => {
  const PRESETS = Object.freeze({
    identity: Object.freeze({
      key: "identity",
      label: "Тождественное отображение",
      type: "kernel",
      kernel: Object.freeze([0, 0, 0, 0, 1, 0, 0, 0, 0]),
    }),
    sharpen: Object.freeze({
      key: "sharpen",
      label: "Повышение резкости",
      type: "kernel",
      kernel: Object.freeze([0, -1, 0, -1, 5, -1, 0, -1, 0]),
    }),
    gaussian: Object.freeze({
      key: "gaussian",
      label: "Размытие по Гауссу 3×3",
      type: "kernel",
      kernel: Object.freeze([0.0625, 0.125, 0.0625, 0.125, 0.25, 0.125, 0.0625, 0.125, 0.0625]),
    }),
    boxBlur: Object.freeze({
      key: "boxBlur",
      label: "Прямоугольное размытие",
      type: "kernel",
      kernel: Object.freeze(Array(9).fill(1 / 9)),
    }),
    prewittX: Object.freeze({
      key: "prewittX",
      label: "Оператор Прюитта X",
      type: "kernel",
      kernel: Object.freeze([-1, 0, 1, -1, 0, 1, -1, 0, 1]),
    }),
    prewittY: Object.freeze({
      key: "prewittY",
      label: "Оператор Прюитта Y",
      type: "kernel",
      kernel: Object.freeze([-1, -1, -1, 0, 0, 0, 1, 1, 1]),
    }),
    median: Object.freeze({
      key: "median",
      label: "Медианный фильтр 3×3",
      type: "median",
      kernel: Object.freeze([0, 0, 0, 0, 1, 0, 0, 0, 0]),
    }),
  });

  const EDGE_STRATEGIES = Object.freeze({
    copy: "Копирование края",
    black: "Заполнение чёрным",
    white: "Заполнение белым",
  });

  function validateInput(pixels, width, height, options) {
    if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4) {
      throw new TypeError("Размер массива RGBA не соответствует изображению.");
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new TypeError("Размеры изображения должны быть положительными целыми числами.");
    }
    if (!options || (options.type !== "kernel" && options.type !== "median")) {
      throw new TypeError("Неизвестный тип фильтра.");
    }
    if (!Object.hasOwn(EDGE_STRATEGIES, options.edge)) {
      throw new TypeError("Неизвестная стратегия обработки края.");
    }
    if (!Array.isArray(options.channels) || options.channels.length === 0
      || options.channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 3)) {
      throw new TypeError("Выберите хотя бы один корректный канал.");
    }
    if (options.type === "kernel"
      && (!Array.isArray(options.kernel) || options.kernel.length !== 9
        || options.kernel.some((value) => !Number.isFinite(value)))) {
      throw new TypeError("Ядро должно содержать 9 чисел.");
    }
  }

  function edgeSample(pixels, width, height, x, y, channel, edge) {
    if (x >= 0 && y >= 0 && x < width && y < height) {
      return pixels[(y * width + x) * 4 + channel];
    }
    if (edge === "copy") {
      const safeX = Math.min(width - 1, Math.max(0, x));
      const safeY = Math.min(height - 1, Math.max(0, y));
      return pixels[(safeY * width + safeX) * 4 + channel];
    }
    if (channel === 3) return 255;
    return edge === "white" ? 255 : 0;
  }

  function processRows(pixels, output, width, height, options, startRow, endRow) {
    const selectedChannels = [...new Set(options.channels)];
    const medianValues = options.type === "median" ? new Array(9) : null;

    for (let y = startRow; y < endRow; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const outputIndex = (y * width + x) * 4;

        for (const channel of selectedChannels) {
          if (options.type === "median") {
            let neighborIndex = 0;
            for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
              for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                medianValues[neighborIndex] = edgeSample(
                  pixels,
                  width,
                  height,
                  x + offsetX,
                  y + offsetY,
                  channel,
                  options.edge,
                );
                neighborIndex += 1;
              }
            }
            medianValues.sort((a, b) => a - b);
            output[outputIndex + channel] = medianValues[4];
            continue;
          }

          let value = 0;
          let kernelIndex = 0;
          for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
              value += edgeSample(
                pixels,
                width,
                height,
                x + offsetX,
                y + offsetY,
                channel,
                options.edge,
              ) * options.kernel[kernelIndex];
              kernelIndex += 1;
            }
          }
          output[outputIndex + channel] = Math.round(value);
        }
      }
    }
  }

  function isIdentityKernel(options) {
    const identity = PRESETS.identity.kernel;
    return options.type === "kernel"
      && options.kernel.every((value, index) => value === identity[index]);
  }

  function applyFilter(pixels, width, height, options, onProgress) {
    validateInput(pixels, width, height, options);
    const output = new Uint8ClampedArray(pixels);
    if (isIdentityKernel(options)) {
      if (onProgress) onProgress(1);
      return output;
    }
    const rowsPerProgress = Math.max(1, Math.floor(height / 20));

    for (let startRow = 0; startRow < height; startRow += rowsPerProgress) {
      const endRow = Math.min(height, startRow + rowsPerProgress);
      processRows(pixels, output, width, height, options, startRow, endRow);
      if (onProgress) onProgress(endRow / height);
    }
    return output;
  }

  async function applyFilterAsync(pixels, width, height, options, controls = {}) {
    validateInput(pixels, width, height, options);
    const output = new Uint8ClampedArray(pixels);
    if (isIdentityKernel(options)) {
      controls.onProgress?.(1);
      return output;
    }
    const chunkRows = Math.max(1, Math.round(controls.chunkRows || 12));

    for (let startRow = 0; startRow < height; startRow += chunkRows) {
      if (controls.shouldCancel?.()) return null;
      const endRow = Math.min(height, startRow + chunkRows);
      processRows(pixels, output, width, height, options, startRow, endRow);
      controls.onProgress?.(endRow / height);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return output;
  }

  scope.ImageFilters = Object.freeze({
    PRESETS,
    EDGE_STRATEGIES,
    applyFilter,
    applyFilterAsync,
  });
})(typeof window === "undefined" ? self : window);
