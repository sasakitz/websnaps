// WebSnaps - Background Service Worker

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  switch (command) {
    case 'capture-selection':
      await startSelectionCapture(tab);
      break;
    case 'capture-visible':
      await captureVisible(tab);
      break;
    case 'capture-fullpage':
      await captureFullPage(tab);
      break;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_CAPTURE') {
    // ポップアップが閉じる前に即座に応答し、チャンネル切断を防ぐ
    sendResponse({ received: true });
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      switch (message.mode) {
        case 'selection': await startSelectionCapture(tab); break;
        case 'visible':   await captureVisible(tab);        break;
        case 'fullpage':  await captureFullPage(tab);       break;
      }
    })();
  }

  if (message.type === 'SELECTION_COMPLETE') {
    (async () => {
      const tab = sender.tab;
      try {
        // content script 側で visibility:hidden → rAF×2 済みだが、
        // IPC レイテンシを考慮してさらに1フレーム分待つ
        await sleep(32);
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        await openEditor({
          type: 'selection',
          dataUrl,
          rect: message.rect
        });
        sendResponse({ success: true });
      } catch (e) {
        console.error('Selection capture error:', e);
        sendResponse({ success: false });
      }
    })();
    return true;
  }

  if (message.type === 'CANCEL_SELECTION') {
    sendResponse({ success: true });
    return true;
  }
});

async function startSelectionCapture(tab) {
  try {
    // CSS を先に注入して、JS がオーバーレイを生成した時点でスタイルが適用済みの状態にする
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content/selector.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/selector.js']
    });
    // スクリプトが既に注入済みでガードにより auto-start がスキップされた場合の保険
    chrome.tabs.sendMessage(tab.id, { type: 'START_SELECTION' }).catch(() => {});
  } catch (e) {
    console.error('Start selection error:', e);
  }
}

async function captureVisible(tab) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await openEditor({ type: 'visible', dataUrl });
  } catch (e) {
    console.error('Visible capture error:', e);
  }
}

async function captureFullPage(tab) {
  try {
    const [{ result: pageInfo }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        scrollHeight: Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        ),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        originalScrollX: window.scrollX,
        originalScrollY: window.scrollY,
        devicePixelRatio: window.devicePixelRatio || 1
      })
    });

    const { scrollHeight, viewportHeight, viewportWidth, devicePixelRatio } = pageInfo;

    // Scroll to top and hide scrollbars temporarily
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        document.documentElement.style.overflow = 'hidden';
        window.scrollTo(0, 0);
      }
    });

    await sleep(500);

    const screenshots = [];
    let scrollY = 0;

    while (true) {
      await sleep(600);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      screenshots.push({ dataUrl, scrollY });

      const nextScrollY = scrollY + viewportHeight;
      if (nextScrollY >= scrollHeight) break;

      scrollY = nextScrollY;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (y) => window.scrollTo(0, y),
        args: [scrollY]
      });
    }

    // Restore scroll and overflow
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (x, y) => {
        document.documentElement.style.overflow = '';
        window.scrollTo(x, y);
      },
      args: [pageInfo.originalScrollX, pageInfo.originalScrollY]
    });

    await openEditor({
      type: 'fullpage',
      screenshots,
      totalHeight: scrollHeight,
      viewportWidth,
      viewportHeight,
      devicePixelRatio
    });
  } catch (e) {
    console.error('Full page capture error:', e);
  }
}

async function openEditor(data) {
  await chrome.storage.session.set({ captureData: data });
  const editorUrl = chrome.runtime.getURL('editor/editor.html');
  chrome.tabs.create({ url: editorUrl });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
