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
const {
  METHODS,
  resizePixels,
  calculateFitScale,
  scaledDimensions,
} = window.ImageInterpolation;
const {
  PRESETS: FILTER_PRESETS,
  applyFilter,
  applyFilterAsync,
} = window.ImageFilters;

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

await test("ближайший сосед создаёт чёткие блоки пикселей", () => {
  const source = new Uint8ClampedArray([
    10, 0, 0, 255, 20, 0, 0, 255,
    30, 0, 0, 255, 40, 0, 0, 255,
  ]);
  const result = resizePixels(source, 2, 2, 4, 4, "nearest");
  const redAt = (x, y) => result[(y * 4 + x) * 4];

  assert(redAt(0, 0) === 10 && redAt(1, 1) === 10, "левый верхний пиксель размыт");
  assert(redAt(2, 0) === 20 && redAt(3, 1) === 20, "правый верхний пиксель неверен");
  assert(redAt(0, 2) === 30 && redAt(1, 3) === 30, "левый нижний пиксель неверен");
  assert(redAt(2, 2) === 40 && redAt(3, 3) === 40, "правый нижний пиксель неверен");
});

await test("билинейная интерполяция смешивает четыре соседних пикселя", () => {
  const source = new Uint8ClampedArray([
    0, 0, 0, 255, 100, 100, 100, 255,
    200, 200, 200, 255, 100, 100, 100, 255,
  ]);
  const result = resizePixels(source, 2, 2, 3, 3, "bilinear");
  const center = (1 * 3 + 1) * 4;

  assert(result[center] === 100 && result[center + 1] === 100, "центр не равен среднему четырёх пикселей");
  assert(result[center + 3] === 255, "альфа-канал центра изменился");
});

await test("билинейная интерполяция обрабатывает альфа-канал", () => {
  const source = new Uint8ClampedArray([
    50, 50, 50, 0,
    50, 50, 50, 255,
  ]);
  const result = resizePixels(source, 2, 1, 3, 1, "bilinear");

  assert(result[7] === 128, `ожидалась альфа 128, получено ${result[7]}`);
});

await test("масштабирование не изменяет исходный массив", () => {
  const source = new Uint8ClampedArray([12, 34, 56, 78]);
  const result = resizePixels(source, 1, 1, 2, 2);

  result[0] = 255;
  assert(source[0] === 12, "исходный массив пикселей был изменён");
  assert(METHODS.bilinear.label === "Билинейная", "билинейный метод не зарегистрирован");
  assert(METHODS.nearest.label === "Ближайший сосед", "метод ближайшего соседа не зарегистрирован");
});

await test("вписывание учитывает отступ 50 px и диапазон 12–300%", () => {
  const regular = calculateFitScale(1000, 500, 700, 500, 50);
  const tiny = calculateFitScale(10, 10, 1000, 800, 50);
  const huge = calculateFitScale(10000, 10000, 500, 500, 50);
  const dimensions = scaledDimensions(100, 80, 1.5);

  assertClose(regular, 0.6, 0.0001, "масштаб с отступами");
  assert(tiny === 3, "масштаб маленького изображения должен быть ограничен 300%");
  assert(huge === 0.12, "масштаб большого изображения должен быть ограничен 12%");
  assert(dimensions.width === 150 && dimensions.height === 120, "размер отображения рассчитан неверно");
});

await test("неизвестный метод интерполяции отклоняется", () => {
  let rejected = false;
  try {
    resizePixels(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1, 2, 2, "unknown");
  } catch (error) {
    rejected = error instanceof TypeError;
  }
  assert(rejected, "неизвестный метод не был отклонён");
});

await test("набор фильтров содержит все заданные предустановки", () => {
  const required = ["identity", "sharpen", "gaussian", "boxBlur", "prewittX", "prewittY", "median"];
  assert(required.every((key) => FILTER_PRESETS[key]), "одна из предустановок отсутствует");
  const gaussianSum = FILTER_PRESETS.gaussian.kernel.reduce((sum, value) => sum + value, 0);
  assertClose(gaussianSum, 1, 0.000001, "сумма ядра Гаусса");
});

await test("тождественный фильтр сохраняет изображение и оригинал", () => {
  const source = new Uint8ClampedArray([12, 34, 56, 78]);
  const result = applyFilter(source, 1, 1, {
    type: "kernel",
    kernel: [...FILTER_PRESETS.identity.kernel],
    channels: [0, 1, 2, 3],
    edge: "copy",
  });

  assert(result.every((value, index) => value === source[index]), "тождественное ядро изменило пиксели");
  result[0] = 255;
  assert(source[0] === 12, "фильтр изменил исходный массив");
});

