(() => {
  const CHANNEL_MODES = Object.freeze([
    Object.freeze({ key: "gray", label: "Grayscale", count: 1 }),
    Object.freeze({ key: "gray-alpha", label: "Grayscale + Alpha", count: 2 }),
    Object.freeze({ key: "rgb", label: "RGB", count: 3 }),
    Object.freeze({ key: "rgba", label: "RGB + Alpha", count: 4 }),
  ]);

  const CHANNELS = Object.freeze({
    gray: Object.freeze({ key: "gray", shortLabel: "Y", label: "Серый" }),
    red: Object.freeze({ key: "red", shortLabel: "R", label: "Красный" }),
    green: Object.freeze({ key: "green", shortLabel: "G", label: "Зелёный" }),
    blue: Object.freeze({ key: "blue", shortLabel: "B", label: "Синий" }),
    alpha: Object.freeze({ key: "alpha", shortLabel: "A", label: "Альфа" }),
  });

  const MODEL_CHANNELS = Object.freeze({
    gray: Object.freeze(["gray"]),
    "gray-alpha": Object.freeze(["gray", "alpha"]),
    rgb: Object.freeze(["red", "green", "blue"]),
    rgba: Object.freeze(["red", "green", "blue", "alpha"]),
  });

  function luminance(red, green, blue) {
    return Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
  }

  function listChannels(model) {
    const keys = MODEL_CHANNELS[model];
    if (!keys) throw new Error(`Неизвестная модель каналов: ${model}.`);
    return keys.map((key) => CHANNELS[key]);
  }

  function applyChannels(originalPixels, model, activeChannels) {
    const definitions = listChannels(model);
    const active = activeChannels instanceof Set ? activeChannels : new Set(activeChannels);
    const output = new Uint8ClampedArray(originalPixels.length);
    const isGray = model === "gray" || model === "gray-alpha";
    const hasAlpha = model === "gray-alpha" || model === "rgba";
    const colorKeys = definitions.filter((channel) => channel.key !== "alpha").map((channel) => channel.key);
    const hasVisibleColor = colorKeys.some((key) => active.has(key));
    const alphaOnly = hasAlpha && active.has("alpha") && !hasVisibleColor;

    for (let index = 0; index < originalPixels.length; index += 4) {
      const red = originalPixels[index];
      const green = originalPixels[index + 1];
      const blue = originalPixels[index + 2];
      const alpha = originalPixels[index + 3];

      if (alphaOnly) {
        output[index] = alpha;
        output[index + 1] = alpha;
        output[index + 2] = alpha;
        output[index + 3] = 255;
      } else if (isGray) {
        const gray = active.has("gray") ? luminance(red, green, blue) : 0;
        output[index] = gray;
        output[index + 1] = gray;
        output[index + 2] = gray;
        output[index + 3] = hasAlpha && active.has("alpha") ? alpha : 255;
      } else {
        output[index] = active.has("red") ? red : 0;
        output[index + 1] = active.has("green") ? green : 0;
        output[index + 2] = active.has("blue") ? blue : 0;
        output[index + 3] = hasAlpha && active.has("alpha") ? alpha : 255;
      }
    }

    return output;
  }

  function isolateChannel(pixels, channelKey) {
    if (!CHANNELS[channelKey]) throw new Error(`Неизвестный канал: ${channelKey}.`);
    const output = new Uint8ClampedArray(pixels.length);

    for (let index = 0; index < pixels.length; index += 4) {
      let value;
      if (channelKey === "alpha") value = pixels[index + 3];
      else if (channelKey === "red") value = pixels[index];
      else if (channelKey === "green") value = pixels[index + 1];
      else if (channelKey === "blue") value = pixels[index + 2];
      else value = luminance(pixels[index], pixels[index + 1], pixels[index + 2]);

      output[index] = value;
      output[index + 1] = value;
      output[index + 2] = value;
      output[index + 3] = 255;
    }

    return output;
  }

  window.ImageChannels = Object.freeze({ CHANNEL_MODES, listChannels, applyChannels, isolateChannel });
})();
