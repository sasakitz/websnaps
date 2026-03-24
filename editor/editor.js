// WebSnaps Editor

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  tool: 'select',
  color: '#ff3b3b',
  fillColor: '#ff3b3b',
  fillEnabled: false,
  lineWidth: 3,
  fontSize: 20,
  fontFamily: 'Arial, sans-serif',
  fontBold: false,
  fontItalic: false,
  opacity: 1,
  effectStrength: 10,
  eraserSize: 20,
  zoom: 1,
  format: 'png',
  history: [],
  historyIndex: -1,
  isDrawing: false,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  preDrawSnapshot: null,
  activeTextInput: null
};

let canvas, ctx, workspace, canvasContainer;
let cropOverlayCanvas, cropCtx;

// ─── Crop State ───────────────────────────────────────────────────────────────
const cropState = {
  isDrawing: false,
  hasRegion: false,
  startX: 0, startY: 0,
  x: 0, y: 0, w: 0, h: 0
};

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  workspace = document.getElementById('workspace');
  canvasContainer = document.getElementById('canvas-container');
  cropOverlayCanvas = document.getElementById('crop-overlay');
  cropCtx = cropOverlayCanvas.getContext('2d');

  // Load pending format/dest from popup settings
  try {
    const local = await chrome.storage.local.get(['pendingFormat', 'pendingDest']);
    if (local.pendingFormat) state.format = local.pendingFormat;
    document.querySelectorAll('.format-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.format === state.format);
    });
  } catch (e) {}

  try {
    const data = await chrome.storage.session.get('captureData');
    const captureData = data.captureData;

    if (!captureData) {
      showLoading(false);
      showToast('キャプチャデータが見つかりません', 'error');
      return;
    }

    await loadCaptureData(captureData);
  } catch (e) {
    showLoading(false);
    showToast('読み込みエラー: ' + e.message, 'error');
  }

  setupEventListeners();
  setupToolUI();
  setupKeyboardShortcuts();
  showLoading(false);
}

// ─── Load Capture Data ────────────────────────────────────────────────────────
async function loadCaptureData(captureData) {
  switch (captureData.type) {
    case 'visible':
      await loadFromDataUrl(captureData.dataUrl);
      break;
    case 'selection':
      await loadSelection(captureData);
      break;
    case 'fullpage':
      await loadFullPage(captureData);
      break;
  }
  saveHistory();
  fitToWindow();
  updateStatusBar();
}

async function loadFromDataUrl(dataUrl) {
  const img = await loadImage(dataUrl);
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);
}

async function loadSelection(captureData) {
  const { dataUrl, rect } = captureData;
  const img = await loadImage(dataUrl);
  const dpr = rect.devicePixelRatio || 1;

  const sx = Math.round(rect.x * dpr);
  const sy = Math.round(rect.y * dpr);
  const sw = Math.round(rect.width * dpr);
  const sh = Math.round(rect.height * dpr);

  canvas.width = sw;
  canvas.height = sh;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
}

async function loadFullPage(captureData) {
  const { screenshots, totalHeight, viewportWidth, viewportHeight, devicePixelRatio: dpr } = captureData;
  const dprVal = dpr || 1;

  canvas.width = Math.round(viewportWidth * dprVal);
  canvas.height = Math.round(totalHeight * dprVal);

  for (let i = 0; i < screenshots.length; i++) {
    const shot = screenshots[i];
    const img = await loadImage(shot.dataUrl);
    const destY = Math.round(shot.scrollY * dprVal);

    // Height of new content this screenshot provides
    const nextScrollY = (i < screenshots.length - 1)
      ? screenshots[i + 1].scrollY
      : totalHeight;
    const newHeight = Math.round((nextScrollY - shot.scrollY) * dprVal);

    ctx.drawImage(img, 0, 0, img.width, newHeight, 0, destY, img.width, newHeight);
  }
}

