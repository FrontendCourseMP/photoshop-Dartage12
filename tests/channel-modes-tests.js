// Run with: node tests/channel-modes-tests.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({ window: {}, Uint8ClampedArray, Uint32Array, Set });
for (const filename of ["channels.js", "levels.js"]) {
  const source = fs.readFileSync(path.join(__dirname, "..", "js", filename), "utf8");
  vm.runInContext(source, context, { filename });
}

const { CHANNEL_MODES, listChannels, applyChannels, isolateChannel } = context.window.ImageChannels;
const { applyLevels, calculateHistogram } = context.window.ImageLevels;
let passed = 0;

function test(name, callback) {
  callback();
  passed += 1;
  console.log(`PASS: ${name}`);
}

function pixelsEqual(actual, expected) {
  assert.deepEqual(Array.from(actual), Array.from(expected));
}

const original = new Uint8ClampedArray([
  240, 40, 80, 0,
  20, 160, 220, 128,
  30, 220, 50, 255,
]);
const snapshot = new Uint8ClampedArray(original);
const grayValues = [85, 135, 167];

test("four mode definitions have the correct channel counts", () => {
  assert.equal(CHANNEL_MODES.length, 4);
  CHANNEL_MODES.forEach((mode, index) => {
    assert.equal(mode.count, index + 1);
    assert.equal(listChannels(mode.key).length, mode.count);
    assert.ok(Object.isFrozen(mode));
  });
  assert.ok(Object.isFrozen(CHANNEL_MODES));
});

for (const mode of CHANNEL_MODES) {
  test(`${mode.label} displays the expected color and alpha`, () => {
    const result = applyChannels(original, mode.key, listChannels(mode.key).map(({ key }) => key));
    const isGray = mode.key.startsWith("gray");
    const withAlpha = mode.key === "gray-alpha" || mode.key === "rgba";
    for (let pixel = 0; pixel < grayValues.length; pixel += 1) {
      const offset = pixel * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        assert.equal(result[offset + channel], isGray ? grayValues[pixel] : original[offset + channel]);
      }
      assert.equal(result[offset + 3], withAlpha ? original[offset + 3] : 255);
    }
    assert.notEqual(result, original);
    pixelsEqual(original, snapshot);
  });

  test(`${mode.label} identity Levels preserves source RGB and alpha`, () => {
    pixelsEqual(applyLevels(original, mode.key, {}), original);
    pixelsEqual(applyLevels(original, mode.key, {}, 127), original);
    pixelsEqual(original, snapshot);
  });
}

for (const mode of ["gray-alpha", "rgba"]) {
  test(`${mode} alpha-only view is an opaque grayscale mask`, () => {
    pixelsEqual(applyChannels(original, mode, ["alpha"]), [
      0, 0, 0, 255,
      128, 128, 128, 255,
      255, 255, 255, 255,
    ]);
  });
}

test("mode switches and hidden channels do not overwrite color or transparency", () => {
  applyChannels(original, "gray", ["gray"]);
  applyChannels(original, "rgb", ["red", "blue"]);
  const restored = applyChannels(original, "rgba", ["red", "green", "blue", "alpha"]);
  pixelsEqual(restored, snapshot);
});

test("grayscale thumbnail and histogram use the same displayed luminance", () => {
  const thumbnail = isolateChannel(original, "gray");
  const histogram = calculateHistogram(original, "gray");
  const sevenBitHistogram = calculateHistogram(original, "gray", 127);
  grayValues.forEach((gray, pixel) => {
    assert.equal(thumbnail[pixel * 4], gray);
    assert.equal(histogram[gray], 1);
    assert.equal(sevenBitHistogram[Math.round(gray / 255 * 127)], 1);
  });
  assert.equal(Array.from(histogram).reduce((sum, value) => sum + value, 0), 3);
});

test("grayscale correction applies its LUT equally to the stored RGB components", () => {
  const { buildLevelsLut } = context.window.ImageLevels;
  const settings = { black: 20, gamma: 0.75, white: 230 };
  const lut = buildLevelsLut(settings);
  const adjusted = applyLevels(original, "gray", { gray: settings });
  for (let index = 0; index < original.length; index += 1) {
    assert.equal(adjusted[index], index % 4 === 3 ? original[index] : lut[original[index]]);
  }
  pixelsEqual(original, snapshot);
});

test("alpha correction does not affect RGB and does not edit hidden alpha", () => {
  const settings = { alpha: { black: 128, gamma: 1, white: 255 } };
  for (const mode of ["rgb", "gray"]) {
    pixelsEqual(applyLevels(original, mode, settings), original);
  }
  for (const mode of ["rgba", "gray-alpha"]) {
    const adjusted = applyLevels(original, mode, settings);
    for (let index = 0; index < original.length; index += 1) {
      assert.equal(adjusted[index], index % 4 === 3 ? (original[index] === 255 ? 255 : 0) : original[index]);
    }
  }
});

console.log(`${passed} channel mode tests passed.`);
