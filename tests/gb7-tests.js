(async () => {
const { decodeGB7, encodeGB7, GB7Error } = window.GB7Codec;
const { rgbToLab, rgbToHex } = window.ColorSpaces;
const { applyChannels } = window.ImageChannels;
const {
  createDefaultSettings,
  buildLevelsLut,
  calculateHistogram,
  applyLevels,
  gammaToPosition,
  positionToGamma,
} = window.ImageLevels;

const results = document.querySelector("#results");
const summary = document.querySelector("#summary");
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertClose(actual, expected, tolerance, message) {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual}`);
}

async function test(name, callback) {
  const item = document.createElement("li");
  try {
    await callback();
    passed += 1;
    item.textContent = `PASS — ${name}`;
  } catch (error) {
    failed += 1;
    item.className = "fail";
    item.textContent = `FAIL — ${name}: ${error.message}`;
  }
  results.append(item);
}

await test("заголовок, размеры и big-endian", () => {
  const image = new ImageData(new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 255, 255, 255,
  ]), 2, 1);
  const { bytes, hasMask } = encodeGB7(image);

  assert(!hasMask, "маска не должна создаваться для непрозрачного изображения");
  assert(bytes.length === 14, "неверная длина файла");
  assert([0x47, 0x42, 0x37, 0x1d].every((byte, i) => bytes[i] === byte), "неверная сигнатура");
  assert(bytes[4] === 1 && bytes[5] === 0, "неверные версия или флаг");
  assert(bytes[6] === 0 && bytes[7] === 2 && bytes[8] === 0 && bytes[9] === 1, "размеры записаны не в big-endian");
  assert((bytes[12] & 0x80) === 0 && (bytes[13] & 0x80) === 0, "старший бит должен быть нулём без маски");
});

await test("декодирование крайних значений яркости", () => {
  const encoded = encodeGB7(new ImageData(new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 255, 255, 255,
  ]), 2, 1));
  const decoded = decodeGB7(encoded.bytes.buffer);

  assert(decoded.rgba[0] === 0, "чёрный цвет изменился");
  assert(decoded.rgba[4] === 255, "белый цвет изменился");
  assert(decoded.rgba[3] === 255 && decoded.rgba[7] === 255, "альфа без маски должна быть непрозрачной");
});

await test("двоичная маска прозрачности", () => {
  const image = new ImageData(new Uint8ClampedArray([
    80, 80, 80, 0,
    180, 180, 180, 255,
  ]), 2, 1);
  const encoded = encodeGB7(image);
  const decoded = decodeGB7(encoded.bytes.buffer);

  assert(encoded.hasMask && encoded.bytes[5] === 1, "флаг маски не установлен");
  assert((encoded.bytes[12] & 0x80) === 0, "прозрачный пиксель ошибочно отмечен как непрозрачный");
  assert((encoded.bytes[13] & 0x80) === 0x80, "непрозрачный пиксель потерял маску");
  assert(decoded.rgba[3] === 0 && decoded.rgba[7] === 255, "маска неверно декодирована");
});

await test("отклонение неверной сигнатуры", () => {
  const broken = new Uint8Array(13);
  let rejected = false;
  try {
    decodeGB7(broken.buffer);
  } catch (error) {
    rejected = error instanceof GB7Error;
  }
  assert(rejected, "повреждённый файл не был отклонён");
});

await test("отклонение неверной длины данных", () => {
  const image = new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);
  const encoded = encodeGB7(image).bytes;
  let rejected = false;
  try {
    decodeGB7(encoded.slice(0, -1).buffer);
  } catch (error) {
    rejected = error instanceof GB7Error;
  }
  assert(rejected, "обрезанный файл не был отклонён");
});

await test("отключение зелёного канала без изменения оригинала", () => {
  const original = new Uint8ClampedArray([10, 20, 30, 255]);
  const result = applyChannels(original, "rgba", new Set(["red", "blue", "alpha"]));

  assert(result[0] === 10 && result[1] === 0 && result[2] === 30 && result[3] === 255, "зелёный канал не отключён");
  assert(original[0] === 10 && original[1] === 20 && original[2] === 30, "оригинальные пиксели были изменены");
});

await test("альфа-канал отображается как чёрно-белая маска", () => {
  const original = new Uint8ClampedArray([
    200, 100, 50, 0,
    20, 40, 60, 192,
  ]);
  const result = applyChannels(original, "rgba", new Set(["alpha"]));

  assert(result[0] === 0 && result[1] === 0 && result[2] === 0 && result[3] === 255, "прозрачный пиксель маски неверен");
  assert(result[4] === 192 && result[5] === 192 && result[6] === 192 && result[7] === 255, "полупрозрачный пиксель маски неверен");
});

await test("CIELAB для чёрного и белого", () => {
  const black = rgbToLab(0, 0, 0);
  const white = rgbToLab(255, 255, 255);

  assertClose(black.l, 0, 0.01, "L* чёрного");
  assertClose(white.l, 100, 0.01, "L* белого");
  assertClose(white.a, 0, 0.02, "a* белого");
  assertClose(white.b, 0, 0.02, "b* белого");
});

await test("CIELAB и HEX для красного", () => {
  const red = rgbToLab(255, 0, 0);

  assertClose(red.l, 53.24, 0.05, "L* красного");
  assertClose(red.a, 80.09, 0.05, "a* красного");
  assertClose(red.b, 67.2, 0.05, "b* красного");
  assert(rgbToHex(255, 0, 0) === "#FF0000", "HEX красного неверен");
});

await test("единичная LUT уровней не меняет значения", () => {
  const lut255 = buildLevelsLut(createDefaultSettings(255), 255);
  const lut127 = buildLevelsLut(createDefaultSettings(127), 127);

  assert(lut255[0] === 0 && lut255[64] === 64 && lut255[255] === 255, "LUT для 8 бит не единичная");
  assert(lut127[0] === 0 && lut127[128] === 128 && lut127[255] === 255, "LUT для 7 бит не единичная");
});

await test("гамма осветляет и затемняет полутона", () => {
  const lighter = buildLevelsLut({ black: 0, gamma: 0.5, white: 255 });
  const darker = buildLevelsLut({ black: 0, gamma: 2, white: 255 });

  assert(lighter[128] > 128, "гамма меньше 1 не осветляет");
  assert(darker[128] < 128, "гамма больше 1 не затемняет");
  assertClose(positionToGamma(gammaToPosition(1, 0, 255), 0, 255), 1, 0.001, "позиция гаммы 1.0");
});

await test("Master меняет RGB, но не альфа-канал", () => {
  const original = new Uint8ClampedArray([64, 128, 192, 120]);
  const result = applyLevels(original, "rgba", {
    master: { black: 64, gamma: 1, white: 192 },
    red: createDefaultSettings(),
    green: createDefaultSettings(),
    blue: createDefaultSettings(),
    alpha: createDefaultSettings(),
  });

  assert(result[0] === 0 && result[2] === 255, "чёрная и белая точки Master неверны");
  assert(result[3] === 120, "Master изменил альфа-канал");
  assert(original[0] === 64 && original[3] === 120, "исходный массив уровней был изменён");
});

await test("настройки отдельного канала применяются независимо", () => {
  const original = new Uint8ClampedArray([100, 100, 100, 128]);
  const result = applyLevels(original, "rgba", {
    master: createDefaultSettings(),
    red: { black: 100, gamma: 1, white: 255 },
    green: createDefaultSettings(),
    blue: createDefaultSettings(),
    alpha: { black: 128, gamma: 1, white: 255 },
  });

  assert(result[0] === 0 && result[1] === 100 && result[2] === 100, "красный канал изменил соседние каналы");
  assert(result[3] === 0, "уровни альфа-канала не применились");
});

await test("гистограмма считает Master и Alpha", () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 0,
    255, 255, 255, 255,
  ]);
  const master = calculateHistogram(pixels, "master", 255);
  const alpha = calculateHistogram(pixels, "alpha", 255);

  assert(master[0] === 1 && master[255] === 1, "композитная гистограмма неверна");
  assert(alpha[0] === 1 && alpha[255] === 1, "гистограмма альфа-канала неверна");
});

const referenceFiles = [
  ["gradient-half-mask.gb7", 32, 32, true],
  ["kapibara-mask.gb7", 1200, 1010, true],
  ["vertical-kapibara.gb7", 1080, 1920, false],
];

for (const [fileName, width, height, hasMask] of referenceFiles) {
  await test(`пример ${fileName}`, async () => {
    const response = await fetch(`../${fileName}`);
    assert(response.ok, `HTTP ${response.status}`);
    const decoded = decodeGB7(await response.arrayBuffer());
    assert(decoded.width === width && decoded.height === height, "неверные размеры");
    assert(decoded.hasMask === hasMask, "неверное наличие маски");
  });
}

summary.textContent = failed === 0
  ? `Все проверки пройдены: ${passed}/${passed}`
  : `Пройдено: ${passed}; ошибок: ${failed}`;
summary.dataset.status = failed === 0 ? "passed" : "failed";
})();
