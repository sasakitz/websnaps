// WebSnaps - Background Service Worker
importScripts('shared/capture-store.js');

const captureCleanup = (async () => {
  const editorUrl = chrome.runtime.getURL('editor/editor.html');
  const tabs = await chrome.tabs.query({});
  const activeIds = tabs.flatMap(tab => {
    const url = tab.url || tab.pendingUrl || '';
    return url.startsWith(editorUrl + '?') ? [new URL(url).searchParams.get('capture')] : [];
  });
  await CaptureStore.prune(activeIds);
})().catch(error => console.error('Capture cleanup error:', error));

chrome.tabs.onRemoved.addListener(tabId => {
  void CaptureStore.removeForTab(tabId).catch(error => console.error('Capture cleanup error:', error));
});

// A window's active tab can only have one capture in flight at a time.
const capturingWindows = new Set();

const CAPTURE_HANDLERS = {
  selection: startSelectionCapture,
  visible: captureVisible,
  fullpage: captureFullPage
};

chrome.commands.onCommand.addListener((command) => {
  const mode = command.startsWith('capture-') ? command.slice('capture-'.length) : '';
  return startCapture(mode);
});

async function startCapture(mode) {
  if (!Object.prototype.hasOwnProperty.call(CAPTURE_HANDLERS, mode)) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    if (capturingWindows.has(tab.windowId)) return;
    capturingWindows.add(tab.windowId);
    try {
      if (mode !== 'selection') {
        await chrome.tabs.sendMessage(tab.id, { type: 'CANCEL_SELECTION' }).catch(() => {});
        await sleep(32);
      }
      await CAPTURE_HANDLERS[mode](tab);
    } finally {
      capturingWindows.delete(tab.windowId);
    }
  } catch (e) {
    console.error('Start capture error:', e);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_CAPTURE') {
    // ポップアップが閉じる前に即座に応答し、チャンネル切断を防ぐ
    sendResponse({ received: true });
    void startCapture(message.mode);
  }

  if (message.type === 'SELECTION_COMPLETE') {
    (async () => {
      const tab = sender.tab;
      if (!tab || capturingWindows.has(tab.windowId)) {
        sendResponse({ success: false });
        return;
      }
      capturingWindows.add(tab.windowId);
      try {
        // content script 側で visibility:hidden → rAF×2 済みだが、
        // IPC レイテンシを考慮してさらに1フレーム分待つ
        await sleep(32);
        const dataUrl = await captureTab(tab);
        await openEditor({
          type: 'selection',
          dataUrl,
          rect: message.rect
        });
        sendResponse({ success: true });
      } catch (e) {
        console.error('Selection capture error:', e);
        sendResponse({ success: false });
      } finally {
        capturingWindows.delete(tab.windowId);
      }
    })();
    return true;
  }

  if (message.type === 'CANCEL_SELECTION') {
    sendResponse({ success: true });
    return true;
  }
});

function isInjectableUrl(url) {
  if (!url) return false;
  const blocked = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'data:', 'devtools://'];
  return !blocked.some(prefix => url.startsWith(prefix));
}

async function startSelectionCapture(tab) {
  if (!isInjectableUrl(tab.url)) {
    console.warn('WebSnaps: このページにはスクリプトを注入できません:', tab.url);
    return;
  }
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
    const dataUrl = await captureTab(tab);
    await openEditor({ type: 'visible', dataUrl });
  } catch (e) {
    console.error('Visible capture error:', e);
  }
}

async function captureFullPage(tab) {
  if (!isInjectableUrl(tab.url)) {
    console.warn('WebSnaps: このページにはスクリプトを注入できません:', tab.url);
    return;
  }
  try {
    const [{ result: pageInfo }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        scrollHeight: Math.max(
          document.body?.scrollHeight || 0,
          document.documentElement.scrollHeight
        ),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        originalScrollX: window.scrollX,
        originalScrollY: window.scrollY,
        devicePixelRatio: window.devicePixelRatio || 1,
        originalOverflow: document.documentElement.style.getPropertyValue('overflow'),
        originalOverflowPriority: document.documentElement.style.getPropertyPriority('overflow')
      })
    });

    const screenshots = await capturePageScreenshots(tab, pageInfo);
    const { scrollHeight, viewportHeight, viewportWidth, devicePixelRatio } = pageInfo;

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

