(() => {
  const windows = [];
  const prepared = new WeakSet();
  const positioned = new WeakSet();
  const INTERACTIVE = "button, input, select, textarea, a, label, [contenteditable], [role='button']";

  function openWindows() {
    return windows.filter((dialog) => dialog.open);
  }

  function updateStack() {
    const opened = openWindows();
    windows.forEach((dialog) => dialog.classList.remove("is-front-window"));
    opened.forEach((dialog, index) => {
      dialog.style.zIndex = String(10 + index);
      dialog.classList.toggle("is-front-window", index === opened.length - 1);
    });
  }

  function raise(dialog) {
    if (!dialog.open) return;
    const index = windows.indexOf(dialog);
    if (index !== -1) windows.splice(index, 1);
    windows.push(dialog);
    updateStack();
  }

  function viewport() {
    return {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: window.innerHeight,
      gap: 12,
    };
  }

  function move(dialog, left, top) {
    const view = viewport();
    const rect = dialog.getBoundingClientRect();
    const maxLeft = Math.max(view.gap, view.width - rect.width - view.gap);
    const maxTop = Math.max(view.gap, view.height - rect.height - view.gap);
    dialog.style.left = `${Math.round(Math.min(maxLeft, Math.max(view.gap, left)))}px`;
    dialog.style.top = `${Math.round(Math.min(maxTop, Math.max(view.gap, top)))}px`;
  }

  function initialPosition(dialog, slot) {
    const view = viewport();
    const width = dialog.getBoundingClientRect().width;
    const firstLeft = view.width >= 760 ? 76 : view.gap;
    const lastLeft = Math.max(firstLeft, view.width - width - view.gap);
    const fraction = Math.min(slot, 2) / 2;
    move(dialog, firstLeft + (lastLeft - firstLeft) * fraction, 76 + slot * 32);
    positioned.add(dialog);
  }

  function prepare(dialog) {
    if (prepared.has(dialog)) return;
    prepared.add(dialog);
    dialog.classList.add("tool-window");
    dialog.setAttribute("aria-modal", "false");
    dialog.addEventListener("pointerdown", () => raise(dialog));
    dialog.addEventListener("focusin", () => raise(dialog));

    const header = dialog.querySelector(".dialog-header");
    let drag = null;

    function endDrag() {
      if (!drag) return;
      const pointerId = drag.pointerId;
      drag = null;
      dialog.classList.remove("is-dragging");
      if (header?.hasPointerCapture(pointerId)) header.releasePointerCapture(pointerId);
    }

    dialog.addEventListener("close", () => {
      endDrag();
      updateStack();
    });

    if (!header) return;
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary || event.target.closest(INTERACTIVE)) return;
      event.preventDefault();
      raise(dialog);
      const rect = dialog.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
      };
      dialog.classList.add("is-dragging");
      header.setPointerCapture(event.pointerId);
    });
    header.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      move(dialog, drag.left + event.clientX - drag.startX, drag.top + event.clientY - drag.startY);
    });
    header.addEventListener("pointerup", endDrag);
    header.addEventListener("pointercancel", endDrag);
    header.addEventListener("lostpointercapture", endDrag);
  }

  function show(dialog) {
    prepare(dialog);
    if (dialog.open) {
      raise(dialog);
      return;
    }

    const slot = openWindows().length;
    dialog.show();
    if (!positioned.has(dialog)) initialPosition(dialog, slot);
    else {
      const rect = dialog.getBoundingClientRect();
      move(dialog, rect.left, rect.top);
    }
    raise(dialog);
  }

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
    const dialog = openWindows().at(-1);
    if (!dialog) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    const cancellation = new Event("cancel", { cancelable: true });
    if (dialog.dispatchEvent(cancellation)) dialog.close();
  }, true);

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      openWindows().forEach((dialog) => {
        const rect = dialog.getBoundingClientRect();
        move(dialog, rect.left, rect.top);
      });
    });
  });

  window.ToolWindows = Object.freeze({ show });
})();
