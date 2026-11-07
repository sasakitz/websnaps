const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

function createEditor() {
  const nodes = new Map();
  function element(id) {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        style: {}, dataset: {}, hidden: false, classes, attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        classList: {
          add: name => classes.add(name), remove: name => classes.delete(name),
          toggle: (name, active) => active ? classes.add(name) : classes.delete(name)
        }
      });
    }
    return nodes.get(id);
  }
  const buttons = ['select', 'pencil', 'arrow', 'rect', 'text'].map(tool => {
    const button = element(`tool-${tool}`);
    button.dataset.tool = tool;
    return button;
  });
  const canvas = { width: 100, height: 80, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 80 }) };
  let pixels = 0;
  const ctx = {
    getImageData: () => ({ pixels, width: canvas.width, height: canvas.height }), putImageData: data => { pixels = data.pixels; },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    stroke() { pixels++; }, fill() { pixels++; }, strokeRect() { pixels++; },
    fillText() { pixels++; }
  };
  const context = vm.createContext({ document: { getElementById: element, querySelectorAll: () => buttons, addEventListener() {} } });
  vm.runInContext(readFileSync(new URL('../editor/editor.js', `file://${__filename}`), 'utf8'), context);
  context.testCanvas = canvas;
  context.testContext = ctx;
  vm.runInContext('canvas = testCanvas; ctx = testContext; saveHistory();', context);
  return { context, canvas, element, buttons, pixels: () => pixels };
}

for (const tool of ['pencil', 'arrow', 'rect']) {
  test(`${tool}: drawing can be undone and redone, including mouseup outside the canvas`, () => {
    const editor = createEditor();
    editor.context.selectTool(tool);
    editor.context.onMouseDown({ button: 0, clientX: 5, clientY: 5 });
    editor.context.onMouseMove({ clientX: 25, clientY: 25 });
    editor.context.onMouseUp({ clientX: 110, clientY: 90 });
    const drawn = editor.pixels();
    assert.ok(drawn > 0);
    editor.context.undo();
    assert.equal(editor.pixels(), 0);
    editor.context.redo();
    assert.equal(editor.pixels(), drawn);
  });
}

test('committed text can be undone and redone', () => {
  const editor = createEditor();
  editor.context.pendingText = { innerText: 'Hello', remove() {} };
  vm.runInContext('state.activeTextInput = { input: pendingText, x: 5, y: 5 };', editor.context);
  editor.context.commitTextInput();
  assert.equal(editor.pixels(), 1);
  editor.context.undo();
  assert.equal(editor.pixels(), 0);
  editor.context.redo();
  assert.equal(editor.pixels(), 1);
});

test('a new drawing after undo replaces the redo branch', () => {
  const editor = createEditor();
  editor.context.selectTool('rect');
  editor.context.onMouseDown({ button: 0, clientX: 1, clientY: 1 });
  editor.context.onMouseUp({ clientX: 20, clientY: 20 });
  editor.context.undo();
  editor.context.onMouseDown({ button: 0, clientX: 2, clientY: 2 });
  editor.context.onMouseUp({ clientX: 30, clientY: 30 });
  assert.equal(editor.element('btn-redo').disabled, true);
});

test('tool selection updates visible guidance and accessible pressed state', () => {
  const editor = createEditor();
  editor.context.selectTool('arrow');
  assert.equal(editor.element('tool-title').textContent, '矢印');
  assert.equal(editor.element('editor-guide').hidden, true);
  assert.equal(editor.buttons.filter(b => b.attributes['aria-pressed'] === 'true').length, 1);
  editor.context.selectTool('select');
  assert.equal(editor.element('editor-guide').hidden, false);
});

test('zoom scales the displayed canvas without changing image resolution', () => {
  const editor = createEditor();
  editor.context.setZoom(.5);
  assert.equal(editor.canvas.style.width, '50px');
  assert.equal(editor.canvas.style.height, '40px');
  assert.equal(editor.canvas.width, 100);
  assert.equal(editor.canvas.height, 80);
});

test('regions crossing the canvas edges are clipped on both sides', () => {
  const editor = createEditor();
  const bounds = editor.context.getBoundedRect(-20, -10, 30, 20);
  assert.deepEqual(JSON.parse(JSON.stringify(bounds)), { x: 0, y: 0, w: 30, h: 20 });
  const outside = editor.context.getBoundedRect(110, 90, 130, 120);
  assert.equal(outside.w, 0);
  assert.equal(outside.h, 0);
});

test('selection loading clips image edges and uses actual screenshot scale', async () => {
  const editor = createEditor();
  editor.context.loadImage = async () => ({ width: 200, height: 160 });
  const drawCalls = [];
  editor.context.testContext.drawImage = (...args) => { drawCalls.push(args); };
  await editor.context.loadSelection({ dataUrl: 'image', rect: { x: -10, y: -5, width: 40, height: 25, viewportWidth: 100, viewportHeight: 80, devicePixelRatio: 1 } });
  assert.equal(editor.canvas.width, 60);
  assert.equal(editor.canvas.height, 40);
  assert.deepEqual(drawCalls[0].slice(1), [0, 0, 60, 40, 0, 0, 60, 40]);
});

test('history restores dimensions after a size-changing edit', () => {
  const editor = createEditor();
  editor.canvas.width = 30;
  editor.canvas.height = 20;
  editor.context.saveHistory();
  editor.context.undo();
  assert.equal(editor.canvas.width, 100);
  assert.equal(editor.canvas.height, 80);
  editor.context.redo();
  assert.equal(editor.canvas.width, 30);
  assert.equal(editor.canvas.height, 20);
  assert.equal(editor.canvas.style.width, '30px');
});

test('zoom commits active text before resizing its display', () => {
  const editor = createEditor();
  editor.context.pendingText = { innerText: 'Draft', remove() {} };
  vm.runInContext('state.activeTextInput = { input: pendingText, x: 5, y: 5 };', editor.context);
  editor.context.setZoom(.5);
  assert.equal(editor.pixels(), 1);
  assert.equal(vm.runInContext('state.activeTextInput', editor.context), null);
});

test('switching tools during a drag cancels the preview without leaving a stale snapshot', () => {
  const editor = createEditor();
  editor.context.selectTool('arrow');
  editor.context.onMouseDown({ button: 0, clientX: 5, clientY: 5 });
  editor.context.onMouseMove({ clientX: 30, clientY: 20 });
  assert.ok(editor.pixels() > 0);
  editor.context.selectTool('text');
  assert.equal(editor.pixels(), 0);
  assert.equal(vm.runInContext('state.isDrawing', editor.context), false);
  assert.equal(vm.runInContext('state.preDrawSnapshot', editor.context), null);
});

test('history for large images retains an undo step without unbounded snapshot growth', () => {
  const editor = createEditor();
  editor.canvas.width = 20000;
  editor.canvas.height = 2000;
  for (let i = 0; i < 10; i++) editor.context.saveHistory();
  assert.equal(vm.runInContext('state.history.length', editor.context), 2);
  editor.context.undo();
  assert.equal(editor.element('btn-redo').disabled, false);
});

test('drawing reuses the committed history snapshot instead of duplicating a full image', () => {
  const editor = createEditor();
  editor.context.selectTool('rect');
  editor.context.onMouseDown({ button: 0, clientX: 1, clientY: 1 });
  assert.equal(vm.runInContext('state.preDrawSnapshot === state.history[state.historyIndex]', editor.context), true);
});
