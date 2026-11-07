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

  try {
    const captureId = new URLSearchParams(location.search).get('capture');
    const captureData = captureId ? await CaptureStore.get(captureId) : null;
    if (!captureData) throw new Error('キャプチャデータが見つかりません。拡張機能から撮影し直してください');
    const tab = await chrome.tabs.getCurrent();
    if (tab) await CaptureStore.attach(captureId, tab.id);
    state.format = captureData.format === 'jpg' ? 'jpg' : 'png';
    document.querySelectorAll('.format-btn').forEach(btn => {
      const active = btn.dataset.format === state.format;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    await loadCaptureData(captureData);
  } catch (e) {
    showLoading(false);
    showToast('読み込みエラー: ' + e.message, 'error');
    document.querySelectorAll('button, input, select').forEach(control => { control.disabled = true; });
    return;
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
  const scaleX = rect.viewportWidth ? img.width / rect.viewportWidth : (rect.devicePixelRatio || 1);
  const scaleY = rect.viewportHeight ? img.height / rect.viewportHeight : (rect.devicePixelRatio || 1);
  const region = getBoundedRect(rect.x * scaleX, rect.y * scaleY,
    (rect.x + rect.width) * scaleX, (rect.y + rect.height) * scaleY, img.width, img.height);
  if (region.w < 1 || region.h < 1) throw new Error('選択範囲が画像の外にあります');
  canvas.width = region.w;
  canvas.height = region.h;
  ctx.drawImage(img, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
}

async function loadFullPage(captureData) {
  const { screenshots, totalHeight, viewportWidth, devicePixelRatio: dpr } = captureData;
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
    // Round shared boundaries once so fractional DPR does not leave seams.
    const endY = Math.min(canvas.height, Math.round(nextScrollY * dprVal));
    const newHeight = endY - destY;
    if (newHeight > 0) {
      // At fractional DPR the screenshot can be one pixel shorter than
      // the rounded page interval. Fit that final pixel without leaving a gap.
      const sourceHeight = Math.min(img.height, newHeight);
      ctx.drawImage(img, 0, 0, img.width, sourceHeight, 0, destY, img.width, newHeight);
    }
  }
}

// ─── History ──────────────────────────────────────────────────────────────────
function saveHistory() {
  // Remove any redo history
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  // Long captures can make a single snapshot hundreds of megabytes.
  // Keep the current image and one undo step even when they exceed the budget.
  let bytes = state.history.reduce((sum, image) => sum + image.width * image.height * 4, 0);
  while (state.history.length > 50 || (state.history.length > 2 && bytes > 128 * 1024 * 1024)) {
    const removed = state.history.shift();
    bytes -= removed.width * removed.height * 4;
  }
  state.historyIndex = state.history.length - 1;
  updateHistoryButtons();
}

function undo() {
  commitTextInput();
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  restoreHistory();
  updateHistoryButtons();
}

function redo() {
  commitTextInput();
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  restoreHistory();
  updateHistoryButtons();
}

function restoreHistory() {
  if (state.tool === 'crop') selectTool('select');
  const image = state.history[state.historyIndex];
  canvas.width = image.width;
  canvas.height = image.height;
  ctx.putImageData(image, 0, 0);
  setZoom(state.zoom);
}

function getBoundedRect(x1, y1, x2, y2, width = canvas.width, height = canvas.height) {
  const left = Math.max(0, Math.min(width, Math.round(Math.min(x1, x2))));
  const top = Math.max(0, Math.min(height, Math.round(Math.min(y1, y2))));
  const right = Math.max(left, Math.min(width, Math.round(Math.max(x1, x2))));
  const bottom = Math.max(top, Math.min(height, Math.round(Math.max(y1, y2))));
  return { x: left, y: top, w: right - left, h: bottom - top };
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
  const { x, y, w, h } = getBoundedRect(x1, y1, x2, y2);
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

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.clearRect(x, y, w, h);
  ctx.drawImage(blurred, x, y);
  ctx.restore();
}

function applyMosaic(x1, y1, x2, y2) {
  const { x, y, w, h } = getBoundedRect(x1, y1, x2, y2);
  if (w < 2 || h < 2) return;

  const blockSize = Math.max(1, Math.round(state.effectStrength));
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
  state.preDrawSnapshot = state.history[state.historyIndex] || ctx.getImageData(0, 0, canvas.width, canvas.height);

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
    ctx.globalAlpha = 1;
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
  } else if (['line', 'arrow', 'rect', 'ellipse'].includes(state.tool)) {
    ctx.putImageData(state.preDrawSnapshot, 0, 0);
    drawPreview(x, y);
  }

  saveHistory();
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
      ctx.strokeStyle = '#146754';
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
    if (state.activeTextInput?.input === input) commitTextInput();
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
    ctx.globalAlpha = state.opacity;
    ctx.fillStyle = state.color;
    const fontStr = `${state.fontBold ? 'bold ' : ''}${state.fontItalic ? 'italic ' : ''}${state.fontSize}px ${state.fontFamily}`;
    ctx.font = fontStr;
    ctx.textBaseline = 'top';
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      ctx.fillText(line, x, y + i * (state.fontSize * 1.3));
    });
    saveHistory();
  }
  input.remove();
  state.activeTextInput = null;
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────
function setZoom(level) {
  commitTextInput();
  state.zoom = Math.max(0.01, Math.min(4, level));
  const pct = Math.round(state.zoom * 100);
  document.getElementById('zoom-label').textContent = pct + '%';
  canvas.style.width = `${canvas.width * state.zoom}px`;
  canvas.style.height = `${canvas.height * state.zoom}px`;
  updateStatusBar();
}

