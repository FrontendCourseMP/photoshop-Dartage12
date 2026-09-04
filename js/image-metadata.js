(() => {
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes, signature) {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function detectImageFormat(bytes) {
  if (startsWith(bytes, [0x47, 0x42, 0x37, 0x1d])) return "gb7";
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  return null;
}

function readRasterMetadata(bytes, format) {
  if (format === "png") return readPngMetadata(bytes);
  if (format === "jpeg") return readJpegMetadata(bytes);
  throw new Error("Неизвестный растровый формат.");
}

function readPngMetadata(bytes) {
  if (bytes.length < 29 || !startsWith(bytes, PNG_SIGNATURE)) {
    throw new Error("Повреждён заголовок PNG.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const channelsByColorType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByColorType[colorType];

  if (!channels || width === 0 || height === 0) {
    throw new Error("Заголовок PNG содержит неподдерживаемые параметры.");
  }

  const bitsPerPixel = bitDepth * channels;
  const depthLabel = colorType === 3
    ? `${bitDepth} бит (палитра)`
    : `${bitsPerPixel} бит (${bitDepth} бит/канал)`;

  return { width, height, bitDepth, channels, bitsPerPixel, depthLabel };
}

function readJpegMetadata(bytes) {
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
  ]);

  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;

    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 1 >= bytes.length) break;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];

    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      throw new Error("Повреждена структура сегментов JPEG.");
    }

    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 8) throw new Error("Повреждён заголовок JPEG.");

      const precision = bytes[offset + 2];
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const channels = bytes[offset + 7];
      const bitsPerPixel = precision * channels;

      return {
        width,
        height,
        bitDepth: precision,
        channels,
        bitsPerPixel,
        depthLabel: `${bitsPerPixel} бит (${precision} бит/канал)`,
      };
    }

    offset += segmentLength;
  }

  throw new Error("В JPEG не найден заголовок с размерами изображения.");
}

window.ImageMetadata = Object.freeze({ detectImageFormat, readRasterMetadata });
})();
