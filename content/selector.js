// WebSnaps - Selection Overlay Content Script
(function () {
  if (window.__websnapsInjected) return;
  window.__websnapsInjected = true;

  let overlay = null;
  let selectionBox = null;
  let dimLabel = null;
  let confirmPanel = null;

  // State: 'idle' | 'dragging' | 'selected' | 'resizing' | 'moving'
  let state = 'idle';
  let currentRect = null; // { x, y, w, h }
  let currentMode = 'drag';
  let hoveredEl = null;

  // Drag state
  let dragStartX = 0, dragStartY = 0;

  // Resize / move state
  let activeHandle = null;
  let handleStartRect = null;
  let handleStartMX = 0, handleStartMY = 0;

  // ── Overlay creation ────────────────────────────────────────────────────────

  function createOverlay() {
    if (document.getElementById('__websnaps-overlay')) return;

    overlay = document.createElement('div');
    overlay.id = '__websnaps-overlay';

    const toolbar = document.createElement('div');
    toolbar.className = '__ws-toolbar';
    toolbar.innerHTML = `
      <div class="__ws-logo">WebSnaps</div>
      <div class="__ws-divider"></div>
      <button class="__ws-mode-btn __ws-active" data-mode="drag">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
        </svg>
        矩形選択
      </button>
      <button class="__ws-mode-btn" data-mode="element">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>
        要素選択
      </button>
      <div class="__ws-divider"></div>
      <span class="__ws-hint">ドラッグで選択</span>
      <div class="__ws-divider"></div>
      <button class="__ws-cancel-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        Esc
      </button>
    `;

    // Selection box
    selectionBox = document.createElement('div');
    selectionBox.className = '__ws-selection';

    // 8 resize handles
    ['nw','n','ne','e','se','s','sw','w'].forEach(h => {
      const el = document.createElement('div');
      el.className = `__ws-handle __ws-handle-${h}`;
      el.dataset.handle = h;
      selectionBox.appendChild(el);
    });

    // Move area (interior of selection box)
    const moveArea = document.createElement('div');
    moveArea.className = '__ws-move-area';
    selectionBox.appendChild(moveArea);

    const rulerH = document.createElement('div');
    rulerH.className = '__ws-ruler __ws-ruler-h';
    const rulerV = document.createElement('div');
    rulerV.className = '__ws-ruler __ws-ruler-v';

    dimLabel = document.createElement('div');
    dimLabel.className = '__ws-dim-label';

    const mask = document.createElement('div');
    mask.className = '__ws-mask';

    // Confirm panel (W / H inputs + capture button)
    confirmPanel = document.createElement('div');
    confirmPanel.className = '__ws-confirm-panel';
    confirmPanel.style.display = 'none';
    confirmPanel.innerHTML = `
      <div class="__ws-size-row">
        <label class="__ws-size-field">
          <span class="__ws-size-label">W</span>
          <input class="__ws-size-input" id="__ws-w-input" type="number" min="1" step="1">
        </label>
        <span class="__ws-size-sep">×</span>
        <label class="__ws-size-field">
          <span class="__ws-size-label">H</span>
          <input class="__ws-size-input" id="__ws-h-input" type="number" min="1" step="1">
        </label>
        <span class="__ws-size-unit">px</span>
      </div>
      <button class="__ws-capture-btn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        キャプチャ
      </button>
    `;

    overlay.appendChild(mask);
    overlay.appendChild(toolbar);
    overlay.appendChild(rulerH);
    overlay.appendChild(rulerV);
    overlay.appendChild(selectionBox);
    overlay.appendChild(dimLabel);
    overlay.appendChild(confirmPanel);
    document.documentElement.appendChild(overlay);

    // ── Event listeners ──────────────────────────────────────────────────────

    toolbar.querySelectorAll('.__ws-mode-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        toolbar.querySelectorAll('.__ws-mode-btn').forEach(b => b.classList.remove('__ws-active'));
        btn.classList.add('__ws-active');
        currentMode = btn.dataset.mode;
        updateHint();
        overlay.classList.toggle('__ws-element-mode', currentMode === 'element');
        exitSelected();
      });
    });

    toolbar.querySelector('.__ws-cancel-btn').addEventListener('click', e => {
      e.stopPropagation();
      cleanup();
    });
    toolbar.addEventListener('mousedown', e => e.stopPropagation());

    // Resize handles
    selectionBox.querySelectorAll('.__ws-handle').forEach(handle => {
      handle.addEventListener('mousedown', e => {
        if (state !== 'selected') return;
        e.stopPropagation();
        e.preventDefault();
        activeHandle = handle.dataset.handle;
        handleStartRect = { ...currentRect };
        handleStartMX = e.clientX;
        handleStartMY = e.clientY;
        state = 'resizing';
      });
    });

    // Move area
    moveArea.addEventListener('mousedown', e => {
      if (state !== 'selected') return;
      e.stopPropagation();
      e.preventDefault();
      activeHandle = 'move';
      handleStartRect = { ...currentRect };
      handleStartMX = e.clientX;
      handleStartMY = e.clientY;
      state = 'moving';
    });

    // Confirm panel
    confirmPanel.addEventListener('mousedown', e => e.stopPropagation());
    confirmPanel.addEventListener('click', e => e.stopPropagation());

    const wInput = confirmPanel.querySelector('#__ws-w-input');
    const hInput = confirmPanel.querySelector('#__ws-h-input');

    wInput.addEventListener('change', () => {
      if (!currentRect) return;
      const v = parseInt(wInput.value);
      if (!isNaN(v) && v >= 1) { currentRect.w = v; applyRect(); }
    });
    hInput.addEventListener('change', () => {
      if (!currentRect) return;
      const v = parseInt(hInput.value);
      if (!isNaN(v) && v >= 1) { currentRect.h = v; applyRect(); }
    });

    confirmPanel.querySelector('.__ws-capture-btn').addEventListener('click', e => {
      e.stopPropagation();
      performCapture();
    });

    overlay.addEventListener('mousedown', onMouseDown);
    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown, true);
  }

  // ── State transitions ────────────────────────────────────────────────────────

  function enterSelected(rect) {
    currentRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    state = 'selected';
    selectionBox.classList.add('__ws-has-selection');
    applyRect();
    confirmPanel.style.display = 'flex';
    positionConfirmPanel();
    updateHint('調整してキャプチャ（Enter）');
  }

  function exitSelected() {
    state = 'idle';
    currentRect = null;
    hoveredEl = null;
    selectionBox.style.display = 'none';
    selectionBox.classList.remove('__ws-has-selection');
    dimLabel.style.display = 'none';
    confirmPanel.style.display = 'none';
    resetMask();
    updateHint();
  }

  function performCapture() {
    if (!currentRect) return;
    const captureRect = {
      x: currentRect.x,
      y: currentRect.y,
      width:  currentRect.w,
      height: currentRect.h,
      devicePixelRatio: window.devicePixelRatio || 1
    };
    // オーバーレイを先に非表示にし、ブラウザが再描画する2フレーム後にメッセージ送信
    if (overlay) overlay.style.visibility = 'hidden';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        cleanup();
        chrome.runtime.sendMessage({ type: 'SELECTION_COMPLETE', rect: captureRect });
      });
    });
  }

  // ── Mouse handlers ───────────────────────────────────────────────────────────

  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.__ws-toolbar, .__ws-confirm-panel, .__ws-handle, .__ws-move-area')) return;

    if (state === 'selected') {
      // Clicking outside the selection resets it
      exitSelected();
    }

    if (currentMode === 'element') {
      // Select the hovered element and enter confirm mode
      if (hoveredEl) {
        const r = hoveredEl.getBoundingClientRect();
        enterSelected({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      return;
    }

    // Start drag
    state = 'dragging';
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    e.preventDefault();
  }

  function onMouseMove(e) {
    const mx = e.clientX;
    const my = e.clientY;

    // Rulers
    const rulerH = overlay.querySelector('.__ws-ruler-h');
    const rulerV = overlay.querySelector('.__ws-ruler-v');
    if (rulerH) rulerH.style.top = my + 'px';
    if (rulerV) rulerV.style.left = mx + 'px';

    if (state === 'dragging') {
      const x = Math.min(dragStartX, mx);
      const y = Math.min(dragStartY, my);
      const w = Math.abs(mx - dragStartX);
      const h = Math.abs(my - dragStartY);
      showSelectionBox(x, y, w, h);
      showDimLabel(w, h, x, y);
      updateMask(x, y, w, h);
      return;
    }

    if (state === 'resizing' && activeHandle && handleStartRect) {
      const dx = mx - handleStartMX;
      const dy = my - handleStartMY;
      const r = computeResizedRect(activeHandle, dx, dy, handleStartRect);
      if (r.w >= 5 && r.h >= 5) {
        currentRect = r;
        applyRect();
      }
      return;
    }

    if (state === 'moving' && handleStartRect) {
      currentRect = {
        x: handleStartRect.x + (mx - handleStartMX),
        y: handleStartRect.y + (my - handleStartMY),
        w: handleStartRect.w,
        h: handleStartRect.h
      };
      applyRect();
      return;
    }

    if (currentMode === 'element' && state === 'idle') {
      overlay.style.pointerEvents = 'none';
      const el = document.elementFromPoint(mx, my);
      overlay.style.pointerEvents = '';
      if (el && !overlay.contains(el) && el !== document.documentElement && el !== document.body) {
        hoveredEl = el;
        const r = el.getBoundingClientRect();
        showSelectionBox(r.left, r.top, r.width, r.height);
        showDimLabel(r.width, r.height, r.left, r.top);
        updateMask(r.left, r.top, r.width, r.height);
      }
    }
  }

  function onMouseUp(e) {
    if (state === 'dragging') {
      const x = Math.min(dragStartX, e.clientX);
      const y = Math.min(dragStartY, e.clientY);
      const w = Math.abs(e.clientX - dragStartX);
      const h = Math.abs(e.clientY - dragStartY);
      if (w < 5 || h < 5) { exitSelected(); return; }
      enterSelected({ x, y, w, h });
      return;
    }
    if (state === 'resizing' || state === 'moving') {
      state = 'selected';
      activeHandle = null;
      updateConfirmInputs();
      positionConfirmPanel();
    }
  }

  function onKeyDown(e) {
    // Don't intercept events when typing in inputs
    if (e.target.closest('.__ws-confirm-panel')) return;

    if (e.key === 'Escape') {
      if (state === 'selected') { exitSelected(); }
      else { cleanup(); }
    }
    if (e.key === 'Enter' && state === 'selected') {
      e.preventDefault();
      performCapture();
    }
  }

  // ── Rect helpers ─────────────────────────────────────────────────────────────

  function computeResizedRect(handle, dx, dy, r) {
    switch (handle) {
      case 'nw': return { x: r.x+dx, y: r.y+dy, w: r.w-dx, h: r.h-dy };
      case 'n':  return { x: r.x,    y: r.y+dy, w: r.w,    h: r.h-dy };
      case 'ne': return { x: r.x,    y: r.y+dy, w: r.w+dx, h: r.h-dy };
      case 'e':  return { x: r.x,    y: r.y,    w: r.w+dx, h: r.h    };
      case 'se': return { x: r.x,    y: r.y,    w: r.w+dx, h: r.h+dy };
      case 's':  return { x: r.x,    y: r.y,    w: r.w,    h: r.h+dy };
      case 'sw': return { x: r.x+dx, y: r.y,    w: r.w-dx, h: r.h+dy };
      case 'w':  return { x: r.x+dx, y: r.y,    w: r.w-dx, h: r.h    };
    }
    return r;
  }

  function applyRect() {
    if (!currentRect) return;
    const { x, y, w, h } = currentRect;
    showSelectionBox(x, y, w, h);
    showDimLabel(w, h, x, y);
    updateMask(x, y, w, h);
    updateConfirmInputs();
    if (state === 'selected' || state === 'resizing' || state === 'moving') {
      positionConfirmPanel();
    }
  }

  function updateConfirmInputs() {
    if (!currentRect || !confirmPanel) return;
    const wEl = confirmPanel.querySelector('#__ws-w-input');
    const hEl = confirmPanel.querySelector('#__ws-h-input');
    if (wEl) wEl.value = Math.round(currentRect.w);
    if (hEl) hEl.value = Math.round(currentRect.h);
  }

  function positionConfirmPanel() {
    if (!currentRect) return;
    const { x, y, w, h } = currentRect;
    const panelW = 300;
    let px = x + w / 2 - panelW / 2;
    let py = y + h + 12;
    px = Math.max(8, Math.min(px, window.innerWidth - panelW - 8));
    if (py + 52 > window.innerHeight) py = y - 52 - 12;
    confirmPanel.style.left = px + 'px';
    confirmPanel.style.top  = py + 'px';
  }

  // ── Rendering helpers ────────────────────────────────────────────────────────

  function showSelectionBox(x, y, w, h) {
    selectionBox.style.cssText = `
      display: block !important;
      left: ${x}px !important;
      top: ${y}px !important;
      width: ${w}px !important;
      height: ${h}px !important;
    `;
  }

  function showDimLabel(w, h, x, y) {
    dimLabel.textContent = `${Math.round(w)} × ${Math.round(h)}`;
    dimLabel.style.display = 'block';
    dimLabel.style.left = Math.max(4, x + w / 2 - 35) + 'px';
    dimLabel.style.top  = Math.max(4, y - 26) + 'px';
  }

  function updateMask(x, y, w, h) {
    const mask = overlay.querySelector('.__ws-mask');
    if (!mask) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    mask.style.clipPath = `polygon(
      0 0, ${vw}px 0, ${vw}px ${vh}px, 0 ${vh}px, 0 0,
      ${x}px ${y}px, ${x}px ${y+h}px, ${x+w}px ${y+h}px, ${x+w}px ${y}px, ${x}px ${y}px
    )`;
  }

  function resetMask() {
    const mask = overlay.querySelector('.__ws-mask');
    if (mask) mask.style.clipPath = '';
  }

  function updateHint(text) {
    const hint = overlay && overlay.querySelector('.__ws-hint');
    if (!hint) return;
    if (text) { hint.textContent = text; return; }
    if (currentMode === 'element') hint.textContent = '要素をクリック';
    else hint.textContent = 'ドラッグで選択';
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  function cleanup() {
    window.__websnapsInjected = false;
    if (overlay) overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onKeyDown, true);
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'START_SELECTION' && !document.getElementById('__websnaps-overlay')) {
      createOverlay();
    }
  });

  createOverlay();
})();