function fitToWindow() {
  const ws = workspace.getBoundingClientRect();
  const padding = parseFloat(getComputedStyle(workspace).paddingLeft) || 24;
  const scaleX = (ws.width - padding * 2) / canvas.width;
  const scaleY = (ws.height - padding * 2) / canvas.height;
  const zoom = Math.min(1, Math.min(scaleX, scaleY));
  setZoom(zoom);
}

// ─── Export ───────────────────────────────────────────────────────────────────
function getExportCanvas(format) {
  if (format !== 'jpg') return canvas;
  const output = document.createElement('canvas');
  output.width = canvas.width;
  output.height = canvas.height;
  const outputCtx = output.getContext('2d');
  outputCtx.fillStyle = '#ffffff';
  outputCtx.fillRect(0, 0, output.width, output.height);
  outputCtx.drawImage(canvas, 0, 0);
  return output;
}

async function saveFile() {
  commitTextInput();
  try {
    const format = state.format;
    const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const output = getExportCanvas(format);
    const blob = await new Promise(resolve => output.toBlob(resolve, mimeType, 0.92));
    if (!blob) throw new Error('画像を生成できませんでした');
    const now = new Date();
    const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `websnaps_${ts}.${format === 'jpg' ? 'jpg' : 'png'}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showToast('ダウンロードを開始しました', 'success');
  } catch (error) {
    showToast('保存できませんでした: ' + error.message, 'error');
  }
}

async function copyToClipboard() {
  commitTextInput();
  try {
    // Supply the promise immediately to preserve the browser's user activation.
    const blob = new Promise((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('画像を生成できませんでした')), 'image/png');
    });
    void blob.catch(() => {});
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showToast('画像をクリップボードにコピーしました', 'success');
  } catch (error) {
    showToast('画像をコピーできませんでした。ファイル保存をお試しください', 'error');
  }
}

// ─── UI Setup ─────────────────────────────────────────────────────────────────
function setupEventListeners() {
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);
  document.getElementById('btn-save').addEventListener('click', saveFile);
  document.getElementById('btn-copy').addEventListener('click', copyToClipboard);
  document.getElementById('btn-crop-apply').addEventListener('click', applyCrop);
  document.getElementById('btn-crop-cancel').addEventListener('click', () => {
    selectTool('select');
  });

  document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(state.zoom * 1.25));
  document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(state.zoom / 1.25));
  document.getElementById('btn-zoom-fit').addEventListener('click', fitToWindow);

  document.querySelectorAll('.format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.format = btn.dataset.format;
      document.querySelectorAll('.format-btn').forEach(b => {
        const active = b.dataset.format === state.format;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
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
  commitTextInput();
  if (state.isDrawing) {
    ctx.putImageData(state.preDrawSnapshot, 0, 0);
    state.isDrawing = false;
    state.preDrawSnapshot = null;
  }
  // 他ツールへ切り替え時はクロップモードを終了
  if (state.tool === 'crop' && tool !== 'crop') {
    exitCropMode();
  }

  state.tool = tool;

  document.querySelectorAll('.tool-btn').forEach(btn => {
    const active = btn.dataset.tool === tool;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  if (tool === 'crop') {
    enterCropMode();
  }

  updatePanelVisibility(tool);
  updateCursor();

  document.getElementById('status-tool').textContent = getToolName(tool);
  document.getElementById('tool-title').textContent = tool === 'select' ? '編集をはじめよう' : getToolName(tool);
  document.getElementById('tool-description').textContent = TOOL_HINTS[tool] || '';
  document.getElementById('editor-guide').hidden = tool !== 'select';
}

const TOOL_HINTS = {
  select: '左のツールを選んで、画像に書き込めます。',
  pencil: 'ドラッグして自由に書き込みます。色や太さを調整できます。',
  line: '始点から終点へドラッグして、直線を引きます。',
  arrow: '注目してほしい場所へ向かって、ドラッグします。',
  rect: 'ドラッグして囲みます。塗りつぶしでハイライトにも。',
  ellipse: 'ドラッグして丸く囲みます。塗りつぶしも使えます。',
  text: '画像をクリックして文字を入力。外側をクリックすると確定します。',
  blur: 'ドラッグした範囲をぼかします。下のスライダーで強度を調整。',
  mosaic: '隠したい範囲をドラッグします。下のスライダーで粒の大きさを調整。',
  eraser: 'ドラッグした部分が透明になります。元の画像も消去されます。',
  crop: '残したい範囲をドラッグし、「切り抜きを適用」をクリック。'
};

const TOOL_PANELS = {
  select: [],
  pencil: ['color', 'width', 'opacity'],
  line: ['color', 'width', 'opacity'],
  arrow: ['color', 'width', 'opacity'],
  rect: ['color', 'width', 'shape', 'opacity'],
  ellipse: ['color', 'width', 'shape', 'opacity'],
  text: ['color', 'text', 'opacity'],
  blur: ['effect'],
  mosaic: ['effect'],
  eraser: ['eraser'],
  crop: []
};

function updatePanelVisibility(tool) {
  const visiblePanels = TOOL_PANELS[tool] || [];
  for (const panel of ['color', 'width', 'text', 'effect', 'shape', 'opacity', 'eraser']) {
    const section = document.getElementById(`opt-${panel}`);
    const visible = visiblePanels.includes(panel);
    section.classList.toggle('hidden', !visible);
    if (panel === 'eraser') section.style.display = visible ? '' : 'none';
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
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.contentEditable === 'true') return;

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

    if (e.key === 'Escape' && state.tool === 'crop') { selectTool('select'); return; }

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
  document.addEventListener('mouseup', onCropMouseUp);
  cropOverlayCanvas.addEventListener('dblclick', applyCrop);
}

function exitCropMode() {
  cropOverlayCanvas.classList.remove('active');
  document.getElementById('crop-bar').classList.add('hidden');

  cropOverlayCanvas.removeEventListener('mousedown', onCropMouseDown);
  cropOverlayCanvas.removeEventListener('mousemove', onCropMouseMove);
  document.removeEventListener('mouseup', onCropMouseUp);
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
  const { x, y } = getCropCoords(e);
  Object.assign(cropState, getBoundedRect(cropState.startX, cropState.startY, x, y));
  cropState.hasRegion = cropState.w >= 2 && cropState.h >= 2;
  document.getElementById('btn-crop-apply').disabled = !cropState.hasRegion;
  document.getElementById('crop-size-label').textContent = cropState.hasRegion
    ? `${cropState.w} × ${cropState.h} (ダブルクリックで適用)`
    : 'ドラッグして範囲を選択';
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

  saveHistory();

  selectTool('select');
  setZoom(state.zoom);
  showToast(`切り抜き完了: ${w} × ${h}`, 'success');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像データを読み込めませんでした'));
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
