const DB_NAME = 'ai-council-db';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('rooms')) {
        db.createObjectStore('rooms', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllRooms() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rooms', 'readonly');
    const req = tx.objectStore('rooms').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRoom(room) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rooms', 'readwrite');
    tx.objectStore('rooms').put(room);
    tx.oncomplete = () => resolve(room);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteRoom(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rooms', 'readwrite');
    tx.objectStore('rooms').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getRoom(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rooms', 'readonly');
    const req = tx.objectStore('rooms').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
