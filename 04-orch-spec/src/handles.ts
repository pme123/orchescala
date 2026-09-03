// Ordner-Zugriffe über die Sitzung hinaus merken.
//
// Ein `FileSystemDirectoryHandle` lässt sich in IndexedDB ablegen — der
// Browser gibt ihn beim nächsten Start zurück, verlangt aber die Erlaubnis
// neu. Genau dafür `ensureRead`: fragt zuerst still nach dem bestehenden
// Recht und erst dann den Nutzer.
//
// Genutzt für den Datenordner (`dir`) und für jeden Projekt-Ordner
// (`project:<id>`) des Domain-Katalogs.

const DB = 'orch-spec';
const STORE = 'handles';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[orch-spec] putHandle:', e);
  }
}

export async function getHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function delHandle(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* dann bleibt er eben liegen */ }
}

/** Leserecht sicherstellen — erst still, dann mit Rückfrage. */
export async function ensureRead(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
    requestPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
  };
  try {
    if (await h.queryPermission?.({ mode: 'read' }) === 'granted') return true;
    return await h.requestPermission?.({ mode: 'read' }) === 'granted';
  } catch {
    return false;
  }
}