// Keep temporary page changes and their cleanup in one lifecycle.
async function capturePageScreenshots(tab, pageInfo) {
  const target = { tabId: tab.id };
  const screenshots = [];

  try {
    const [{ result: dimensions }] = await chrome.scripting.executeScript({
      target,
      func: () => {
        document.documentElement.style.overflow = 'hidden';
        window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
        // Hiding scrollbars can reflow text and change the document height.
        return {
          scrollHeight: Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight),
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth
        };
      }
    });
    Object.assign(pageInfo, dimensions);
    await sleep(500);
    // Shrinking sticky headers often also shrink the main content's top gap.
    // Keep that gap at its top-of-page value so scrolling does not repeatedly
    // change the document height. Allow other content to keep loading normally.
    const [{ result: stableDimensions }] = await chrome.scripting.executeScript({
      target,
      func: () => {
        const spacing = [];
        window.__websnapsCaptureSpacing = spacing;
        for (const element of document.querySelectorAll?.('main, [role="main"]') || []) {
          const computed = getComputedStyle(element);
          for (const property of ['padding-top', 'margin-top']) {
            spacing.push({
              element, property,
              value: element.style.getPropertyValue(property),
              priority: element.style.getPropertyPriority(property)
            });
            element.style.setProperty(property, computed.getPropertyValue(property), 'important');
          }
        }
        // Sticky elements belong at their natural document position. Fixed
        // overlays are retained in the first frame and hidden in later frames.
        const restore = changes => {
          for (const [element, properties] of changes) {
            const transition = properties.find(item => item.property === 'transition');
            for (const { property, value, priority } of properties) {
              if (property === 'transition') continue;
              if (value) element.style.setProperty(property, value, priority);
              else element.style.removeProperty(property);
            }
            if (transition) {
              // Commit restored opacity while transitions are still disabled.
              // Otherwise a restarted first frame could catch a fading header.
              element.getBoundingClientRect?.();
              if (transition.value) element.style.setProperty('transition', transition.value, transition.priority);
              else element.style.removeProperty('transition');
            }
          }
          changes.clear();
        };
        const apply = (changes, element, values) => {
          if (!changes.has(element)) {
            changes.set(element, Object.keys(values).map(property => ({
              property,
              value: element.style.getPropertyValue(property),
              priority: element.style.getPropertyPriority(property)
            })));
          }
          for (const [property, value] of Object.entries(values)) {
            element.style.setProperty(property, value, 'important');
          }
        };
        const layers = {
          sticky: new Map(),
          fixed: new Map(),
          update(firstFrame) {
            if (firstFrame) restore(this.fixed);
            for (const element of document.querySelectorAll?.('*') || []) {
              const position = getComputedStyle(element).position;
              if (position === 'sticky') {
                apply(this.sticky, element, {
                  position: 'relative', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto'
                });
              } else if (position === 'fixed' && !firstFrame) {
                const rect = element.getBoundingClientRect();
                // Preserve viewport-sized background layers and app surfaces.
                if (rect.width >= window.innerWidth * 0.8 && rect.height >= window.innerHeight * 0.8) continue;
                if (rect.width <= 0 || rect.height <= 0) continue;
                apply(this.fixed, element, { visibility: 'hidden', opacity: '0', transition: 'none' });
              }
            }
          },
          restore() {
            restore(this.fixed);
            restore(this.sticky);
          }
        };
        window.__websnapsCaptureLayers = layers;
        layers.update(true);
        return {
          scrollHeight: Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight),
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth
        };
      }
    });
    Object.assign(pageInfo, stableDimensions);

    let requestedY = 0;
    let coveredHeight = 0;
    let layoutRetries = 0;
    const readPageState = async () => {
      const [{ result }] = await chrome.scripting.executeScript({
        target,
        func: () => ({
          scrollY: window.scrollY,
          scrollHeight: Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight
        })
      });
      return result;
    };
    const layoutChanged = state => state.scrollHeight !== pageInfo.scrollHeight ||
      state.viewportWidth !== pageInfo.viewportWidth || state.viewportHeight !== pageInfo.viewportHeight;
    const restartForLayout = async state => {
      if (++layoutRetries > 3) {
        throw new Error('ページのレイアウトが変化し続けています。読み込みが完了してから撮影し直してください');
      }
      Object.assign(pageInfo, {
        scrollHeight: state.scrollHeight,
        viewportWidth: state.viewportWidth,
        viewportHeight: state.viewportHeight
      });
      screenshots.length = 0;
      requestedY = 0;
      coveredHeight = 0;
      await chrome.scripting.executeScript({
        target,
        func: () => window.scrollTo({ left: 0, top: 0, behavior: 'instant' })
      });
    };
    while (coveredHeight < pageInfo.scrollHeight) {
      if (requestedY > 0) {
        await chrome.scripting.executeScript({
          target,
          func: (y) => window.scrollTo({ left: 0, top: y, behavior: 'instant' }),
          args: [requestedY]
        });
      }
      await sleep(600);
      await chrome.scripting.executeScript({
        target,
        func: firstFrame => window.__websnapsCaptureLayers?.update(firstFrame),
        args: [screenshots.length === 0]
      });
      await sleep(32);
      // Ads and lazy-loaded content can shift even previously captured content.
      // Restart instead of stitching different layouts or chasing an old bottom.
      const pageState = await readPageState();
      if (layoutChanged(pageState)) {
        await restartForLayout(pageState);
        continue;
      }
      // At the bottom, the actual scroll offset is lower than the requested one.
      const { scrollY } = pageState;
      const previousShot = screenshots[screenshots.length - 1];
      if (!Number.isFinite(scrollY) || scrollY < 0 || scrollY > coveredHeight + 1 ||
          (previousShot && scrollY <= previousShot.scrollY)) {
        throw new Error('ページ全体の撮影中にスクロール位置を更新できませんでした');
      }
      const dataUrl = await captureTab(tab);
      const afterCapture = await readPageState();
      if (layoutChanged(afterCapture)) {
        await restartForLayout(afterCapture);
        continue;
      }
      if (Math.abs(afterCapture.scrollY - scrollY) > 1) {
        throw new Error('撮影中にスクロール位置が変わりました。ページを操作せずに撮影し直してください');
      }
      screenshots.push({ dataUrl, scrollY });
      coveredHeight = scrollY + pageInfo.viewportHeight;
      // At fractional device scales the body's rounded height can exceed the
      // actual scroll limit by a fraction of a CSS pixel. A clamped final scroll
      // has already reached the bottom; do not try to capture that sliver again.
      if (requestedY > scrollY + 1 && pageInfo.scrollHeight - coveredHeight <= 1) {
        pageInfo.scrollHeight = Math.min(pageInfo.scrollHeight, coveredHeight);
      }
      requestedY = coveredHeight;
    }
    return screenshots;
  } finally {
    await chrome.scripting.executeScript({
      target,
      func: (x, y, overflow, priority) => {
        window.__websnapsCaptureLayers?.restore();
        delete window.__websnapsCaptureLayers;
        for (const { element, property, value, priority: spacingPriority } of window.__websnapsCaptureSpacing || []) {
          if (value) element.style.setProperty(property, value, spacingPriority);
          else element.style.removeProperty(property);
        }
        delete window.__websnapsCaptureSpacing;
        if (overflow) {
          document.documentElement.style.setProperty('overflow', overflow, priority);
        } else {
          document.documentElement.style.removeProperty('overflow');
        }
        window.scrollTo({ left: x, top: y, behavior: 'instant' });
      },
      args: [pageInfo.originalScrollX, pageInfo.originalScrollY,
        pageInfo.originalOverflow, pageInfo.originalOverflowPriority]
    });
  }
}

// captureVisibleTab is rate-limited across all windows, not just one tab.
let captureQueue = Promise.resolve();
let lastCaptureTime = 0;

function captureTab(tab) {
  const request = captureQueue.then(async () => {
    await sleep(Math.max(0, 600 - (Date.now() - lastCaptureTime)));
    const assertActive = async () => {
      const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      if (activeTab?.id !== tab.id) {
        throw new Error('撮影中にタブが切り替わりました。元のページでもう一度撮影してください');
      }
    };
    await assertActive();
    lastCaptureTime = Date.now();
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await assertActive();
    return dataUrl;
  });
  captureQueue = request.catch(() => {});
  return request;
}

async function openEditor(data) {
  await captureCleanup;
  const { format } = await chrome.storage.local.get('format');
  const id = await CaptureStore.save({ ...data, format: format === 'jpg' ? 'jpg' : 'png' });
  try {
    const editorUrl = chrome.runtime.getURL('editor/editor.html');
    const editorTab = await chrome.tabs.create({ url: `${editorUrl}?capture=${encodeURIComponent(id)}` });
    await CaptureStore.attach(id, editorTab.id);
  } catch (error) {
    await CaptureStore.remove(id);
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
