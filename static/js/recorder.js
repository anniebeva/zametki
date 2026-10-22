
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
let transcriptionSaveTimeout = null;
let noteSaveTimeout = null;
let noteGenerationVersion = 0;

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

    if (noteSaveTimeout !== null) {
        clearTimeout(noteSaveTimeout);
        noteSaveTimeout = null;
    }
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

async function saveEditedNote() {
    const currentSessionId = sessionId;
    const text = medicalNote.value;

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
            medicalNote: text,
            noteSourceTranscriptionVersion: session.transcriptionVersion || 0,
            noteStatus: "edited",
            noteError: "",
            updatedAt: Date.now(),
        });

        setActionStatus(noteStatus, "Изменения заметки сохранены", "success");
    } catch (error) {
        console.error("Не удалось сохранить заметку:", error);
        setActionStatus(
            noteStatus,
            "Не удалось сохранить заметку",
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

function scheduleNoteSave() {
    if (!sessionId || !visitActive) {
        return;
    }

    if (noteSaveTimeout !== null) {
        clearTimeout(noteSaveTimeout);
    }

    setActionStatus(noteStatus, "Сохраняем изменения…");

    noteSaveTimeout = setTimeout(() => {
        noteSaveTimeout = null;
        void saveEditedNote();
    }, EDIT_SAVE_DELAY);
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
    noteGenerationVersion += 1;

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

async function generateMedicalNote() {
    if (!sessionId || !visitActive) {
        setStatus("Сначала начните приём");
        return;
    }

    const currentSessionId = sessionId;
    const currentGenerationVersion = ++noteGenerationVersion;

    // Save pending manual transcript edits before sending the text
    if (transcriptionSaveTimeout !== null) {
        clearTimeout(transcriptionSaveTimeout);
        transcriptionSaveTimeout = null;
        await saveEditedTranscription();
    }

    if (
        !visitActive ||
        sessionId !== currentSessionId ||
        currentGenerationVersion !== noteGenerationVersion
    ) {
        return;
    }

    const transcriptText = getTranscriptionText();

    if (!transcriptText) {
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

        // Ignore late responses after the visit was finished or changed
        if (
            !visitActive ||
            sessionId !== currentSessionId ||
            currentGenerationVersion !== noteGenerationVersion
        ) {
            return;
        }

        const session = await getSession(currentSessionId);

        if (
            !session ||
            session.status !== "active" ||
            !visitActive ||
            sessionId !== currentSessionId ||
            currentGenerationVersion !== noteGenerationVersion
        ) {
            return;
        }

        const noteText = result.note || "";

        await saveSession({
            ...session,
            medicalNote: noteText,
            noteSourceTranscriptionVersion: session.transcriptionVersion || 0,
            noteStatus: "done",
            noteError: "",
            updatedAt: Date.now(),
        });

        if (
            !visitActive ||
            sessionId !== currentSessionId ||
            currentGenerationVersion !== noteGenerationVersion
        ) {
            return;
        }

        medicalNote.value = noteText;

        setActionStatus(
            noteStatus,
            "Черновик готов и сохранён. Проверьте его перед использованием.",
            "success",
        );
        setStatus("Черновик заметки готов и сохранён. Проверьте его");
    } catch (error) {
        console.error("Ошибка генерации заметки:", error);

        if (
            visitActive &&
            sessionId === currentSessionId &&
            currentGenerationVersion === noteGenerationVersion
        ) {
            try {
                await saveCurrentSessionChanges({
                    noteStatus: "error",
                    noteError: error.message,
                }, currentSessionId);
            } catch (saveError) {
                console.error(
                    "Не удалось сохранить статус ошибки:",
                    saveError,
                );
            }

            setActionStatus(
                noteStatus,
                `Не удалось сформировать заметку: ${error.message}`,
                "error",
            );
            setStatus(`Не удалось сформировать заметку: ${error.message}`);
        }
    } finally {
        if (currentGenerationVersion === noteGenerationVersion) {
            generateNoteButton.disabled = false;
            generateNoteButton.textContent = "Сформировать заметку";
        }
    }
}

async function copyText(
    text,
    button,
    originalLabel,
    statusElement,
    timeoutName,
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

transcription.addEventListener("input", scheduleTranscriptionSave);
medicalNote.addEventListener("input", scheduleNoteSave);

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

    // Invalidate in-flight note generation immediately
    noteGenerationVersion += 1;
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
