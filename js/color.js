(() => {
  function clampByte(value) {
    return Math.min(255, Math.max(0, Number(value) || 0));
  }

  function srgbToLinear(value) {
    const normalized = clampByte(value) / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  }

  function labTransform(value) {
    const delta = 6 / 29;
    return value > delta ** 3
      ? Math.cbrt(value)
      : value / (3 * delta ** 2) + 4 / 29;
  }

  function rgbToLab(red, green, blue) {
    const r = srgbToLinear(red);
    const g = srgbToLinear(green);
    const b = srgbToLinear(blue);

    const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
    const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
    const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;

    const fx = labTransform(x / 0.95047);
    const fy = labTransform(y);
    const fz = labTransform(z / 1.08883);

    return {
      l: 116 * fy - 16,
      a: 500 * (fx - fy),
      b: 200 * (fy - fz),
    };
  }

  function rgbToHex(red, green, blue) {
    return `#${[red, green, blue]
      .map((value) => Math.round(clampByte(value)).toString(16).padStart(2, "0"))
      .join("")}`.toUpperCase();
  }

  window.ColorSpaces = Object.freeze({ rgbToLab, rgbToHex });
})();