// ─── History ──────────────────────────────────────────────────────────────────
function saveHistory() {
  // Remove any redo history
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  if (state.history.length > 50) state.history.shift();
  state.historyIndex = state.history.length - 1;
  updateHistoryButtons();
}

function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  ctx.putImageData(state.history[state.historyIndex], 0, 0);
  updateHistoryButtons();
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  ctx.putImageData(state.history[state.historyIndex], 0, 0);
  updateHistoryButtons();
}

function updateHistoryButtons() {
  document.getElementById('btn-undo').disabled = state.historyIndex <= 0;
  document.getElementById('btn-redo').disabled = state.historyIndex >= state.history.length - 1;
}

// ─── Canvas Coordinates ───────────────────────────────────────────────────────
function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height)
  };
}

// ─── Drawing Setup ─────────────────────────────────────────────────────────────
function applyDrawStyle(c = ctx) {
  c.globalAlpha = state.opacity;
  c.strokeStyle = state.color;
  c.fillStyle = state.color;
  c.lineWidth = state.lineWidth;
  c.lineCap = 'round';
  c.lineJoin = 'round';
}

// ─── Tool Drawing Functions ────────────────────────────────────────────────────
function drawLine(c, x1, y1, x2, y2) {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

function drawArrow(c, x1, y1, x2, y2) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = Math.max(12, state.lineWidth * 3);

  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();

  // Arrowhead
  c.beginPath();
  c.moveTo(x2, y2);
  c.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6)
  );
  c.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6)
  );
  c.closePath();
  c.fillStyle = state.color;
  c.fill();
}

function drawRect(c, x1, y1, x2, y2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);

  if (state.fillEnabled) {
    c.fillStyle = state.fillColor;
    c.globalAlpha = state.opacity * 0.4;
    c.fillRect(x, y, w, h);
    c.globalAlpha = state.opacity;
  }
  c.strokeRect(x, y, w, h);
}

function drawEllipse(c, x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = Math.abs(x2 - x1) / 2;
  const ry = Math.abs(y2 - y1) / 2;

  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);

  if (state.fillEnabled) {
    c.fillStyle = state.fillColor;
    c.globalAlpha = state.opacity * 0.4;
    c.fill();
    c.globalAlpha = state.opacity;
  }
  c.stroke();
}

function applyBlur(x1, y1, x2, y2) {
  const x = Math.round(Math.min(x1, x2));
  const y = Math.round(Math.min(y1, y2));
  const w = Math.round(Math.abs(x2 - x1));
  const h = Math.round(Math.abs(y2 - y1));
  if (w < 2 || h < 2) return;

  const radius = state.effectStrength;
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tmpCtx = tmp.getContext('2d');
  tmpCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h);

  const blurred = document.createElement('canvas');
  blurred.width = w;
  blurred.height = h;
  const bCtx = blurred.getContext('2d');
  bCtx.filter = `blur(${radius}px)`;
  bCtx.drawImage(tmp, -radius, -radius, w + radius * 2, h + radius * 2);

  ctx.drawImage(blurred, x, y);
}

function applyMosaic(x1, y1, x2, y2) {
  const x = Math.round(Math.min(x1, x2));
  const y = Math.round(Math.min(y1, y2));
  const w = Math.round(Math.abs(x2 - x1));
  const h = Math.round(Math.abs(y2 - y1));
  if (w < 2 || h < 2) return;

  const blockSize = state.effectStrength;
  const imageData = ctx.getImageData(x, y, w, h);
  const { data, width: iw, height: ih } = imageData;

  for (let by = 0; by < ih; by += blockSize) {
    for (let bx = 0; bx < iw; bx += blockSize) {
      let r = 0, g = 0, b = 0, count = 0;
      const bw = Math.min(blockSize, iw - bx);
      const bh = Math.min(blockSize, ih - by);

      for (let py = by; py < by + bh; py++) {
        for (let px = bx; px < bx + bw; px++) {
          const i = (py * iw + px) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2];
          count++;
        }
      }
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);

      for (let py = by; py < by + bh; py++) {
        for (let px = bx; px < bx + bw; px++) {
          const i = (py * iw + px) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b;
        }
      }
    }
  }
  ctx.putImageData(imageData, x, y);
}

