// WebSnaps Popup Script

const settings = {
  format: 'png'
};

async function loadSettings() {
  const stored = await chrome.storage.local.get(['format']);
  if (stored.format) settings.format = stored.format;
  return stored;
}

async function saveSettings() {
  await chrome.storage.local.set({ format: settings.format });
}

function setToggle(groupId, value) {
  const group = document.getElementById(groupId);
  group.querySelectorAll('.toggle-btn').forEach(btn => {
    const active = btn.dataset.value === value;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function setupToggleGroup(groupId, key) {
  const group = document.getElementById(groupId);
  group.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      settings[key] = btn.dataset.value;
      setToggle(groupId, btn.dataset.value);
      updateFormatHint();
      void saveSettings().catch(() => showError('設定を保存できませんでした。もう一度お試しください。'));
    });
  });
}

async function getActualShortcuts() {
  try {
    const commands = await chrome.commands.getAll();
    const map = {};
    for (const cmd of commands) {
      map[cmd.name] = cmd.shortcut || '';
    }
    return map;
  } catch (e) {
    return {};
  }
}

function updateFormatHint() {
  document.getElementById('format-hint').textContent = settings.format === 'jpg'
    ? 'JPG · 写真をコンパクトに保存' : 'PNG · 文字や図をくっきり保存';
}

function showError(message) {
  const error = document.getElementById('capture-error');
  error.textContent = message;
  error.hidden = false;
}

async function init() {
  try { await loadSettings(); } catch { showError('設定を読み込めませんでした。標準設定で撮影できます。'); }

  // Apply saved settings to UI
  setToggle('format-group', settings.format);
  setupToggleGroup('format-group', 'format');
  updateFormatHint();

  // Load actual shortcuts from chrome.commands
  const shortcuts = await getActualShortcuts();
  document.querySelectorAll('.capture-shortcut').forEach(el => {
    const cmd = el.dataset.command;
    if (Object.prototype.hasOwnProperty.call(shortcuts, cmd)) {
      el.textContent = shortcuts[cmd] || '未設定';
    }
  });

  // Capture button handlers
  document.querySelectorAll('.capture-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const buttons = document.querySelectorAll('.capture-btn');
      buttons.forEach(button => { button.disabled = true; });
      btn.classList.add('active');
      btn.setAttribute('aria-busy', 'true');
      document.getElementById('capture-error').hidden = true;
      try {
        await chrome.storage.local.set({ pendingFormat: settings.format });
        await chrome.runtime.sendMessage({ type: 'START_CAPTURE', mode: btn.dataset.mode });
        window.close();
      } catch {
        showError('撮影を開始できませんでした。ページを再読み込みしてお試しください。');
        buttons.forEach(button => { button.disabled = false; });
        btn.classList.remove('active');
        btn.removeAttribute('aria-busy');
      }
    });
  });

  // Settings link - open Chrome shortcuts page
  document.getElementById('settings-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    window.close();
  });

  document.getElementById('shortcuts-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    window.close();
  });
}

document.addEventListener('DOMContentLoaded', init);
