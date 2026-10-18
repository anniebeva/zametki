
let db;
let sessionId = null;
let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let pendingSaves = [];
let stopProcessingPromise = Promise.resolve();
let visitActive = false;
let recordingStarted = false;
let currentAudioUrl = null;
let recordingStartedAt = null;
let recordingDuration = 0;

const recordButton = document.getElementById("record-button");
const startVisitButton = document.getElementById("start-visit-button");
const finishVisitButton = document.getElementById("finish-visit-button");
const restoreAudioButton = document.getElementById("restore-audio-button");
const status = document.getElementById("status");
const transcription = document.getElementById("transcription");
const audioPlayback = document.getElementById("audio-playback");
const medicalNote = document.getElementById("medical-note");
const transcribeButton = document.getElementById("transcribe-button");
const generateNoteButton = document.getElementById("generate-note-button");
const copyTranscriptionButton = document.getElementById(
    "copy-transcription-button"
);
const copyNoteButton = document.getElementById("copy-note-button");

const INITIAL_TRANSCRIPTION = "Здесь появится распознанный текст";

const dbRequest = indexedDB.open("zametki", 1);

dbRequest.addEventListener("success", (event) => {
    db = event.target.result;
    console.log("IndexedDB подключена");
    restoreLatestSession();
});

dbRequest.addEventListener("upgradeneeded", (event) => {
    db = event.target.result;

    if (!db.objectStoreNames.contains("audioChunks")) {
        db.createObjectStore("audioChunks", {
            keyPath: "id",
            autoIncrement: true,
        });
    }

    console.log("Хранилище аудиофрагментов создано");
});

dbRequest.addEventListener("error", () => {
    console.error("Не удалось открыть IndexedDB", dbRequest.error);
    status.textContent = "Не удалось открыть локальное хранилище";
});

function setStatus(message) {
    status.textContent = message;
}

function getAllAudioChunks() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("audioChunks", "readonly");
        const store = transaction.objectStore("audioChunks");
        const request = store.getAll();

        request.addEventListener("success", () => {
            resolve(request.result);
        });

        request.addEventListener("error", () => {
            reject(request.error);
        });
    });
}

function saveAudioChunk(chunk) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("audioChunks", "readwrite");
        const store = transaction.objectStore("audioChunks");

        store.add({
            sessionId,
            audio: chunk,
            createdAt: Date.now(),
        });

        transaction.addEventListener("complete", resolve);
        transaction.addEventListener("error", () => {
            reject(transaction.error);
        });
        transaction.addEventListener("abort", () => {
            reject(transaction.error || new Error("Сохранение отменено"));
        });
    });
}

async function getAudioChunks(currentSessionId) {
    const allChunks = await getAllAudioChunks();

    return allChunks
        .filter((chunk) => chunk.sessionId === currentSessionId)
        .sort((a, b) => a.id - b.id);
}

async function getLatestSessionId() {
    const allChunks = await getAllAudioChunks();

    if (allChunks.length === 0) {
        return null;
    }

    allChunks.sort((a, b) => b.createdAt - a.createdAt);
    return allChunks[0].sessionId;
}


async function restoreAudio(currentSessionId) {
    const chunks = await getAudioChunks(currentSessionId);

    if (chunks.length === 0) {
        return false;
    }

    const audioBlob = new Blob(
        chunks.map((chunk) => chunk.audio),
        { type: "audio/webm" }
    );

    const fixedBlob = await window.ysFixWebmDuration(
        audioBlob,
        recordingDuration
    );

    if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
    }

    currentAudioUrl = URL.createObjectURL(fixedBlob);
    audioPlayback.src = currentAudioUrl;
    audioPlayback.hidden = false;

    return true;
}


async function restoreLatestSession() {
    try {
        const latestSessionId = await getLatestSessionId();

        if (!latestSessionId) {
            setStatus("Запись не начата");
            return;
        }

        sessionId = latestSessionId;

        await restoreAudio(sessionId);

        setStatus("Найдена сохранённая запись");
        recordButton.textContent = "Продолжить запись";
        restoreAudioButton.textContent = "Обновить аудиозапись";

        console.log("Восстановлена сессия:", sessionId);
    } catch (error) {
        console.error("Не удалось восстановить запись", error);
        setStatus("Не удалось восстановить запись");
    }
}

async function getMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Браузер не поддерживает запись с микрофона");
    }

    return navigator.mediaDevices.getUserMedia({ audio: true });
}

function updateVisitControls() {
    startVisitButton.disabled = visitActive;
    finishVisitButton.disabled = !visitActive;
}

startVisitButton.addEventListener("click", () => {
    visitActive = true;

    if (!sessionId) {
        sessionId = crypto.randomUUID();
    }

    setStatus("Приём начат. Можно начинать запись");
    updateVisitControls();
});

