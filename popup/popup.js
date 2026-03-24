// WebSnaps Popup Script

const settings = {
  format: 'png',
  dest: 'file'
};

async function loadSettings() {
  const stored = await chrome.storage.local.get(['format', 'dest', 'shortcuts']);
  if (stored.format) settings.format = stored.format;
  if (stored.dest) settings.dest = stored.dest;
  return stored;
}

async function saveSettings() {
  await chrome.storage.local.set({ format: settings.format, dest: settings.dest });
}

function setToggle(groupId, value) {
  const group = document.getElementById(groupId);
  group.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

function setupToggleGroup(groupId, key) {
  const group = document.getElementById(groupId);
  group.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      settings[key] = btn.dataset.value;
      setToggle(groupId, btn.dataset.value);
      saveSettings();
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

async function init() {
  await loadSettings();

  // Apply saved settings to UI
  setToggle('format-group', settings.format);
  setToggle('dest-group', settings.dest);
  setupToggleGroup('format-group', 'format');
  setupToggleGroup('dest-group', 'dest');

  // Load actual shortcuts from chrome.commands
  const shortcuts = await getActualShortcuts();
  document.querySelectorAll('.capture-shortcut').forEach(el => {
    const cmd = el.dataset.command;
    if (shortcuts[cmd]) {
      el.textContent = shortcuts[cmd];
    }
  });

  // Capture button handlers
  document.querySelectorAll('.capture-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;

      // Visual feedback
      btn.classList.add('active');

      // Save format/dest before capture so editor can read them
      await chrome.storage.local.set({
        pendingFormat: settings.format,
        pendingDest: settings.dest
      });

      if (mode === 'selection') {
        // For selection, inject the selector first, then close popup
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          chrome.runtime.sendMessage({ type: 'START_CAPTURE', mode: 'selection' });
        }
        window.close();
      } else {
        // For visible/fullpage, send message and close
        chrome.runtime.sendMessage({ type: 'START_CAPTURE', mode });
        window.close();
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
