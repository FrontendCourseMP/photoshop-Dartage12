(() => {
  const MIN_GAMMA = 0.1;
  const MAX_GAMMA = 9.9;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function createDefaultSettings(maxValue = 255) {
    return { black: 0, gamma: 1, white: maxValue };
  }

  function normalizeSettings(settings, maxValue) {
    const black = clamp(Math.round(settings.black), 0, maxValue - 1);
    const white = clamp(Math.round(settings.white), black + 1, maxValue);
    const gamma = clamp(Number(settings.gamma) || 1, MIN_GAMMA, MAX_GAMMA);
    return { black, gamma, white };
  }

  function buildLevelsLut(settings, maxValue = 255) {
    const normalizedSettings = normalizeSettings(settings, maxValue);
    const lut = new Uint8ClampedArray(256);
    const range = normalizedSettings.white - normalizedSettings.black;

    for (let value = 0; value < 256; value += 1) {
      const inputLevel = (value / 255) * maxValue;
      const normalized = clamp((inputLevel - normalizedSettings.black) / range, 0, 1);
      lut[value] = Math.round((normalized ** normalizedSettings.gamma) * 255);
    }

    return lut;
  }

  function linearSrgb(value) {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  }

  function relativeLuminance(red, green, blue) {
    return 0.2126 * linearSrgb(red) + 0.7152 * linearSrgb(green) + 0.0722 * linearSrgb(blue);
  }

  function calculateHistogram(pixels, channel = "master", maxValue = 255) {
    const histogram = new Uint32Array(maxValue + 1);

    for (let index = 0; index < pixels.length; index += 4) {
      let normalized;
      if (channel === "master") {
        normalized = relativeLuminance(pixels[index], pixels[index + 1], pixels[index + 2]);
      } else if (channel === "red" || channel === "gray") {
        normalized = pixels[index] / 255;
      } else if (channel === "green") {
        normalized = pixels[index + 1] / 255;
      } else if (channel === "blue") {
        normalized = pixels[index + 2] / 255;
      } else if (channel === "alpha") {
        normalized = pixels[index + 3] / 255;
      } else {
        throw new Error(`Неизвестный канал гистограммы: ${channel}.`);
      }

      const bin = Math.round(clamp(normalized, 0, 1) * maxValue);
      histogram[bin] += 1;
    }

    return histogram;
  }

  function applyLevels(originalPixels, model, settingsByChannel, maxValue = 255) {
    const output = new Uint8ClampedArray(originalPixels.length);
    const masterLut = buildLevelsLut(settingsByChannel.master || createDefaultSettings(maxValue), maxValue);
    const alphaLut = buildLevelsLut(settingsByChannel.alpha || createDefaultSettings(maxValue), maxValue);
    const isGray = model === "gray" || model === "gray-alpha";
    const hasAlpha = model === "gray-alpha" || model === "rgba";

    if (isGray) {
      const grayLut = buildLevelsLut(settingsByChannel.gray || createDefaultSettings(maxValue), maxValue);
      for (let index = 0; index < originalPixels.length; index += 4) {
        const gray = grayLut[masterLut[originalPixels[index]]];
        output[index] = gray;
        output[index + 1] = gray;
        output[index + 2] = gray;
        output[index + 3] = hasAlpha ? alphaLut[originalPixels[index + 3]] : 255;
      }
      return output;
    }

    const redLut = buildLevelsLut(settingsByChannel.red || createDefaultSettings(maxValue), maxValue);
    const greenLut = buildLevelsLut(settingsByChannel.green || createDefaultSettings(maxValue), maxValue);
    const blueLut = buildLevelsLut(settingsByChannel.blue || createDefaultSettings(maxValue), maxValue);

    for (let index = 0; index < originalPixels.length; index += 4) {
      output[index] = redLut[masterLut[originalPixels[index]]];
      output[index + 1] = greenLut[masterLut[originalPixels[index + 1]]];
      output[index + 2] = blueLut[masterLut[originalPixels[index + 2]]];
      output[index + 3] = hasAlpha ? alphaLut[originalPixels[index + 3]] : 255;
    }

    return output;
  }

  function gammaToPosition(gamma, black, white) {
    const value = clamp(Number(gamma) || 1, MIN_GAMMA, MAX_GAMMA);
    const ratio = value <= 1
      ? 0.5 * Math.log10(value / MIN_GAMMA)
      : 0.5 + 0.5 * (Math.log(value) / Math.log(MAX_GAMMA));
    return black + ratio * (white - black);
  }

  function positionToGamma(position, black, white) {
    if (white <= black) return 1;
    const ratio = clamp((position - black) / (white - black), 0, 1);
    return ratio <= 0.5
      ? MIN_GAMMA * 10 ** (ratio / 0.5)
      : MAX_GAMMA ** ((ratio - 0.5) / 0.5);
  }

  window.ImageLevels = Object.freeze({
    MIN_GAMMA,
    MAX_GAMMA,
    createDefaultSettings,
    buildLevelsLut,
    calculateHistogram,
    applyLevels,
    gammaToPosition,
    positionToGamma,
  });
})();
