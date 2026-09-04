(async () => {
const { decodeGB7, encodeGB7, GB7Error } = window.GB7Codec;

const results = document.querySelector("#results");
const summary = document.querySelector("#summary");
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
