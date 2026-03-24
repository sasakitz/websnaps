// WebSnaps - Selection Overlay Content Script
(function () {
  if (window.__websnapsInjected) return;
  window.__websnapsInjected = true;

  let overlay = null;
  let selectionBox = null;
  let dimLabel = null;
  let isDragging = false;
  let startX = 0, startY = 0, curX = 0, curY = 0;
  let currentMode = 'drag';
  let hoveredEl = null;

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

    selectionBox = document.createElement('div');
    selectionBox.className = '__ws-selection';

    const rulerH = document.createElement('div');
    rulerH.className = '__ws-ruler __ws-ruler-h';
    const rulerV = document.createElement('div');
    rulerV.className = '__ws-ruler __ws-ruler-v';

    dimLabel = document.createElement('div');
    dimLabel.className = '__ws-dim-label';

    const mask = document.createElement('div');
    mask.className = '__ws-mask';

    overlay.appendChild(mask);
    overlay.appendChild(toolbar);
    overlay.appendChild(rulerH);
    overlay.appendChild(rulerV);
    overlay.appendChild(selectionBox);
    overlay.appendChild(dimLabel);
    document.documentElement.appendChild(overlay);

    toolbar.querySelectorAll('.__ws-mode-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        toolbar.querySelectorAll('.__ws-mode-btn').forEach(b => b.classList.remove('__ws-active'));
        btn.classList.add('__ws-active');
        currentMode = btn.dataset.mode;
        updateHint();
        overlay.classList.toggle('__ws-element-mode', currentMode === 'element');
        resetMask();
        selectionBox.style.display = 'none';
        dimLabel.style.display = 'none';
        hoveredEl = null;
      });
    });

    toolbar.querySelector('.__ws-cancel-btn').addEventListener('click', e => {
      e.stopPropagation();
      cleanup();
    });

    overlay.addEventListener('mousedown', onMouseDown);
    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown, true);

    // Prevent toolbar clicks from propagating
    toolbar.addEventListener('mousedown', e => e.stopPropagation());
  }

  function updateHint() {
    const hint = overlay.querySelector('.__ws-hint');
    if (currentMode === 'drag') {
      hint.textContent = 'ドラッグで選択';
    } else {
      hint.textContent = '要素をクリック';
    }
  }

  function onMouseMove(e) {
    const x = e.clientX;
    const y = e.clientY;

    // Update rulers
    const rulerH = overlay.querySelector('.__ws-ruler-h');
    const rulerV = overlay.querySelector('.__ws-ruler-v');
    if (rulerH) rulerH.style.top = y + 'px';
    if (rulerV) rulerV.style.left = x + 'px';

    if (currentMode === 'element' && !isDragging) {
      overlay.style.pointerEvents = 'none';
      const el = document.elementFromPoint(x, y);
      overlay.style.pointerEvents = '';

      if (el && !overlay.contains(el) && el !== document.documentElement && el !== document.body) {
        hoveredEl = el;
        const rect = el.getBoundingClientRect();
        showSelectionBox(rect.left, rect.top, rect.width, rect.height);
        showDimLabel(rect.width, rect.height, rect.left, rect.top);
        updateMask(rect.left, rect.top, rect.width, rect.height);
      }
      return;
    }

    if (!isDragging) return;
    curX = x;
    curY = y;

    const x1 = Math.min(startX, curX);
    const y1 = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);

    showSelectionBox(x1, y1, w, h);
    showDimLabel(w, h, x1, y1);
    updateMask(x1, y1, w, h);
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.__ws-toolbar')) return;

    if (currentMode === 'element') {
      if (hoveredEl) {
        const rect = hoveredEl.getBoundingClientRect();
        const captureRect = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          devicePixelRatio: window.devicePixelRatio || 1
        };
        cleanup();
        chrome.runtime.sendMessage({ type: 'SELECTION_COMPLETE', rect: captureRect });
      }
      return;
    }

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    curX = startX;
    curY = startY;
    e.preventDefault();
  }

  function onMouseUp(e) {
    if (!isDragging || currentMode !== 'drag') return;
    isDragging = false;

    const x = Math.min(startX, curX);
    const y = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);

    if (w < 5 || h < 5) {
      selectionBox.style.display = 'none';
      dimLabel.style.display = 'none';
      resetMask();
      return;
    }

    const captureRect = {
      x,
      y,
      width: w,
      height: h,
      devicePixelRatio: window.devicePixelRatio || 1
    };

    cleanup();
    chrome.runtime.sendMessage({ type: 'SELECTION_COMPLETE', rect: captureRect });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') cleanup();
  }

  function showSelectionBox(x, y, w, h) {
    selectionBox.style.cssText = `
      display: block;
      left: ${x}px;
      top: ${y}px;
      width: ${w}px;
      height: ${h}px;
    `;
  }

  function showDimLabel(w, h, x, y) {
    dimLabel.textContent = `${Math.round(w)} × ${Math.round(h)}`;
    dimLabel.style.display = 'block';
    const lx = x + w / 2 - 35;
    const ly = y + h + 8;
    dimLabel.style.left = Math.max(4, lx) + 'px';
    dimLabel.style.top = Math.max(4, ly) + 'px';
  }

  function updateMask(x, y, w, h) {
    const mask = overlay.querySelector('.__ws-mask');
    if (!mask) return;
    mask.style.background = `none`;
    // Use clip-path to cut out the selected area
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    mask.style.clipPath = `polygon(
      0 0, ${vw}px 0, ${vw}px ${vh}px, 0 ${vh}px, 0 0,
      ${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ${x + w}px ${y}px, ${x}px ${y}px
    )`;
  }

  function resetMask() {
    const mask = overlay.querySelector('.__ws-mask');
    if (mask) mask.style.clipPath = '';
  }

  function cleanup() {
    window.__websnapsInjected = false;
    if (overlay) overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onKeyDown, true);
  }

  // Message listener
  const messageListener = (message) => {
    if (message.type === 'START_SELECTION') {
      if (!document.getElementById('__websnaps-overlay')) {
        createOverlay();
      }
    }
  };
  chrome.runtime.onMessage.addListener(messageListener);

  // Auto-start
  createOverlay();
})();