// ─── Mouse Event Handlers ─────────────────────────────────────────────────────
function onMouseDown(e) {
  if (e.button !== 0) return;
  if (state.activeTextInput) return;

  const { x, y } = getCanvasCoords(e);
  state.startX = x;
  state.startY = y;
  state.lastX = x;
  state.lastY = y;

  if (state.tool === 'select') return;

  if (state.tool === 'text') {
    startTextInput(x, y);
    return;
  }

  state.isDrawing = true;
  state.preDrawSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  saveHistory();

  if (state.tool === 'pencil') {
    applyDrawStyle();
    ctx.beginPath();
    ctx.moveTo(x, y);
  } else if (state.tool === 'eraser') {
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
}

function onMouseMove(e) {
  const { x, y } = getCanvasCoords(e);
  updateStatusCoords(x, y);

  if (!state.isDrawing) return;

  const SHAPE_TOOLS = ['line', 'arrow', 'rect', 'ellipse', 'blur', 'mosaic'];

  if (SHAPE_TOOLS.includes(state.tool)) {
    // Restore pre-draw state to show live preview
    ctx.putImageData(state.preDrawSnapshot, 0, 0);
    applyDrawStyle();
    drawPreview(x, y);
  } else if (state.tool === 'pencil') {
    applyDrawStyle();
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  } else if (state.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = state.eraserSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  state.lastX = x;
  state.lastY = y;
}

function onMouseUp(e) {
  if (!state.isDrawing) return;
  state.isDrawing = false;

  const { x, y } = getCanvasCoords(e);
  applyDrawStyle();

  const EFFECT_TOOLS = ['blur', 'mosaic'];
  if (EFFECT_TOOLS.includes(state.tool)) {
    // Apply final effect
    ctx.putImageData(state.preDrawSnapshot, 0, 0);
    if (state.tool === 'blur') {
      applyBlur(state.startX, state.startY, x, y);
    } else {
      applyMosaic(state.startX, state.startY, x, y);
    }
    saveHistory();
  }

  state.preDrawSnapshot = null;
}

function drawPreview(x, y) {
  applyDrawStyle();
  switch (state.tool) {
    case 'line':
      drawLine(ctx, state.startX, state.startY, x, y);
      break;
    case 'arrow':
      drawArrow(ctx, state.startX, state.startY, x, y);
      break;
    case 'rect':
      drawRect(ctx, state.startX, state.startY, x, y);
      break;
    case 'ellipse':
      drawEllipse(ctx, state.startX, state.startY, x, y);
      break;
    case 'blur':
    case 'mosaic': {
      // Show selection rectangle as dashed preview
      const x1 = Math.min(state.startX, x);
      const y1 = Math.min(state.startY, y);
      const w = Math.abs(x - state.startX);
      const h = Math.abs(y - state.startY);
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = '#a5b4fc';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(x1, y1, w, h);
      ctx.restore();
      break;
    }
  }
}

// ─── Text Tool ─────────────────────────────────────────────────────────────────
function startTextInput(x, y) {
  if (state.activeTextInput) {
    commitTextInput();
    return;
  }

  const input = document.createElement('div');
  input.contentEditable = 'true';
  input.className = 'text-input-overlay';

  // キャンバス座標 → canvasContainer 内の CSS 座標に変換（ズーム補正）
  const cssX = canvas.offsetLeft + x * state.zoom;
  const cssY = canvas.offsetTop + y * state.zoom;
  const cssFontSize = state.fontSize * state.zoom;

  input.style.cssText = `
    left: ${cssX}px;
    top: ${cssY}px;
    font: ${state.fontBold ? 'bold' : 'normal'} ${state.fontItalic ? 'italic' : ''} ${cssFontSize}px/${cssFontSize * 1.3}px ${state.fontFamily};
    color: ${state.color};
    min-width: 4px;
    max-width: ${(canvas.width - x) * state.zoom}px;
  `;

  // キャンバスへのイベントバブルアップを阻止（これがないと mousedown が
  // canvasの onMouseDown に届き activeTextInput を検出して即 commit してしまう）
  input.addEventListener('mousedown', (e) => e.stopPropagation());
  input.addEventListener('pointerdown', (e) => e.stopPropagation());

  canvasContainer.appendChild(input);
  setTimeout(() => input.focus(), 0);
  state.activeTextInput = { input, x, y };

  const commit = () => {
    if (!state.activeTextInput) return;
    const text = input.innerText.trim();
    if (text) {
      saveHistory();
      ctx.globalAlpha = state.opacity;
      ctx.fillStyle = state.color;
      const fontStr = `${state.fontBold ? 'bold ' : ''}${state.fontItalic ? 'italic ' : ''}${state.fontSize}px ${state.fontFamily}`;
      ctx.font = fontStr;
      ctx.textBaseline = 'top';

      const lines = text.split('\n');
      lines.forEach((line, i) => {
        ctx.fillText(line, x, y + i * (state.fontSize * 1.3));
      });
    }
    input.remove();
    state.activeTextInput = null;
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.remove();
      state.activeTextInput = null;
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (state.activeTextInput && state.activeTextInput.input === input) {
        commit();
      }
    }, 100);
  });
}

