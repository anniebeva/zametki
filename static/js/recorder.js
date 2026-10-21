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

import {
    restoreAudio,
    revokeCurrentAudioUrl,
} from "./audio-playback.js";

import { createRecordingController } from "./recording.js";

import {
    createVisitSession,
    restoreLatestSession as loadLatestSession,
    deleteVisitSession,
} from "./sessions.js";

import { transcribeCurrentSession as transcribeAudio } from "./transcription.js";

let sessionId = null;
let visitActive = false;
let recordingDuration = 0;
let copyTranscriptionTimeout = null;
let copyNoteTimeout = null;

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
    "copy-transcription-button",
);
const copyNoteButton = document.getElementById("copy-note-button");

const transcriptionStatus = document.getElementById("transcription-status");
const noteStatus = document.getElementById("note-status");

const INITIAL_TRANSCRIPTION = "Здесь появится распознанный текст";
const COPY_FEEDBACK_DURATION = 2000;

function setStatus(message) {
    status.textContent = message;
}

function updateVisitControls() {
    startVisitButton.disabled = visitActive;
    finishVisitButton.disabled = !visitActive;
}

function setActionStatus(element, message, type = "") {
    element.textContent = message;
    element.classList.toggle("is-error", type === "error");
    element.classList.toggle("is-success", type === "success");
}

async function restoreCurrentAudio(currentSessionId) {
    return restoreAudio({
        sessionId: currentSessionId,
        getAudioChunks,
        audioPlayback,
        recordingDuration,
        getElapsedTime,
    });
}

async function createVisit() {
    const session = await createVisitSession({ saveSession });

    sessionId = session.sessionId;
    visitActive = true;
    recordingDuration = 0;

    recordingController.reset();
    recordingController.setInitialRecordingDuration(0);

    resetRecordingTimer();

    transcription.textContent = INITIAL_TRANSCRIPTION;
    medicalNote.value = "";

    setActionStatus(transcriptionStatus, "");
    setActionStatus(noteStatus, "");

    revokeCurrentAudioUrl();
    audioPlayback.removeAttribute("src");
    audioPlayback.hidden = true;
    audioPlayback.load();

    recordButton.disabled = false;
    recordButton.textContent = "Начать запись";

    updateVisitControls();
    setStatus("Приём начат. Можно начинать запись");
}

const recordingController = createRecordingController({
    getSessionId: () => sessionId,
    isVisitActive: () => visitActive,
    createVisit,

    saveAudioChunk,
    getSession,
    saveSession,
    getElapsedTime,

    startRecordingTimer,
    stopRecordingTimer,

    transcribeCurrentSession: (currentSessionId) =>
        transcribeAudio({
            sessionId: currentSessionId,
            getAudioChunks,
            getSession,
            saveSession,
            transcription,
            initialTranscription: INITIAL_TRANSCRIPTION,
            transcribeButton,
            setStatus,
            restoreAudio: restoreCurrentAudio,
        }),

    setStatus,
    recordButton,

    setRecordingDuration: (duration) => {
        recordingDuration = duration;
    },
});

async function restoreLatestVisit() {
    const session = await loadLatestSession({
        getLatestSessionId,
        getSession,
        saveSession,
    });

    if (!session) {
        sessionId = null;
        visitActive = false;

        resetRecordingTimer();

        transcription.textContent = INITIAL_TRANSCRIPTION;
        updateVisitControls();
        setStatus("Запись не начата");

        return;
    }

    sessionId = session.sessionId;
    visitActive = true;
    recordingDuration = session.lastSegmentDuration || 0;

    recordingController.setInitialRecordingDuration(recordingDuration);

    setElapsedTime(session.elapsedMilliseconds || 0);

    transcription.textContent =
        session.transcription || INITIAL_TRANSCRIPTION;

    await restoreCurrentAudio(sessionId);

    recordButton.textContent = "Продолжить запись";
    restoreAudioButton.textContent = "Обновить аудиозапись";

    updateVisitControls();
    setStatus("Восстановлен незавершённый приём");
}

async function transcribeCurrentVisit() {
    if (!sessionId || !visitActive) {
        setStatus("Сначала начните приём");
        return;
    }

    await transcribeAudio({
        sessionId,
        getAudioChunks,
        getSession,
        saveSession,
        transcription,
        initialTranscription: INITIAL_TRANSCRIPTION,
        transcribeButton,
        setStatus,
        restoreAudio: restoreCurrentAudio,
    });
}

async function generateMedicalNote() {
    const transcriptText = transcription.textContent.trim();

    if (
        !transcriptText ||
        transcriptText === INITIAL_TRANSCRIPTION
    ) {
        setActionStatus(
            noteStatus,
            "Сначала распознайте аудио или добавьте текст транскрипции",
            "error",
        );
        setStatus("Нет текста для формирования заметки");
        return;
    }

    generateNoteButton.disabled = true;
    generateNoteButton.textContent = "Генерируем…";

    setActionStatus(
        noteStatus,
        "Формируем заметку. Это может занять несколько секунд.",
    );
    setStatus("Формируем медицинскую заметку…");

    try {
        const response = await fetch("/generate-note", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                transcription: transcriptText,
            }),
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(
                result.detail || "Не удалось сформировать заметку",
            );
        }

        medicalNote.value = result.note;

        setActionStatus(
            noteStatus,
            "Черновик готов. Проверьте его перед использованием.",
            "success",
        );
        setStatus("Черновик заметки готов. Проверьте его");
    } catch (error) {
        console.error("Ошибка генерации заметки:", error);

        setActionStatus(
            noteStatus,
            `Не удалось сформировать заметку: ${error.message}`,
            "error",
        );
        setStatus(`Не удалось сформировать заметку: ${error.message}`);
    } finally {
        generateNoteButton.disabled = false;
        generateNoteButton.textContent = "Сформировать заметку";
    }
}

