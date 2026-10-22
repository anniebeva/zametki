const DB_NAME = "zametki";
const DB_VERSION = 4;

let dbPromise = null;

/** Open the local database and create indexes when upgrading */
export function initDB() {
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const database = request.result;
            const transaction = request.transaction;

            let audioStore;

            if (!database.objectStoreNames.contains("audioChunks")) {
                audioStore = database.createObjectStore("audioChunks", {
                    keyPath: "id",
                    autoIncrement: true,
                });
            } else {
                audioStore = transaction.objectStore("audioChunks");
            }

            if (!audioStore.indexNames.contains("sessionId")) {
                audioStore.createIndex("sessionId", "sessionId", {
                    unique: false,
                });
            }

            if (!database.objectStoreNames.contains("sessions")) {
                database.createObjectStore("sessions", {
                    keyPath: "sessionId",
                });
            }
        };

        request.onsuccess = () => {
            const database = request.result;

            database.onversionchange = () => {
                database.close();
                dbPromise = null;
            };

            resolve(database);
        };

        request.onerror = () => {
            dbPromise = null;
            reject(request.error);
        };

        request.onblocked = () => {
            console.error(
                "Обновление базы заблокировано другой открытой вкладкой",
            );
        };
    });

    return dbPromise;
}

/** Run a request against one object store */
async function runTransaction(storeName, mode, action) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);

        let request;

        try {
            request = action(store);
        } catch (error) {
            transaction.abort();
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

/** Save session metadata */
export function saveSession(session) {
    return runTransaction("sessions", "readwrite", (store) =>
        store.put({
            ...session,
            updatedAt: Date.now(),
        }),
    );
}

/** Load one session */
export function getSession(sessionId) {
    return runTransaction("sessions", "readonly", (store) =>
        store.get(sessionId),
    );
}

/** Load all session metadata */
export function getAllSessions() {
    return runTransaction("sessions", "readonly", (store) =>
        store.getAll(),
    );
}

/** Save an audio chunk and update the session version atomically */
export async function saveAudioChunk(sessionId, audio) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(
            ["audioChunks", "sessions"],
            "readwrite",
        );

        const chunksStore = transaction.objectStore("audioChunks");
        const sessionsStore = transaction.objectStore("sessions");

        let chunkId = null;
        let sessionError = null;

        const request = sessionsStore.get(sessionId);

        request.onsuccess = () => {
            const session = request.result;

            if (!session || session.status !== "active") {
                sessionError = new Error(
                    "Активный приём не найден. Аудиофрагмент не сохранён.",
                );
                transaction.abort();
                return;
            }

            chunkId = chunksStore.add({
                sessionId,
                audio,
                createdAt: Date.now(),
            });

            session.audioVersion = (session.audioVersion || 0) + 1;
            session.transcriptionStatus = "stale";
            session.transcriptionError = "";

            session.noteStatus = session.medicalNote ? "stale" : "idle";
            session.noteError = "";

            session.updatedAt = Date.now();

            sessionsStore.put(session);
        };

        request.onerror = () => {
            sessionError = request.error;
            transaction.abort();
        };

        transaction.oncomplete = () => {
            resolve(chunkId.result);
        };

        transaction.onerror = () => {
            reject(sessionError || transaction.error);
        };

        transaction.onabort = () => {
            reject(sessionError || transaction.error);
        };
    });
}

/** Load audio chunks belonging to one session */
export function getAudioChunks(sessionId) {
    return runTransaction("audioChunks", "readonly", (store) =>
        store.index("sessionId").getAll(sessionId),
    ).then((chunks) => chunks.sort((a, b) => a.id - b.id));
}

/** Find the latest active session or the session owning the latest audio */
export async function getLatestSessionId() {
    const sessions = await getAllSessions();

    const activeSessions = sessions
        .filter((session) => session.status === "active")
        .sort(
            (a, b) =>
                (b.updatedAt || b.createdAt) -
                (a.updatedAt || a.createdAt),
        );

    if (activeSessions.length) {
        return activeSessions[0].sessionId;
    }

    const database = await initDB();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction("audioChunks", "readonly");
        const store = transaction.objectStore("audioChunks");
        const request = store.openCursor(null, "prev");

        request.onsuccess = () => {
            const cursor = request.result;
            resolve(cursor ? cursor.value.sessionId : null);
        };

        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
    });
}

/** Delete a session and all its audio chunks in one transaction */
export async function deleteSessionData(sessionId) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(
            ["audioChunks", "sessions"],
            "readwrite",
        );

        const chunksStore = transaction.objectStore("audioChunks");
        const sessionsStore = transaction.objectStore("sessions");
        const request = chunksStore.index("sessionId").getAllKeys(sessionId);

        request.onsuccess = () => {
            for (const key of request.result) {
                chunksStore.delete(key);
            }

            sessionsStore.delete(sessionId);
        };

        request.onerror = () => {
            transaction.abort();
            reject(request.error);
        };

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}