function commitTextInput() {
  if (!state.activeTextInput) return;
  const { input, x, y } = state.activeTextInput;
  const text = input.innerText.trim();
  if (text) {
    saveHistory();
    ctx.globalAlpha = state.opacity;
    ctx.fillStyle = state.color;
    const fontStr = `${state.fontBold ? 'bold ' : ''}${state.fontItalic ? 'italic ' : ''}${state.fontSize}px ${state.fontFamily}`;
    ctx.font = fontStr;
    ctx.textBaseline = 'top';
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      ctx.fillText(line, x, y + i * (state.fontSize * 1.3));
    });
  }
  input.remove();
  state.activeTextInput = null;
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────
function setZoom(level) {
  state.zoom = Math.max(0.1, Math.min(4, level));
  const pct = Math.round(state.zoom * 100);
  document.getElementById('zoom-label').textContent = pct + '%';
  canvasContainer.style.transform = `scale(${state.zoom})`;
  updateStatusBar();
}

function fitToWindow() {
  const ws = workspace.getBoundingClientRect();
  const padding = 48;
  const scaleX = (ws.width - padding * 2) / canvas.width;
  const scaleY = (ws.height - padding * 2) / canvas.height;
  const zoom = Math.min(1, Math.min(scaleX, scaleY));
  setZoom(zoom);
}

// ─── Export ───────────────────────────────────────────────────────────────────
async function saveFile() {
  const format = state.format;
  const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const ext = format === 'jpg' ? 'jpg' : 'png';
  const quality = format === 'jpg' ? 0.92 : undefined;

  const dataUrl = quality !== undefined
    ? canvas.toDataURL(mimeType, quality)
    : canvas.toDataURL(mimeType);

  const now = new Date();
  const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `websnaps_${ts}.${ext}`;

  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
  showToast(`保存しました: ${filename}`, 'success');
}

async function copyToClipboard() {
  try {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ]);
    showToast('クリップボードにコピーしました', 'success');
  } catch (e) {
    // Fallback
    const dataUrl = canvas.toDataURL('image/png');
    try {
      await navigator.clipboard.writeText(dataUrl);
      showToast('クリップボードにコピーしました', 'success');
    } catch (e2) {
      showToast('コピーに失敗しました', 'error');
    }
  }
}

