(() => {
  const MIN_VIEW_SCALE = 0.12;
  const MAX_VIEW_SCALE = 3;

  const METHODS = Object.freeze({
    nearest: Object.freeze({
      key: "nearest",
      label: "Ближайший сосед",
      description: "Копирует ближайший пиксель. Работает быстро и сохраняет резкие края пиксельной графики.",
    }),
    bilinear: Object.freeze({
      key: "bilinear",
      label: "Билинейная",
      description: "Смешивает четыре соседних пикселя. Даёт более плавный результат и хорошо подходит для фотографий.",
    }),
  });

  function validateSource(pixels, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const dimensions = [sourceWidth, sourceHeight, targetWidth, targetHeight];
    if (!dimensions.every((value) => Number.isInteger(value) && value > 0)) {
      throw new TypeError("Размеры изображения должны быть положительными целыми числами.");
    }
    if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== sourceWidth * sourceHeight * 4) {
      throw new TypeError("Размер массива RGBA не соответствует исходному изображению.");
    }
  }

  function resizeNearest(pixels, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
    const xRatio = sourceWidth / targetWidth;
    const yRatio = sourceHeight / targetHeight;

    for (let targetY = 0; targetY < targetHeight; targetY += 1) {
      const sourceY = Math.min(sourceHeight - 1, Math.floor((targetY + 0.5) * yRatio));
      for (let targetX = 0; targetX < targetWidth; targetX += 1) {
        const sourceX = Math.min(sourceWidth - 1, Math.floor((targetX + 0.5) * xRatio));
        const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
        const targetIndex = (targetY * targetWidth + targetX) * 4;

        output[targetIndex] = pixels[sourceIndex];
        output[targetIndex + 1] = pixels[sourceIndex + 1];
        output[targetIndex + 2] = pixels[sourceIndex + 2];
        output[targetIndex + 3] = pixels[sourceIndex + 3];
      }
    }

    return output;
  }

  function resizeBilinear(pixels, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
    const xRatio = sourceWidth / targetWidth;
    const yRatio = sourceHeight / targetHeight;

    for (let targetY = 0; targetY < targetHeight; targetY += 1) {
      const sourceY = Math.min(sourceHeight - 1, Math.max(0, (targetY + 0.5) * yRatio - 0.5));
      const topY = Math.floor(sourceY);
      const bottomY = Math.min(sourceHeight - 1, topY + 1);
      const yWeight = sourceY - topY;

      for (let targetX = 0; targetX < targetWidth; targetX += 1) {
        const sourceX = Math.min(sourceWidth - 1, Math.max(0, (targetX + 0.5) * xRatio - 0.5));
        const leftX = Math.floor(sourceX);
        const rightX = Math.min(sourceWidth - 1, leftX + 1);
        const xWeight = sourceX - leftX;
        const topLeft = (topY * sourceWidth + leftX) * 4;
        const topRight = (topY * sourceWidth + rightX) * 4;
        const bottomLeft = (bottomY * sourceWidth + leftX) * 4;
        const bottomRight = (bottomY * sourceWidth + rightX) * 4;
        const targetIndex = (targetY * targetWidth + targetX) * 4;

        for (let channel = 0; channel < 4; channel += 1) {
          const top = pixels[topLeft + channel]
            + (pixels[topRight + channel] - pixels[topLeft + channel]) * xWeight;
          const bottom = pixels[bottomLeft + channel]
            + (pixels[bottomRight + channel] - pixels[bottomLeft + channel]) * xWeight;
          output[targetIndex + channel] = Math.round(top + (bottom - top) * yWeight);
        }
      }
    }

    return output;
  }

  const interpolators = Object.freeze({
    nearest: resizeNearest,
    bilinear: resizeBilinear,
  });

  function resizePixels(
    pixels,
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    method = "bilinear",
  ) {
    validateSource(pixels, sourceWidth, sourceHeight, targetWidth, targetHeight);
    const interpolate = interpolators[method];
    if (!interpolate) throw new TypeError(`Неизвестный метод интерполяции: ${method}.`);
    if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
      return new Uint8ClampedArray(pixels);
    }
    return interpolate(pixels, sourceWidth, sourceHeight, targetWidth, targetHeight);
  }

  function clampViewScale(value) {
    return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, Number(value) || 1));
  }

  function calculateFitScale(imageWidth, imageHeight, viewportWidth, viewportHeight, padding = 50) {
    const availableWidth = Math.max(1, viewportWidth - padding * 2);
    const availableHeight = Math.max(1, viewportHeight - padding * 2);
    return clampViewScale(Math.min(availableWidth / imageWidth, availableHeight / imageHeight));
  }

  function scaledDimensions(width, height, scale) {
    const normalizedScale = clampViewScale(scale);
    return {
      width: Math.max(1, Math.round(width * normalizedScale)),
      height: Math.max(1, Math.round(height * normalizedScale)),
    };
  }

  window.ImageInterpolation = Object.freeze({
    METHODS,
    MIN_VIEW_SCALE,
    MAX_VIEW_SCALE,
    resizePixels,
    calculateFitScale,
    scaledDimensions,
  });
})();
