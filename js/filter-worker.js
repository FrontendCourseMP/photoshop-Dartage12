importScripts("./filters.js");

self.addEventListener("message", (event) => {
  const { id, pixels, width, height, options } = event.data;

  try {
    const source = new Uint8ClampedArray(pixels);
    const result = self.ImageFilters.applyFilter(source, width, height, options, (progress) => {
      self.postMessage({ id, type: "progress", progress });
    });
    self.postMessage({ id, type: "done", pixels: result.buffer }, [result.buffer]);
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      message: error.message || "Не удалось применить фильтр.",
    });
  }
});