// ─── UI Setup ─────────────────────────────────────────────────────────────────
function setupEventListeners() {
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', () => {
    if (state.isDrawing && state.tool !== 'pencil' && state.tool !== 'eraser') return;
    // don't cancel on leave for shapes
  });

  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);
  document.getElementById('btn-save').addEventListener('click', saveFile);
  document.getElementById('btn-copy').addEventListener('click', copyToClipboard);
  document.getElementById('btn-crop-apply').addEventListener('click', applyCrop);
  document.getElementById('btn-crop-cancel').addEventListener('click', () => {
    exitCropMode();
    selectTool('select');
  });

  document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(state.zoom * 1.25));
  document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(state.zoom / 1.25));
  document.getElementById('btn-zoom-fit').addEventListener('click', fitToWindow);

  document.querySelectorAll('.format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.format = btn.dataset.format;
      document.querySelectorAll('.format-btn').forEach(b => b.classList.toggle('active', b.dataset.format === state.format));
    });
  });

  // Workspace scroll zoom
  workspace.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(state.zoom * delta);
    }
  }, { passive: false });

  // Canvas cursor
  canvas.addEventListener('mousemove', () => updateCursor());
}

function setupToolUI() {
  // Tool buttons
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => selectTool(btn.dataset.tool));
  });

  // Color
  const colorInput = document.getElementById('color-input');
  const colorPreview = document.getElementById('color-preview');
  colorPreview.style.background = state.color;

  colorPreview.addEventListener('click', () => colorInput.click());
  colorInput.addEventListener('input', (e) => {
    setColor(e.target.value);
  });

  document.querySelectorAll('.color-preset').forEach(btn => {
    btn.addEventListener('click', () => setColor(btn.dataset.color));
  });

  // Fill color
  const fillColorInput = document.getElementById('fill-color-input');
  const fillColorPreview = document.getElementById('fill-color-preview');
  fillColorPreview.style.background = state.fillColor;

  fillColorPreview.addEventListener('click', () => fillColorInput.click());
  fillColorInput.addEventListener('input', (e) => {
    state.fillColor = e.target.value;
    fillColorPreview.style.background = e.target.value;
  });

  // Line width
  const widthSlider = document.getElementById('width-slider');
  const widthValue = document.getElementById('width-value');
  widthSlider.addEventListener('input', () => {
    state.lineWidth = parseInt(widthSlider.value);
    widthValue.textContent = state.lineWidth;
  });

  document.querySelectorAll('.width-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const w = parseInt(btn.dataset.width);
      state.lineWidth = w;
      widthSlider.value = w;
      widthValue.textContent = w;
    });
  });

  // Font size
  const fontsizeSlider = document.getElementById('fontsize-slider');
  const fontsizeValue = document.getElementById('fontsize-value');
  fontsizeSlider.addEventListener('input', () => {
    state.fontSize = parseInt(fontsizeSlider.value);
    fontsizeValue.textContent = state.fontSize;
  });

  // Font family
  document.getElementById('font-select').addEventListener('change', (e) => {
    state.fontFamily = e.target.value;
  });

  // Bold/Italic
  document.getElementById('btn-bold').addEventListener('click', () => {
    state.fontBold = !state.fontBold;
    document.getElementById('btn-bold').classList.toggle('active', state.fontBold);
  });
  document.getElementById('btn-italic').addEventListener('click', () => {
    state.fontItalic = !state.fontItalic;
    document.getElementById('btn-italic').classList.toggle('active', state.fontItalic);
  });

  // Effect strength
  const effectSlider = document.getElementById('effect-slider');
  const effectValue = document.getElementById('effect-value');
  effectSlider.addEventListener('input', () => {
    state.effectStrength = parseInt(effectSlider.value);
    effectValue.textContent = state.effectStrength;
  });

  // Opacity
  const opacitySlider = document.getElementById('opacity-slider');
  const opacityValue = document.getElementById('opacity-value');
  opacitySlider.addEventListener('input', () => {
    state.opacity = parseInt(opacitySlider.value) / 100;
    opacityValue.textContent = Math.round(state.opacity * 100) + '%';
  });

  // Eraser size
  const eraserSlider = document.getElementById('eraser-slider');
  const eraserValue = document.getElementById('eraser-value');
  eraserSlider.addEventListener('input', () => {
    state.eraserSize = parseInt(eraserSlider.value);
    eraserValue.textContent = state.eraserSize;
  });

  // Fill toggle
  document.getElementById('fill-toggle').addEventListener('change', (e) => {
    state.fillEnabled = e.target.checked;
    document.getElementById('fill-label').textContent = state.fillEnabled ? 'オン' : 'オフ';
    document.getElementById('fill-color-row').classList.toggle('hidden', !state.fillEnabled);
  });
}

