import {
    initDB,
    getSession,
    saveSession,
    saveAudioChunk,
    getAudioChunks,
    getLatestSessionId,
    deleteSessionData,
} from "./storage.js";

import {
    startRecordingTimer,
    stopRecordingTimer,
    setElapsedTime,
    getElapsedTime,
    resetRecordingTimer,
} from "./recording-timer.js";

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

function setStatus(message) {
    status.textContent = message;
}

function updateVisitControls() {
    startVisitButton.disabled = visitActive;
    finishVisitButton.disabled = !visitActive;
}

function revokeCurrentAudioUrl() {
    if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
        currentAudioUrl = null;
    }
}

async function restoreAudio(currentSessionId) {
    const chunks = await getAudioChunks(currentSessionId);

    revokeCurrentAudioUrl();

    if (chunks.length === 0) {
        audioPlayback.removeAttribute("src");
        audioPlayback.hidden = true;
        audioPlayback.load();
        return false;
    }

    const audioBlob = new Blob(
        chunks.map((chunk) => chunk.audio),
        { type: "audio/webm" }
    );

    const duration = Math.max(recordingDuration, getElapsedTime());

    const fixedBlob = typeof window.ysFixWebmDuration === "function"
        ? await window.ysFixWebmDuration(audioBlob, duration)
        : audioBlob;

    currentAudioUrl = URL.createObjectURL(fixedBlob);
    audioPlayback.src = currentAudioUrl;
    audioPlayback.hidden = false;
    audioPlayback.load();

    return true;
}

async function restoreLatestSession() {
    const latestSessionId = await getLatestSessionId();

    if (!latestSessionId) {
        sessionId = null;
        visitActive = false;

        resetRecordingTimer();
        transcription.textContent = INITIAL_TRANSCRIPTION;

        updateVisitControls();
        setStatus("Запись не начата");
        return;
    }

    sessionId = latestSessionId;

    let session = await getSession(sessionId);

    // Восстанавливаем метаданные старых сессий.
    if (!session) {
        session = {
            sessionId,
            status: "active",
            transcription: "",
            elapsedMilliseconds: 0,
            lastSegmentDuration: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        await saveSession(session);
    }

    if (session.status !== "active") {
        sessionId = null;
        visitActive = false;

        resetRecordingTimer();
        updateVisitControls();
        setStatus("Нет незавершённого приёма");
        return;
    }

    visitActive = true;

    setElapsedTime(session.elapsedMilliseconds || 0);
    recordingDuration = session.lastSegmentDuration || 0;

    transcription.textContent =
        session.transcription || INITIAL_TRANSCRIPTION;

    await restoreAudio(sessionId);

    recordButton.textContent = "Продолжить запись";
    restoreAudioButton.textContent = "Обновить аудиозапись";

    updateVisitControls();
    setStatus("Восстановлен незавершённый приём");

    console.log("Восстановлена сессия:", sessionId);
}

async function getMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Браузер не поддерживает запись с микрофона");
    }

    return navigator.mediaDevices.getUserMedia({ audio: true });
}

async function createVisit() {
    const newSessionId = crypto.randomUUID();

    await saveSession({
        sessionId: newSessionId,
        status: "active",
        transcription: "",
        elapsedMilliseconds: 0,
        lastSegmentDuration: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });

    sessionId = newSessionId;
    visitActive = true;
    recordingStarted = false;
    recordingStartedAt = null;
    recordingDuration = 0;

    audioChunks = [];
    pendingSaves = [];

    resetRecordingTimer();

    transcription.textContent = INITIAL_TRANSCRIPTION;
    medicalNote.value = "";

    revokeCurrentAudioUrl();

    audioPlayback.removeAttribute("src");
    audioPlayback.hidden = true;
    audioPlayback.load();

    updateVisitControls();
    setStatus("Приём начат. Можно начинать запись");
}

startVisitButton.addEventListener("click", async () => {
    try {
        if (visitActive) {
            return;
        }

        await createVisit();
    } catch (error) {
        console.error("Не удалось создать приём", error);
        setStatus("Не удалось создать приём");
    }
});

