(() => {
const SIGNATURE = [0x47, 0x42, 0x37, 0x1d];
const HEADER_SIZE = 12;
const CURRENT_VERSION = 0x01;
const MASK_FLAG = 0x01;
const MAX_DECODED_PIXELS = 64_000_000;

class GB7Error extends Error {
  constructor(message) {
    super(message);
    this.name = "GB7Error";
  }
}

function hasSignature(bytes) {
  return SIGNATURE.every((value, index) => bytes[index] === value);
}

function isGB7(bytes) {
  return bytes.length >= SIGNATURE.length && hasSignature(bytes);
}

function decodeGB7(buffer) {
  const bytes = new Uint8Array(buffer);

  if (bytes.length < HEADER_SIZE) {
    throw new GB7Error("Файл GB7 короче обязательного 12-байтового заголовка.");
  }

  if (!hasSignature(bytes)) {
    throw new GB7Error("Неверная сигнатура GB7. Ожидались байты 47 42 37 1D.");
  }

  const version = bytes[4];
  const flags = bytes[5];

  if (version !== CURRENT_VERSION) {
    throw new GB7Error(`Версия GB7 ${version} не поддерживается. Ожидалась версия 1.`);
  }

  if ((flags & 0xfe) !== 0) {
    throw new GB7Error("В заголовке GB7 установлены зарезервированные биты флагов.");
  }

  const view = new DataView(buffer);
  const width = view.getUint16(6, false);
  const height = view.getUint16(8, false);
  const reserved = view.getUint16(10, false);
  const pixelCount = width * height;

  if (width === 0 || height === 0) {
    throw new GB7Error("Ширина и высота GB7 должны быть больше нуля.");
  }

  if (reserved !== 0) {
    throw new GB7Error("Зарезервированное поле заголовка GB7 должно быть равно 0.");
  }

  if (pixelCount > MAX_DECODED_PIXELS) {
    throw new GB7Error("Изображение слишком большое для безопасной обработки в браузере.");
  }

  const expectedLength = HEADER_SIZE + pixelCount;
  if (bytes.length !== expectedLength) {
    throw new GB7Error(`Размер файла не совпадает с заголовком: ожидалось ${expectedLength} байт, получено ${bytes.length}.`);
  }

  const hasMask = (flags & MASK_FLAG) === MASK_FLAG;
  const rgba = new Uint8ClampedArray(pixelCount * 4);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const packedPixel = bytes[HEADER_SIZE + pixelIndex];
    const gray7 = packedPixel & 0x7f;
    const gray8 = Math.round((gray7 * 255) / 127);
    const rgbaIndex = pixelIndex * 4;

    rgba[rgbaIndex] = gray8;
    rgba[rgbaIndex + 1] = gray8;
    rgba[rgbaIndex + 2] = gray8;
    rgba[rgbaIndex + 3] = hasMask ? ((packedPixel & 0x80) !== 0 ? 255 : 0) : 255;
  }

  return {
    width,
    height,
    version,
    hasMask,
    rgba,
  };
}

function encodeGB7(imageData) {
  const { width, height, data } = imageData;

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new GB7Error("Невозможно сохранить пустое изображение в GB7.");
  }

  if (width > 0xffff || height > 0xffff) {
    throw new GB7Error("GB7 поддерживает ширину и высоту не более 65535 пикселей.");
  }

  let hasMask = false;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) {
      hasMask = true;
      break;
    }
  }

  const pixelCount = width * height;
  const output = new Uint8Array(HEADER_SIZE + pixelCount);
  output.set(SIGNATURE, 0);
  output[4] = CURRENT_VERSION;
  output[5] = hasMask ? MASK_FLAG : 0;

  const header = new DataView(output.buffer);
  header.setUint16(6, width, false);
  header.setUint16(8, height, false);
  header.setUint16(10, 0, false);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    const red = data[rgbaIndex];
    const green = data[rgbaIndex + 1];
    const blue = data[rgbaIndex + 2];
    const alpha = data[rgbaIndex + 3];
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const gray7 = Math.round((luminance * 127) / 255) & 0x7f;
    const maskBit = hasMask && alpha >= 128 ? 0x80 : 0;

    output[HEADER_SIZE + pixelIndex] = gray7 | maskBit;
  }

  return {
    bytes: output,
    hasMask,
  };
}

window.GB7Codec = Object.freeze({ GB7Error, isGB7, decodeGB7, encodeGB7 });
})();