function setColor(color) {
  state.color = color;
  document.getElementById('color-preview').style.background = color;
  document.getElementById('color-input').value = color;
  document.querySelectorAll('.color-preset').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === color);
  });
}

function selectTool(tool) {
  // 他ツールへ切り替え時はクロップモードを終了
  if (state.tool === 'crop' && tool !== 'crop') {
    exitCropMode();
  }

  state.tool = tool;

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  if (tool === 'crop') {
    enterCropMode();
  }

  updatePanelVisibility(tool);
  updateCursor();

  document.getElementById('status-tool').textContent = getToolName(tool);
}

function updatePanelVisibility(tool) {
  const colorSection = document.getElementById('opt-color');
  const widthSection = document.getElementById('opt-width');
  const textSection = document.getElementById('opt-text');
  const effectSection = document.getElementById('opt-effect');
  const shapeSection = document.getElementById('opt-shape');
  const opacitySection = document.getElementById('opt-opacity');
  const eraserSection = document.getElementById('opt-eraser');

  const hideAll = () => {
    [colorSection, widthSection, textSection, effectSection, shapeSection, opacitySection, eraserSection].forEach(el => el.classList.add('hidden'));
    eraserSection.style.display = 'none';
  };

  hideAll();

  switch (tool) {
    case 'select':
      break;
    case 'pencil':
      colorSection.classList.remove('hidden');
      widthSection.classList.remove('hidden');
      opacitySection.classList.remove('hidden');
      break;
    case 'line':
    case 'arrow':
      colorSection.classList.remove('hidden');
      widthSection.classList.remove('hidden');
      opacitySection.classList.remove('hidden');
      break;
    case 'rect':
    case 'ellipse':
      colorSection.classList.remove('hidden');
      widthSection.classList.remove('hidden');
      shapeSection.classList.remove('hidden');
      opacitySection.classList.remove('hidden');
      break;
    case 'text':
      colorSection.classList.remove('hidden');
      textSection.classList.remove('hidden');
      opacitySection.classList.remove('hidden');
      break;
    case 'blur':
    case 'mosaic':
      effectSection.classList.remove('hidden');
      break;
    case 'eraser':
      eraserSection.style.display = '';
      eraserSection.classList.remove('hidden');
      break;
    case 'crop':
      break;
  }
}

function updateCursor() {
  if (!canvas) return;
  const cursors = {
    select: 'default',
    pencil: 'crosshair',
    line: 'crosshair',
    arrow: 'crosshair',
    rect: 'crosshair',
    ellipse: 'crosshair',
    text: 'text',
    blur: 'crosshair',
    mosaic: 'crosshair',
    eraser: 'cell',
    crop: 'crosshair'
  };
  canvas.style.cursor = cursors[state.tool] || 'default';
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || document.activeElement?.contentEditable === 'true') return;

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if (e.key === 'y') { e.preventDefault(); redo(); }
      if (e.key === 's') { e.preventDefault(); saveFile(); }
      if (e.key === 'c' && !e.shiftKey) { e.preventDefault(); copyToClipboard(); }
      if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom(state.zoom * 1.25); }
      if (e.key === '-') { e.preventDefault(); setZoom(state.zoom / 1.25); }
      if (e.key === '0') { e.preventDefault(); fitToWindow(); }
      return;
    }

    const toolKeys = {
      'v': 'select', 'p': 'pencil', 'l': 'line',
      'a': 'arrow', 'r': 'rect', 'e': 'ellipse',
      't': 'text', 'b': 'blur', 'm': 'mosaic', 'x': 'eraser', 'c': 'crop'
    };
    if (toolKeys[e.key.toLowerCase()]) {
      selectTool(toolKeys[e.key.toLowerCase()]);
    }
  });
}

