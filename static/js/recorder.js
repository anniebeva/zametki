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

import { createMedicalNoteController } from "./medical-note.js";

let sessionId = null;
let visitActive = false;
let recordingDuration = 0;
let copyTranscriptionTimeout = null;
let transcriptionSaveTimeout = null;

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
const EDIT_SAVE_DELAY = 300;

function setStatus(message) {
    status.textContent = message;
}

function updateVisitControls() {
    startVisitButton.disabled = visitActive;
    finishVisitButton.disabled = !visitActive;
}

function setActionStatus(element, message, type = "") {
    if (!element) {
        return;
    }

    element.textContent = message;
    element.classList.toggle("is-error", type === "error");
    element.classList.toggle("is-success", type === "success");
}

async function saveCurrentSessionChanges(changes, targetSessionId = sessionId) {
    if (
        !targetSessionId ||
        !visitActive ||
        sessionId !== targetSessionId
    ) {
        return false;
    }

    const session = await getSession(targetSessionId);

    if (
        !session ||
        session.status !== "active" ||
        !visitActive ||
        sessionId !== targetSessionId
    ) {
        return false;
    }

    await saveSession({
        ...session,
        ...changes,
        updatedAt: Date.now(),
    });

    return true;
}

function getTranscriptionText() {
    const text = transcription.textContent.trim();

    return text === INITIAL_TRANSCRIPTION ? "" : text;
}

function clearPendingSaveTimers() {
    if (transcriptionSaveTimeout !== null) {
        clearTimeout(transcriptionSaveTimeout);
        transcriptionSaveTimeout = null;
    }

    medicalNoteController.clearPendingSaveTimer();
}

async function saveEditedTranscription() {
    const currentSessionId = sessionId;
    const text = getTranscriptionText();

    try {
        const session = await getSession(currentSessionId);

        if (
            !session ||
            session.status !== "active" ||
            !visitActive ||
            sessionId !== currentSessionId
        ) {
            return;
        }

        await saveSession({
            ...session,
            transcription: text,
            transcriptionStatus: "done",
            transcriptionError: "",
            transcriptionVersion: (session.transcriptionVersion || 0) + 1,
            noteStatus: session.medicalNote ? "stale" : "idle",
            noteError: "",
            updatedAt: Date.now(),
        });

        setActionStatus(
            transcriptionStatus,
            "Исправленный текст сохранён",
            "success",
        );
    } catch (error) {
        console.error("Не удалось сохранить транскрипцию:", error);
        setActionStatus(
            transcriptionStatus,
            "Не удалось сохранить исправленный текст",
            "error",
        );
    }
}

function scheduleTranscriptionSave() {
    if (!sessionId || !visitActive) {
        return;
    }

    if (transcriptionSaveTimeout !== null) {
        clearTimeout(transcriptionSaveTimeout);
    }

    setActionStatus(transcriptionStatus, "Сохраняем исправления…");

    transcriptionSaveTimeout = setTimeout(() => {
        transcriptionSaveTimeout = null;
        void saveEditedTranscription();
    }, EDIT_SAVE_DELAY);
}

async function flushPendingTranscriptionSave() {
    if (transcriptionSaveTimeout !== null) {
        clearTimeout(transcriptionSaveTimeout);
        transcriptionSaveTimeout = null;
        await saveEditedTranscription();
    }
}

const medicalNoteController = createMedicalNoteController({
    getSessionId: () => sessionId,
    isVisitActive: () => visitActive,
    getTranscriptionText,
    flushPendingTranscriptionSave,
    getSession,
    saveSession,
    saveCurrentSessionChanges,
    setStatus,
    setActionStatus,
    noteStatus,
    medicalNote,
    generateNoteButton,
    copyNoteButton,
});

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

    medicalNoteController.invalidateGeneration();
    clearPendingSaveTimers();

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
        medicalNote.value = "";

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

    medicalNote.value = session.medicalNote || "";

    if (session.transcriptionStatus === "error") {
        setActionStatus(
            transcriptionStatus,
            session.transcriptionError || "Ошибка распознавания",
            "error",
        );
    } else if (session.transcriptionStatus === "stale") {
        setActionStatus(
            transcriptionStatus,
            "Аудио изменилось. Требуется распознавание.",
        );
    }

    if (session.noteStatus === "error") {
        setActionStatus(
            noteStatus,
            session.noteError || "Ошибка генерации заметки",
            "error",
        );
    } else if (session.noteStatus === "stale") {
        setActionStatus(
            noteStatus,
            "Транскрипция изменилась. Проверьте заметку.",
        );
    }

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

async function copyText(
    text,
    button,
    originalLabel,
    statusElement,
) {
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

        if (copyTranscriptionTimeout !== null) {
            clearTimeout(copyTranscriptionTimeout);
        }

        copyTranscriptionTimeout = setTimeout(() => {
            button.textContent = originalLabel;
            setActionStatus(statusElement, "");
            copyTranscriptionTimeout = null;
        }, COPY_FEEDBACK_DURATION);
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

transcription.addEventListener("input", scheduleTranscriptionSave);

medicalNote.addEventListener(
    "input",
    medicalNoteController.scheduleSave,
);

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

generateNoteButton.addEventListener(
    "click",
    medicalNoteController.generateMedicalNote,
);

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
    );
});

copyNoteButton.addEventListener(
    "click",
    medicalNoteController.copyNote,
);

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

    // Invalidate in-flight note generation immediately
    medicalNoteController.invalidateGeneration();
    visitActive = false;
    finishVisitButton.disabled = true;
    clearPendingSaveTimers();

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

        // The session may still exist if deletion failed
        const session = await getSession(finishingSessionId).catch(() => null);

        if (session && session.status === "active") {
            sessionId = finishingSessionId;
            visitActive = true;
        }

        updateVisitControls();
        setStatus("Не удалось завершить приём");
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
