const DB_NAME = "zametki";
const DB_VERSION = 3;

let dbPromise = null;

export function initDB() {
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const database = request.result;

            if (!database.objectStoreNames.contains("audioChunks")) {
                database.createObjectStore("audioChunks", {
                    keyPath: "id",
                    autoIncrement: true
                });
            }

            if (!database.objectStoreNames.contains("sessions")) {
                database.createObjectStore("sessions", {
                    keyPath: "sessionId"
                });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            dbPromise = null;
            reject(request.error);
        };
    });

    return dbPromise;
}

async function runTransaction(storeName, mode, action) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);

        let request;

        try {
            request = action(store);
        } catch (error) {
            reject(error);
            return;
        }

        if (request) {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        } else {
            transaction.oncomplete = () => resolve();
        }

        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

export function saveSession(session) {
    return runTransaction("sessions", "readwrite", store =>
        store.put({
            ...session,
            updatedAt: Date.now()
        })
    );
}

export function getSession(sessionId) {
    return runTransaction("sessions", "readonly", store =>
        store.get(sessionId)
    );
}

export function getAllSessions() {
    return runTransaction("sessions", "readonly", store =>
        store.getAll()
    );
}

export function saveAudioChunk(sessionId, audio) {
    return runTransaction("audioChunks", "readwrite", store =>
        store.add({
            sessionId,
            audio,
            createdAt: Date.now()
        })
    );
}

export function getAudioChunks(sessionId) {
    return runTransaction("audioChunks", "readonly", store =>
        store.getAll()
    ).then(chunks =>
        chunks
            .filter(chunk => chunk.sessionId === sessionId)
            .sort((a, b) => a.id - b.id)
    );
}

export async function getLatestSessionId() {
    const sessions = await getAllSessions();

    const activeSessions = sessions
        .filter(session => session.status === "active")
        .sort((a, b) => (b.updatedAt || b.createdAt) -
                        (a.updatedAt || a.createdAt));

    if (activeSessions.length) {
        return activeSessions[0].sessionId;
    }

    const database = await initDB();

    const chunks = await new Promise((resolve, reject) => {
        const transaction = database.transaction("audioChunks", "readonly");
        const request = transaction.objectStore("audioChunks").getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    if (!chunks.length) {
        return null;
    }

    return chunks.sort((a, b) => b.id - a.id)[0].sessionId;
}

export async function deleteSessionData(sessionId) {
    const database = await initDB();

    await new Promise((resolve, reject) => {
        const transaction = database.transaction(
            ["audioChunks", "sessions"],
            "readwrite"
        );

        const chunksStore = transaction.objectStore("audioChunks");
        const sessionsStore = transaction.objectStore("sessions");
        const request = chunksStore.getAll();

        request.onsuccess = () => {
            for (const chunk of request.result) {
                if (chunk.sessionId === sessionId) {
                    chunksStore.delete(chunk.id);
                }
            }

            sessionsStore.delete(sessionId);
        };

        request.onerror = () => reject(request.error);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}