await test("повышение резкости корректно обрабатывает центральный пиксель", () => {
  const source = new Uint8ClampedArray(3 * 3 * 4);
  for (let index = 0; index < source.length; index += 4) {
    source[index] = 10;
    source[index + 1] = 30;
    source[index + 2] = 40;
    source[index + 3] = 200;
  }
  source[(1 * 3 + 1) * 4] = 20;
  const result = applyFilter(source, 3, 3, {
    type: "kernel",
    kernel: [...FILTER_PRESETS.sharpen.kernel],
    channels: [0],
    edge: "copy",
  });
  const center = (1 * 3 + 1) * 4;

  assert(result[center] === 60, `ожидалось значение 60, получено ${result[center]}`);
  assert(result[center + 1] === 30 && result[center + 3] === 200, "фильтр изменил невыбранные каналы");
});

await test("стратегии края дают разные результаты", () => {
  const source = new Uint8ClampedArray([90, 90, 90, 255]);
  const options = {
    type: "kernel",
    kernel: [...FILTER_PRESETS.boxBlur.kernel],
    channels: [0],
  };
  const black = applyFilter(source, 1, 1, { ...options, edge: "black" });
  const white = applyFilter(source, 1, 1, { ...options, edge: "white" });
  const copy = applyFilter(source, 1, 1, { ...options, edge: "copy" });

  assert(black[0] === 10, `чёрное заполнение: ${black[0]}`);
  assert(white[0] === 237, `белое заполнение: ${white[0]}`);
  assert(copy[0] === 90, `копирование края: ${copy[0]}`);
});

await test("операторы Прюитта находят направление границы", () => {
  const source = new Uint8ClampedArray(3 * 3 * 4);
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      const index = (y * 3 + x) * 4;
      source[index] = x * 50;
      source[index + 3] = 255;
    }
  }
  const options = { type: "kernel", channels: [0], edge: "copy" };
  const horizontal = applyFilter(source, 3, 3, {
    ...options,
    kernel: [...FILTER_PRESETS.prewittX.kernel],
  });
  const vertical = applyFilter(source, 3, 3, {
    ...options,
    kernel: [...FILTER_PRESETS.prewittY.kernel],
  });
  const center = (1 * 3 + 1) * 4;

  assert(horizontal[center] === 255, "Прюитт X не обнаружил вертикальную границу");
  assert(vertical[center] === 0, "Прюитт Y обнаружил несуществующую горизонтальную границу");
});

await test("медианный фильтр удаляет одиночный шум", () => {
  const source = new Uint8ClampedArray(3 * 3 * 4);
  for (let index = 0; index < source.length; index += 4) {
    source[index] = 10;
    source[index + 1] = 40;
    source[index + 3] = 255;
  }
  source[(1 * 3 + 1) * 4] = 255;
  const result = applyFilter(source, 3, 3, {
    type: "median",
    kernel: [...FILTER_PRESETS.median.kernel],
    channels: [0],
    edge: "copy",
  });
  const center = (1 * 3 + 1) * 4;

  assert(result[center] === 10, "медианный фильтр не удалил импульсный шум");
  assert(result[center + 1] === 40, "медианный фильтр изменил невыбранный канал");
});

await test("асинхронная фильтрация возвращает тот же результат", async () => {
  const source = new Uint8ClampedArray([
    0, 0, 0, 255, 90, 90, 90, 255,
    180, 180, 180, 255, 255, 255, 255, 255,
  ]);
  const options = {
    type: "kernel",
    kernel: [...FILTER_PRESETS.gaussian.kernel],
    channels: [0, 1, 2],
    edge: "copy",
  };
  const expected = applyFilter(source, 2, 2, options);
  let progress = 0;
  const actual = await applyFilterAsync(source, 2, 2, options, {
    chunkRows: 1,
    onProgress: (value) => { progress = value; },
  });

  assert(actual.every((value, index) => value === expected[index]), "асинхронный результат отличается");
  assert(progress === 1, "асинхронная обработка не завершила прогресс");
});

await test("некорректное ядро и пустой список каналов отклоняются", () => {
  const source = new Uint8ClampedArray([0, 0, 0, 255]);
  let invalidKernel = false;
  let emptyChannels = false;
  try {
    applyFilter(source, 1, 1, { type: "kernel", kernel: [1], channels: [0], edge: "copy" });
  } catch (error) {
    invalidKernel = error instanceof TypeError;
  }
  try {
    applyFilter(source, 1, 1, {
      type: "kernel",
      kernel: [...FILTER_PRESETS.identity.kernel],
      channels: [],
      edge: "copy",
    });
  } catch (error) {
    emptyChannels = error instanceof TypeError;
  }
  assert(invalidKernel && emptyChannels, "некорректные параметры фильтра не были отклонены");
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