recordButton.addEventListener("click", async () => {
    if (mediaRecorder?.state === "recording") {
        recordButton.disabled = true;
        recordButton.textContent = "Обработка аудио…";
        mediaRecorder.stop();
        return;
    }

    if (mediaRecorder?.state === "paused") {
        mediaRecorder.resume();

        recordingStartedAt = Date.now();
        startRecordingTimer();

        recordButton.textContent = "Остановить запись";
        setStatus("Запись продолжается");
        return;
    }

    try {
        if (!db) {
            throw new Error("Локальное хранилище ещё не готово");
        }

        if (!sessionId || !visitActive) {
            await createVisit();
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

            const savePromise = saveAudioChunk(sessionId, event.data);
            pendingSaves.push(savePromise);

            savePromise.catch((error) => {
                console.error(
                    "Не удалось сохранить аудиофрагмент",
                    error
                );
                setStatus("Ошибка сохранения аудио");
            });
        });

        mediaRecorder.addEventListener("stop", () => {
            if (recordingStartedAt !== null) {
                recordingDuration = Date.now() - recordingStartedAt;
                recordingStartedAt = null;
            }

            stopRecordingTimer();
            stopProcessingPromise = processStoppedRecording();
        });

        recordingStartedAt = Date.now();

        mediaRecorder.start(5000);
        recordingStarted = true;

        startRecordingTimer();

        setStatus("Идёт запись");
        recordButton.textContent = "Остановить запись";
    } catch (error) {
        console.error("Не удалось начать запись", error);
        setStatus(`Не удалось начать запись: ${error.message}`);

        audioStream?.getTracks().forEach((track) => track.stop());
        audioStream = null;

        recordingStartedAt = null;
        stopRecordingTimer();
    }
});

async function processStoppedRecording() {
    audioStream?.getTracks().forEach((track) => track.stop());
    audioStream = null;

    try {
        await Promise.all(pendingSaves);

        const session = await getSession(sessionId);

        if (session) {
            await saveSession({
                ...session,
                elapsedMilliseconds: getElapsedTime(),
                lastSegmentDuration: recordingDuration,
            });
        }

        setStatus("Подготавливаем аудио для распознавания…");

        await transcribeCurrentSession();
    } catch (error) {
        console.error("Не удалось обработать запись", error);
        setStatus(
            "Запись сохранена не полностью или не удалось её обработать"
        );
    } finally {
        recordingStarted = false;
        recordButton.disabled = false;
        recordButton.textContent = "Продолжить запись";
    }
}

async function transcribeCurrentSession() {
    if (!sessionId) {
        setStatus("Нет записи для распознавания");
        return;
    }

    const currentSessionId = sessionId;
    const chunks = await getAudioChunks(currentSessionId);

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
        const text = data.text || "";

        const session = await getSession(currentSessionId);

        if (!session || session.status !== "active") {
            throw new Error("Приём уже завершён или не найден");
        }

        await saveSession({
            ...session,
            transcription: text,
        });

        if (sessionId === currentSessionId) {
            transcription.textContent = text || INITIAL_TRANSCRIPTION;

            setStatus("Распознавание завершено");

            await restoreAudio(currentSessionId);
        }
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
    if (!sessionId || !visitActive) {
        return;
    }

    const confirmed = window.confirm(
        "Завершить приём и удалить его аудио и транскрипцию " +
        "из локального хранилища? Это действие нельзя отменить."
    );

    if (!confirmed) {
        return;
    }

    const finishingSessionId = sessionId;

    try {
        if (
            mediaRecorder?.state === "recording" ||
            mediaRecorder?.state === "paused"
        ) {
            const stopped = new Promise((resolve) => {
                mediaRecorder.addEventListener("stop", resolve, {
                    once: true,
                });
            });

            mediaRecorder.stop();

            await stopped;
            await stopProcessingPromise;
        }

        await deleteSessionData(finishingSessionId);

        revokeCurrentAudioUrl();

        audioPlayback.removeAttribute("src");
        audioPlayback.hidden = true;
        audioPlayback.load();

        transcription.textContent = INITIAL_TRANSCRIPTION;
        medicalNote.value = "";

        sessionId = null;
        visitActive = false;
        recordingStarted = false;
        mediaRecorder = null;
        audioChunks = [];
        pendingSaves = [];
        recordingDuration = 0;
        recordingStartedAt = null;

        stopRecordingTimer();
        resetRecordingTimer();

        recordButton.disabled = false;
        recordButton.textContent = "Начать запись";

        setStatus("Приём завершён");
        updateVisitControls();
    } catch (error) {
        console.error("Не удалось завершить приём", error);
        setStatus("Не удалось завершить приём");
    }
});

async function initialize() {
    try {
        db = await initDB();

        console.log("IndexedDB подключена");

        await restoreLatestSession();
    } catch (error) {
        console.error("Не удалось восстановить приём", error);
        setStatus("Не удалось открыть локальное хранилище");
    }

    updateVisitControls();
}

initialize();