recordButton.addEventListener("click", async () => {
    if (mediaRecorder?.state === "recording") {
        mediaRecorder.stop();
        recordButton.textContent = "Обработка аудио…";
        recordButton.disabled = true;
        return;
    }

    if (mediaRecorder?.state === "paused") {
        mediaRecorder.resume();
        recordButton.textContent = "Остановить запись";
        setStatus("Запись продолжается");
        return;
    }

    try {
        if (!db) {
            throw new Error("Локальное хранилище ещё не готово");
        }

        if (!sessionId) {
            sessionId = crypto.randomUUID();
        }

        if (!visitActive) {
            visitActive = true;
            updateVisitControls();
        }

        audioStream = await getMicrophone();
        audioChunks = [];
        pendingSaves = [];

        mediaRecorder = new MediaRecorder(audioStream);

        mediaRecorder.addEventListener("dataavailable", (event) => {
            if (event.data.size === 0) {
                return;
            }

            audioChunks.push(event.data);

            const savePromise = saveAudioChunk(event.data);
            pendingSaves.push(savePromise);

            savePromise.catch((error) => {
                console.error("Не удалось сохранить аудиофрагмент", error);
                setStatus("Ошибка сохранения аудио");
            });
        });

        mediaRecorder.addEventListener("stop", () => {
            if (recordingStartedAt !== null) {
                recordingDuration = Date.now() - recordingStartedAt;
                recordingStartedAt = null;
            }
            stopProcessingPromise = processStoppedRecording();
        });

        recordingStartedAt = Date.now();
        mediaRecorder.start(5000);
        recordingStarted = true;

        setStatus("Идёт запись");
        recordButton.textContent = "Остановить запись";
    } catch (error) {
        console.error("Не удалось начать запись", error);
        setStatus(`Не удалось начать запись: ${error.message}`);

        audioStream?.getTracks().forEach((track) => track.stop());
        audioStream = null;
    }
});

async function processStoppedRecording() {
    audioStream?.getTracks().forEach((track) => track.stop());
    audioStream = null;

    try {
        await Promise.all(pendingSaves);

        setStatus("Подготавливаем аудио для распознавания…");

        await transcribeCurrentSession();
    } catch (error) {
        console.error("Не удалось обработать запись", error);
        setStatus("Запись сохранена не полностью или не удалось её обработать");
    } finally {
        recordButton.disabled = false;
        recordButton.textContent = "Продолжить запись";
    }
}

async function transcribeCurrentSession() {
    if (!sessionId) {
        setStatus("Нет записи для распознавания");
        return;
    }

    const chunks = await getAudioChunks(sessionId);

    if (chunks.length === 0) {
        setStatus("В текущей сессии нет аудиофрагментов");
        return;
    }

    const audioBlob = new Blob(
        chunks.map((chunk) => chunk.audio),
        { type: "audio/webm" }
    );

    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");

    setStatus("Распознаём аудио…");
    transcribeButton.disabled = true;

    try {
        const response = await fetch("/upload-audio", {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`Ошибка сервера: ${response.status}`);
        }

        const data = await response.json();

        transcription.textContent = data.text || "";
        setStatus("Распознавание завершено");
        await restoreAudio(sessionId);
    } finally {
        transcribeButton.disabled = false;
    }
}

transcribeButton.addEventListener("click", async () => {
    try {
        await transcribeCurrentSession();
    } catch (error) {
        console.error("Ошибка распознавания", error);
        setStatus("Не удалось распознать аудио");
    }
});

restoreAudioButton.addEventListener("click", async () => {
    try {
        if (!sessionId) {
            await restoreLatestSession();
            return;
        }

        const restored = await restoreAudio(sessionId);

        setStatus(
            restored
                ? "Аудиозапись восстановлена"
                : "Аудиозапись не найдена"
        );
    } catch (error) {
        console.error("Ошибка восстановления аудио", error);
        setStatus("Не удалось восстановить аудио");
    }
});

async function copyText(text) {
    if (!text.trim()) {
        setStatus("Нет текста для копирования");
        return;
    }

    try {
        await navigator.clipboard.writeText(text);
        setStatus("Текст скопирован");
    } catch (error) {
        console.error("Не удалось скопировать текст", error);
        setStatus("Не удалось скопировать текст");
    }
}

copyTranscriptionButton.addEventListener("click", () => {
    const text = transcription.textContent === INITIAL_TRANSCRIPTION
        ? ""
        : transcription.textContent;

    copyText(text);
});

copyNoteButton.addEventListener("click", () => {
    copyText(medicalNote.value);
});

generateNoteButton.addEventListener("click", () => {
    setStatus("Генерация медицинской заметки пока не подключена");
});

finishVisitButton.addEventListener("click", async () => {
    const confirmed = window.confirm(
        "Завершить приём и удалить его аудио из локального хранилища? " +
        "Это действие нельзя отменить."
    );

    if (!confirmed) {
        return;
    }

    try {
        if (mediaRecorder?.state === "recording") {
            const stopped = new Promise((resolve) => {
                mediaRecorder.addEventListener("stop", resolve, { once: true });
            });

            mediaRecorder.stop();
            await stopped;
            await stopProcessingPromise;
        }

        if (sessionId && db) {
            await deleteSessionAudio(sessionId);
        }

        if (currentAudioUrl) {
            URL.revokeObjectURL(currentAudioUrl);
            currentAudioUrl = null;
        }

        audioPlayback.removeAttribute("src");
        audioPlayback.hidden = true;

        transcription.textContent = INITIAL_TRANSCRIPTION;
        medicalNote.value = "";

        sessionId = null;
        visitActive = false;
        recordingStarted = false;
        mediaRecorder = null;
        audioChunks = [];

        recordButton.disabled = false;
        recordButton.textContent = "Начать запись";

        setStatus("Приём завершён");
        updateVisitControls();
    } catch (error) {
        console.error("Не удалось завершить приём", error);
        setStatus("Не удалось завершить приём");
    }
});

function deleteSessionAudio(currentSessionId) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("audioChunks", "readwrite");
        const store = transaction.objectStore("audioChunks");
        const request = store.openCursor();

        request.addEventListener("success", () => {
            const cursor = request.result;

            if (!cursor) {
                return;
            }

            if (cursor.value.sessionId === currentSessionId) {
                cursor.delete();
            }

            cursor.continue();
        });

        transaction.addEventListener("complete", resolve);
        transaction.addEventListener("error", () => {
            reject(transaction.error);
        });
        transaction.addEventListener("abort", () => {
            reject(transaction.error || new Error("Удаление отменено"));
        });
    });
}

updateVisitControls();