// ─── Status Bar ───────────────────────────────────────────────────────────────
function updateStatusBar() {
  const w = canvas.width;
  const h = canvas.height;
  document.getElementById('status-size').textContent = `${w} × ${h}`;
}

function updateStatusCoords(x, y) {
  document.getElementById('status-pos').textContent = `${Math.round(x)}, ${Math.round(y)}`;
}

// ─── Crop Tool ────────────────────────────────────────────────────────────────
function enterCropMode() {
  cropState.isDrawing = false;
  cropState.hasRegion = false;
  cropState.x = 0; cropState.y = 0;
  cropState.w = canvas.width; cropState.h = canvas.height;

  cropOverlayCanvas.width = canvas.width;
  cropOverlayCanvas.height = canvas.height;
  cropOverlayCanvas.classList.add('active');

  drawCropOverlay();
  document.getElementById('crop-bar').classList.remove('hidden');
  document.getElementById('crop-size-label').textContent = 'ドラッグして範囲を選択';
  document.getElementById('btn-crop-apply').disabled = true;

  cropOverlayCanvas.addEventListener('mousedown', onCropMouseDown);
  cropOverlayCanvas.addEventListener('mousemove', onCropMouseMove);
  cropOverlayCanvas.addEventListener('mouseup', onCropMouseUp);
  cropOverlayCanvas.addEventListener('dblclick', applyCrop);
}

function exitCropMode() {
  cropOverlayCanvas.classList.remove('active');
  document.getElementById('crop-bar').classList.add('hidden');

  cropOverlayCanvas.removeEventListener('mousedown', onCropMouseDown);
  cropOverlayCanvas.removeEventListener('mousemove', onCropMouseMove);
  cropOverlayCanvas.removeEventListener('mouseup', onCropMouseUp);
  cropOverlayCanvas.removeEventListener('dblclick', applyCrop);

  cropCtx.clearRect(0, 0, cropOverlayCanvas.width, cropOverlayCanvas.height);
}

function getCropCoords(e) {
  const rect = cropOverlayCanvas.getBoundingClientRect();
  return {
    x: Math.round((e.clientX - rect.left) * (cropOverlayCanvas.width / rect.width)),
    y: Math.round((e.clientY - rect.top) * (cropOverlayCanvas.height / rect.height))
  };
}

function onCropMouseDown(e) {
  if (e.button !== 0) return;
  const { x, y } = getCropCoords(e);
  cropState.isDrawing = true;
  cropState.hasRegion = false;
  cropState.startX = x;
  cropState.startY = y;
  cropState.x = x; cropState.y = y;
  cropState.w = 0; cropState.h = 0;
  document.getElementById('btn-crop-apply').disabled = true;
}

function onCropMouseMove(e) {
  const { x, y } = getCropCoords(e);
  updateStatusCoords(x, y);
  if (!cropState.isDrawing) return;

  const rx = Math.min(cropState.startX, x);
  const ry = Math.min(cropState.startY, y);
  const rw = Math.abs(x - cropState.startX);
  const rh = Math.abs(y - cropState.startY);

  cropState.x = rx; cropState.y = ry;
  cropState.w = rw; cropState.h = rh;

  drawCropOverlay();
  if (rw > 1 && rh > 1) {
    document.getElementById('crop-size-label').textContent = `${rw} × ${rh}`;
  }
}