async function copyText(text, button, originalLabel, statusElement, timeoutName) {
    if (!text.trim() || text.trim() === INITIAL_TRANSCRIPTION) {
        setActionStatus(statusElement, "Нет текста для копирования", "error");
        setStatus("Нет текста для копирования");
        return;
    }

    try {
        await navigator.clipboard.writeText(text);

        button.textContent = "Скопировано ✓";
        setActionStatus(statusElement, "Текст скопирован", "success");
        setStatus("Скопировано!");

        const timeout =
            timeoutName === "transcription"
                ? copyTranscriptionTimeout
                : copyNoteTimeout;

        if (timeout) {
            clearTimeout(timeout);
        }

        const newTimeout = setTimeout(() => {
            button.textContent = originalLabel;
            setActionStatus(statusElement, "");

            if (timeoutName === "transcription") {
                copyTranscriptionTimeout = null;
            } else {
                copyNoteTimeout = null;
            }
        }, COPY_FEEDBACK_DURATION);

        if (timeoutName === "transcription") {
            copyTranscriptionTimeout = newTimeout;
        } else {
            copyNoteTimeout = newTimeout;
        }
    } catch (error) {
        console.error("Не удалось скопировать текст:", error);

        setActionStatus(
            statusElement,
            "Не удалось скопировать текст. Проверьте разрешения браузера.",
            "error",
        );
        setStatus("Не удалось скопировать текст");
    }
}

startVisitButton.addEventListener("click", async () => {
    if (visitActive) {
        return;
    }

    try {
        await createVisit();
    } catch (error) {
        console.error("Не удалось начать приём:", error);
        setStatus("Не удалось начать приём");
    }
});

recordButton.addEventListener("click", async () => {
    recordButton.disabled = true;

    try {
        await recordingController.start();
    } catch (error) {
        console.error("Ошибка записи:", error);
        setStatus(`Не удалось начать запись: ${error.message}`);
    } finally {
        recordButton.disabled = false;
    }
});

transcribeButton.addEventListener("click", async () => {
    try {
        await transcribeCurrentVisit();
    } catch (error) {
        console.error("Ошибка распознавания:", error);
        setStatus("Не удалось распознать аудио");
    }
});

generateNoteButton.addEventListener("click", generateMedicalNote);

restoreAudioButton.addEventListener("click", async () => {
    try {
        if (!sessionId) {
            await restoreLatestVisit();
            return;
        }

        const restored = await restoreCurrentAudio(sessionId);

        setStatus(
            restored
                ? "Аудиозапись восстановлена"
                : "Аудиозапись не найдена",
        );
    } catch (error) {
        console.error("Ошибка восстановления аудио:", error);
        setStatus("Не удалось восстановить аудиозапись");
    }
});

copyTranscriptionButton.addEventListener("click", () => {
    copyText(
        transcription.textContent,
        copyTranscriptionButton,
        "Копировать текст",
        transcriptionStatus,
        "transcription",
    );
});

copyNoteButton.addEventListener("click", () => {
    copyText(
        medicalNote.value,
        copyNoteButton,
        "Копировать заметку",
        noteStatus,
        "note",
    );
});

finishVisitButton.addEventListener("click", async () => {
    if (!sessionId || !visitActive) {
        return;
    }

    const confirmed = window.confirm(
        "Завершить приём и удалить его аудио и транскрипцию из локального хранилища? Это действие нельзя отменить.",
    );

    if (!confirmed) {
        return;
    }

    const finishingSessionId = sessionId;
    finishVisitButton.disabled = true;

    try {
        await recordingController.stopAndWait();

        await deleteVisitSession({
            sessionId: finishingSessionId,
            deleteSessionData,
        });

        recordingController.reset();
        revokeCurrentAudioUrl();

        audioPlayback.removeAttribute("src");
        audioPlayback.hidden = true;
        audioPlayback.load();

        sessionId = null;
        visitActive = false;
        recordingDuration = 0;

        resetRecordingTimer();

        transcription.textContent = INITIAL_TRANSCRIPTION;
        medicalNote.value = "";

        setActionStatus(transcriptionStatus, "");
        setActionStatus(noteStatus, "");

        recordButton.disabled = false;
        recordButton.textContent = "Начать запись";
        restoreAudioButton.textContent = "Восстановить аудиозапись";

        updateVisitControls();
        setStatus("Приём завершён");
    } catch (error) {
        console.error("Не удалось завершить приём:", error);
        setStatus("Не удалось завершить приём");
        updateVisitControls();
    }
});

async function initialize() {
    try {
        await initDB();
        await restoreLatestVisit();
    } catch (error) {
        console.error("Ошибка инициализации:", error);
        setStatus("Не удалось открыть локальное хранилище");
        updateVisitControls();
    }
}

initialize();
