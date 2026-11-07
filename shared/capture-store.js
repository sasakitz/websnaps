// Temporary capture handoff shared by the service worker and editor tabs.
// IndexedDB avoids chrome.storage.session's small JSON quota for image data.
const CaptureStore = (() => {
  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('websnaps-captures', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('captures', { keyPath: 'id' });
        store.createIndex('tabId', 'tabId');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function transaction(mode, operation) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('captures', mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(tx.error || new Error('画像データの保存処理が中断されました'));
        tx.onerror = () => {}; // The transaction abort reports the error.
        try {
          operation(tx.objectStore('captures'), value => { result = value; });
        } catch (error) {
          tx.abort();
          reject(error);
        }
      });
    } finally {
      db.close();
    }
  }

  return {
    async save(data) {
      const id = crypto.randomUUID();
      await transaction('readwrite', store => store.put({ id, data }));
      return id;
    },
    get(id) {
      return transaction('readonly', (store, done) => {
        store.get(id).onsuccess = event => done(event.target.result?.data);
      });
    },
    attach(id, tabId) {
      return transaction('readwrite', store => {
        store.get(id).onsuccess = event => {
          if (event.target.result) store.put({ ...event.target.result, tabId });
        };
      });
    },
    remove(id) {
      return transaction('readwrite', store => store.delete(id));
    },
    removeForTab(tabId) {
      return transaction('readwrite', store => {
        store.index('tabId').openCursor(IDBKeyRange.only(tabId)).onsuccess = event => {
          const cursor = event.target.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };
      });
    },
    prune(activeIds) {
      const active = new Set(activeIds);
      return transaction('readwrite', store => {
        store.openCursor().onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor) return;
          if (!active.has(cursor.key)) cursor.delete();
          cursor.continue();
        };
      });
    }
  };
})();
