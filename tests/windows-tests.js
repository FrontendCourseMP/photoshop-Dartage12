(async () => {
  const frame = document.querySelector('#editor');
  const errors = [];
  let passed = 0;
  let failed = 0;
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  frame.src = '../index.html';
  await loaded;
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  win.addEventListener('error', (event) => errors.push(event.message));
  win.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
  const $ = (selector) => doc.querySelector(selector);
  const click = (selector) => $(selector).click();
  const tick = () => new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
  const pixels = () => {
    const canvas = $('#image-canvas');
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  };
  const set = (selector, value, event = 'input') => {
    $(selector).value = String(value);
    $(selector).dispatchEvent(new win.Event(event, { bubbles: true }));
  };
  async function waitFor(predicate) {
    const deadline = performance.now() + 6000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error('Истекло время ожидания');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await tick();
  }
  async function test(name, callback) {
    const item = document.createElement('li');
    try {
      await callback();
      passed += 1;
      item.className = 'pass';
      item.textContent = `PASS: ${name}`;
    } catch (error) {
      failed += 1;
      item.className = 'fail';
      item.textContent = `FAIL: ${name}: ${error.message}`;
    }
    document.querySelector('#results').append(item);
    document.querySelector('#summary').textContent = `${passed} успешно, ${failed} ошибок`;
  }
  async function loadImage(width = 32, height = 16, name = 'test.png') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgb(80 120 160)';
    ctx.fillRect(0, 0, width, height);
    ctx.clearRect(width / 2, 0, width / 2, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    const transfer = new win.DataTransfer();
    transfer.items.add(new win.File([blob], name, { type: 'image/png' }));
    $('#file-input').files = transfer.files;
    $('#file-input').dispatchEvent(new win.Event('change', { bubbles: true }));
    await waitFor(() => $('#current-file').textContent === name && !$('#open-button').disabled);
    click('#actual-size-button');
    await tick();
  }
  function openAll() {
    click('#levels-button');
    click('#resize-button');
    click('#filter-button');
  }
  await test('Загрузка цветного PNG с прозрачностью', async () => {
    await loadImage();
    assert(pixels()[0] === 80 && pixels()[3] === 255, 'Не совпал исходный пиксель');
  });
  const source = pixels();
  await test('Четыре режима, миниатюры и возврат исходного цвета', async () => {
    assert(doc.querySelectorAll('.channel-mode canvas').length === 4, 'Нет четырёх миниатюр');
    for (const [mode, count, gray, alpha] of [
      ['gray', 1, true, false], ['gray-alpha', 2, true, true],
      ['rgb', 3, false, false], ['rgba', 4, false, true],
    ]) {
      click(`[data-mode="${mode}"]`);
      await tick();
      assert(doc.querySelectorAll('#channel-list button').length === count, 'Неверное число каналов');
      assert($(`[data-mode="${mode}"]`).getAttribute('aria-pressed') === 'true', 'Режим не отмечен');
      const p = pixels();
      assert(gray ? p[0] === p[1] && p[1] === p[2] : p[0] === 80 && p[2] === 160, 'Неверный цвет');
      assert(p[16 * 4 + 3] === (alpha ? 0 : 255), 'Неверная прозрачность');
    }
    assert(equal(source, pixels()), 'Переключение испортило оригинал');
  });
  await test('Три немодальных окна и действующие элементы страницы', async () => {
    openAll();
    await tick();
    assert(doc.querySelectorAll('dialog[open]').length === 3, 'Открылись не все окна');
    assert(!doc.querySelector('dialog:modal'), 'Есть блокирующее модальное окно');
    click('#eyedropper-button');
    const rect = $('#image-canvas').getBoundingClientRect();
    $('#image-canvas').dispatchEvent(new win.MouseEvent('pointerdown', { button: 0, clientX: rect.left + 2, clientY: rect.top + 2, bubbles: true }));
    assert(!$('#color-readout').hidden && $('#color-rgb').textContent === '80, 120, 160', 'Пипетка не работает');
    click('#zoom-out');
    await tick();
    assert($('#zoom-range').value === '80', 'Масштаб заблокирован');
    click('#actual-size-button');
    assert(!$('#open-button').disabled && !$('#download-button').disabled, 'Открытие/экспорт заблокированы');
  });
  await test('Предпросмотр, отключение и отмена не портят оригинал', async () => {
    set('#level-gamma-value', 2);
    await tick();
    assert(pixels()[0] < source[0], 'Нет предпросмотра уровней');
    click('#levels-preview');
    assert(equal(source, pixels()), 'До/после не вернуло оригинал');
    click('#levels-preview');
    await tick();
    const levelPreview = pixels();
    click('#filter-close');
    assert(equal(levelPreview, pixels()), 'Закрытие другого окна стёрло предпросмотр');
    click('#levels-cancel');
    assert(equal(source, pixels()), 'Отмена изменила оригинал');
  });
  await test('Применение уровней затем открытого identity-фильтра сохраняет правку', async () => {
    click('#levels-button');
    click('#filter-button');
    set('#level-gamma-value', 2);
    await tick();
    const expected = pixels();
    click('#levels-apply');
    assert($('#filter-dialog').open && $('#resize-dialog').open, 'Соседние окна закрылись');
    click('#filter-apply');
    await waitFor(() => !$('#filter-dialog').open);
    assert(equal(expected, pixels()), 'Фильтр восстановил старые пиксели');
  });
  await test('Применение фильтра затем открытых identity-уровней сохраняет правку', async () => {
    click('#levels-button');
    click('#filter-button');
    set('.kernel-input:nth-child(5)', 0.5);
    click('#filter-apply');
    await waitFor(() => !$('#filter-dialog').open);
    const expected = pixels();
    click('#levels-apply');
    assert(equal(expected, pixels()), 'Уровни восстановили старые пиксели');
  });
  await test('Resize обновляет базы обоих открытых инструментов', async () => {
    click('#levels-button');
    click('#filter-button');
    set('#resize-width', 16);
    click('#resize-apply');
    await waitFor(() => $('#property-dimensions').textContent === '16 × 8 px' && !$('#open-button').disabled);
    assert($('#levels-dialog').open && $('#filter-dialog').open, 'Коррекции закрылись');
    click('#levels-apply');
    click('#filter-apply');
    await waitFor(() => !$('#filter-dialog').open);
    assert($('#image-canvas').width === 16 && $('#image-canvas').height === 8, 'Вернулся старый размер');
  });
  await test('Смена режима при открытых окнах синхронизирует каналы', async () => {
    openAll();
    click('[data-mode="gray-alpha"]');
    assert([...$('#levels-channel').options].some((o) => o.value === 'gray'), 'Нет Gray в уровнях');
    assert($('#filter-channels').textContent.includes('Серый'), 'Нет Gray в фильтрах');
    click('[data-mode="rgba"]');
    assert([...$('#levels-channel').options].some((o) => o.value === 'red'), 'Не вернулся RGB');
  });
  await test('Escape закрывает только верхнее окно', async () => {
    const before = doc.querySelectorAll('dialog[open]').length;
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert(doc.querySelectorAll('dialog[open]').length === before - 1, 'Escape закрыл не одно окно');
  });
  await test('Новый файл отменяет старые сессии и расчёт фильтра', async () => {
    click('#filter-button');
    set('#filter-preset', 'gaussian', 'change');
    await loadImage(24, 12, 'replacement.png');
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert(!doc.querySelector('dialog[open]'), 'Остался инструмент старого файла');
    assert($('#image-canvas').width === 24 && pixels()[0] === 80, 'Старый результат заменил новый файл');
  });
  await test('Асинхронный фильтр работает без Worker', async () => {
    const Worker = win.Worker;
    try {
      win.Worker = undefined;
      click('#filter-button');
      set('.kernel-input:nth-child(5)', 0.5);
      click('#filter-apply');
      await waitFor(() => !$('#filter-dialog').open);
      assert(Math.abs(pixels()[0] - 40) <= 1, 'Резервный расчёт не применился');
    } finally {
      win.Worker = Worker;
    }
  });
  await test('Отключённый канал остаётся отключённым после применения', async () => {
    click('[data-channel="green"]');
    click('#levels-button');
    click('#levels-apply');
    assert($('[data-channel="green"]').getAttribute('aria-pressed') === 'false', 'Состояние канала сбросилось');
    assert(pixels()[1] === 0, 'Зелёный вернулся на холст');
  });
  await test('Миниатюры без Alpha показывают скрытые маской значения GB7', async () => {
    const input = new win.ImageData(new win.Uint8ClampedArray([255, 255, 255, 0, 100, 100, 100, 255]), 2, 1);
    const encoded = win.GB7Codec.encodeGB7(input);
    const transfer = new win.DataTransfer();
    transfer.items.add(new win.File([encoded.bytes], 'hidden-color.gb7'));
    $('#file-input').files = transfer.files;
    $('#file-input').dispatchEvent(new win.Event('change', { bubbles: true }));
    await waitFor(() => $('#current-file').textContent === 'hidden-color.gb7');
    const canvas = $('[data-mode="gray"] canvas');
    assert(canvas.getContext('2d').getImageData(22, 24, 1, 1).data[0] === 255, 'Потерян скрытый цвет миниатюры');
  });
  await test('Окна остаются в границах узкого экрана', async () => {
    openAll();
    frame.style.width = '320px';
    await tick();
    for (const dialog of doc.querySelectorAll('dialog[open]')) {
      const rect = dialog.getBoundingClientRect();
      assert(rect.left >= 0 && rect.right <= 320 && rect.top >= 0 && rect.bottom <= win.innerHeight, 'Окно вышло за экран');
    }
    frame.style.width = '100%';
  });
  await test('Нет ошибок JavaScript', () => assert(errors.length === 0, errors.join('; ')));
})().catch((error) => {
  document.querySelector('#summary').textContent = `Ошибка тестового стенда: ${error.message}`;
});