function onCropMouseUp(e) {
  if (!cropState.isDrawing) return;
  cropState.isDrawing = false;

  if (cropState.w < 2 || cropState.h < 2) {
    cropState.hasRegion = false;
    document.getElementById('btn-crop-apply').disabled = true;
    document.getElementById('crop-size-label').textContent = 'ドラッグして範囲を選択';
    return;
  }

  // Clamp to canvas bounds
  cropState.x = Math.max(0, cropState.x);
  cropState.y = Math.max(0, cropState.y);
  cropState.w = Math.min(canvas.width - cropState.x, cropState.w);
  cropState.h = Math.min(canvas.height - cropState.y, cropState.h);

  cropState.hasRegion = true;
  document.getElementById('btn-crop-apply').disabled = false;
  document.getElementById('crop-size-label').textContent =
    `${cropState.w} × ${cropState.h} (ダブルクリックで適用)`;
  drawCropOverlay();
}

function drawCropOverlay() {
  const { x, y, w, h } = cropState;
  const cw = cropOverlayCanvas.width;
  const ch = cropOverlayCanvas.height;

  cropCtx.clearRect(0, 0, cw, ch);

  if (w < 1 || h < 1) {
    // No region yet: full dark overlay
    cropCtx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    cropCtx.fillRect(0, 0, cw, ch);
    return;
  }

  // Dark mask outside crop region using composite
  cropCtx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  cropCtx.fillRect(0, 0, cw, ch);
  cropCtx.clearRect(x, y, w, h);

  // Re-draw just the mask (cleared area shows canvas below)
  // Border
  cropCtx.save();
  cropCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  cropCtx.lineWidth = 1.5;
  cropCtx.setLineDash([6, 3]);
  cropCtx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);

  // Rule of thirds grid
  cropCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  cropCtx.lineWidth = 0.75;
  cropCtx.setLineDash([]);
  for (let i = 1; i < 3; i++) {
    cropCtx.beginPath();
    cropCtx.moveTo(x + w * i / 3, y);
    cropCtx.lineTo(x + w * i / 3, y + h);
    cropCtx.stroke();
    cropCtx.beginPath();
    cropCtx.moveTo(x, y + h * i / 3);
    cropCtx.lineTo(x + w, y + h * i / 3);
    cropCtx.stroke();
  }

  // Corner + edge handles
  const hs = 6;
  cropCtx.fillStyle = '#ffffff';
  cropCtx.setLineDash([]);
  const handles = [
    [x, y], [x + w, y], [x, y + h], [x + w, y + h],
    [x + w / 2, y], [x + w / 2, y + h],
    [x, y + h / 2], [x + w, y + h / 2]
  ];
  handles.forEach(([hx, hy]) => {
    cropCtx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
  });

  cropCtx.restore();
}

function applyCrop() {
  if (!cropState.hasRegion) return;
  const { x, y, w, h } = cropState;
  if (w < 1 || h < 1) return;

  const imageData = ctx.getImageData(x, y, w, h);
  canvas.width = w;
  canvas.height = h;
  ctx.putImageData(imageData, 0, 0);

  // Reset history to new canvas state
  state.history = [];
  state.historyIndex = -1;
  saveHistory();

  exitCropMode();
  state.tool = 'select';
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === 'select');
  });
  updatePanelVisibility('select');
  updateCursor();
  document.getElementById('status-tool').textContent = getToolName('select');
  updateStatusBar();
  showToast(`切り抜き完了: ${w} × ${h}`, 'success');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function showLoading(visible) {
  document.getElementById('loading').style.display = visible ? 'flex' : 'none';
}

function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function getToolName(tool) {
  const names = {
    select: '選択', pencil: 'ペン', line: '直線', arrow: '矢印',
    rect: '四角形', ellipse: '楕円', text: 'テキスト',
    blur: 'ぼかし', mosaic: 'モザイク', eraser: '消しゴム', crop: '切り抜き'
  };
  return names[tool] || tool;
}

// ─── Start ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  selectTool('select');
  init();
});
