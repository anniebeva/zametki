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

import {
    loadTemplates,
    loadTemplateSchema,
    renderTemplateForm,
} from "./templates.js";

import { createMedicalNoteController } from "./medical-note.js";

let sessionId = null;
let visitActive = false;
let recordingDuration = 0;
let copyTranscriptionTimeout = null;
let transcriptionSaveTimeout = null;
let templateRequestId = 0;

const recordButton = document.getElementById("record-button");
const startVisitButton = document.getElementById("start-visit-button");
const finishVisitButton = document.getElementById("finish-visit-button");
const restoreAudioButton = document.getElementById("restore-audio-button");

const status = document.getElementById("status");
const transcription = document.getElementById("transcription");
const audioPlayback = document.getElementById("audio-playback");

const transcribeButton = document.getElementById("transcribe-button");
const copyTranscriptionButton = document.getElementById(
    "copy-transcription-button",
);

const transcriptionStatus = document.getElementById("transcription-status");

const templateSelect = document.getElementById("template-select");
const templateStatus = document.getElementById("template-status");

const structuredNote = document.getElementById("structured-note");

const medicalNote = document.getElementById("medical-note");
const medicalNoteSection = document.getElementById("medical-note-section");
const generateNoteButton = document.getElementById("generate-note-button");
const copyNoteButton = document.getElementById("copy-note-button");
const noteStatus = document.getElementById("note-status");

const noteTitle = document.getElementById("note-title");
const noteSubtitle = document.getElementById("note-subtitle");
const structuredNoteMode = document.getElementById("structured-note-mode");
const templateFormStatus = document.getElementById("template-form-status");
const copyTemplateButton = document.getElementById("copy-template-button");

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

async function renderSelectedTemplate() {
    const templateId = templateSelect.value;
    const requestId = ++templateRequestId;

    if (!templateId) {
        medicalNoteSection.hidden = false;
        structuredNoteMode.hidden = true;

        noteTitle.textContent = "Медицинская заметка";
        noteSubtitle.textContent =
            "Сформируйте заметку на основе транскрипции или отредактируйте её";

        setActionStatus(templateFormStatus, "");
        setActionStatus(templateStatus, "");

        return;
    }

    medicalNoteSection.hidden = true;
    structuredNoteMode.hidden = false;

    noteTitle.textContent = "Медицинская форма";
    noteSubtitle.textContent =
        "Заполните поля выбранного шаблона и проверьте данные перед формированием документа";

    try {
        setActionStatus(templateFormStatus, "Загружаем форму…");

        const schema = await loadTemplateSchema(templateId);

        if (
            requestId !== templateRequestId ||
            templateSelect.value !== templateId
        ) {
            return;
        }

        renderTemplateForm(schema, structuredNote);
        setActionStatus(templateFormStatus, "");
        setActionStatus(templateStatus, "");
    } catch (error) {
        console.error("Не удалось загрузить форму шаблона:", error);

        if (requestId !== templateRequestId) {
            return;
        }

        structuredNote.replaceChildren();

        setActionStatus(
            templateFormStatus,
            "Не удалось загрузить поля шаблона",
            "error",
        );
    }
}

function clearPendingSaveTimers() {
    if (transcriptionSaveTimeout !== null) {
        clearTimeout(transcriptionSaveTimeout);
        transcriptionSaveTimeout = null;
    }
}

async function saveEditedTranscription() {
    const currentSessionId = sessionId;
    const text = transcription.textContent.trim();

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
            transcription: text === INITIAL_TRANSCRIPTION ? "" : text,
            transcriptionStatus: "done",
            transcriptionError: "",
            transcriptionVersion: (session.transcriptionVersion || 0) + 1,
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
    const session = await createVisitSession({
        saveSession,
        templateId: templateSelect.value || null,
    });

    sessionId = session.sessionId;
    visitActive = true;
    recordingDuration = 0;

    clearPendingSaveTimers();

    recordingController.reset();
    recordingController.setInitialRecordingDuration(0);

    resetRecordingTimer();
    resetTranscription();
    resetMedicalNote();
    resetAudioPlayback();

    recordButton.disabled = false;
    recordButton.textContent = "Начать запись";

    restoreAudioButton.textContent = "Восстановить аудиозапись";

    updateVisitControls();
    setStatus("Приём начат. Можно начинать запись");
}

async function flushPendingTranscriptionSave() {
    if (transcriptionSaveTimeout !== null) {
        clearTimeout(transcriptionSaveTimeout);
        transcriptionSaveTimeout = null;
        await saveEditedTranscription();
    }
}

async function saveCurrentSessionChanges(changes, targetSessionId = sessionId) {
    if (!targetSessionId) {
        return;
    }

    const session = await getSession(targetSessionId);

    if (!session || session.status !== "active") {
        return;
    }

    await saveSession({
        ...session,
        ...changes,
        updatedAt: Date.now(),
    });
}

function getTranscriptionText() {
    const text = transcription.textContent.trim();

    return text === INITIAL_TRANSCRIPTION ? "" : text;
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


function resetMedicalNote() {
    medicalNoteController.invalidateGeneration();
    medicalNoteController.clearPendingSaveTimer();

    medicalNote.value = "";
    setActionStatus(noteStatus, "");
}

function restoreMedicalNote(session) {
    medicalNote.value = session.medicalNote || "";

    if (session.noteStatus === "error") {
        setActionStatus(
            noteStatus,
            session.noteError || "Ошибка формирования заметки",
            "error",
        );
    } else if (session.noteStatus === "stale") {
        setActionStatus(
            noteStatus,
            "Транскрипция изменилась. Заметку нужно проверить.",
        );
    } else if (
        session.noteStatus === "done" ||
        session.noteStatus === "edited"
    ) {
        setActionStatus(noteStatus, "Заметка восстановлена");
    } else {
        setActionStatus(noteStatus, "");
    }
}

function resetAudioPlayback() {
    revokeCurrentAudioUrl();

    audioPlayback.removeAttribute("src");
    audioPlayback.hidden = true;
    audioPlayback.load();
}

function resetTranscription() {
    transcription.textContent = INITIAL_TRANSCRIPTION;
    setActionStatus(transcriptionStatus, "");
}

function restoreTranscriptionStatus(session) {
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
    } else {
        setActionStatus(transcriptionStatus, "");
    }
}

async function restoreLatestVisit() {
    const session = await loadLatestSession({
        getLatestSessionId,
        getSession,
        saveSession,
    });

    if (!session) {
        sessionId = null;
        visitActive = false;
        recordingDuration = 0;

        templateSelect.value = "";
        await renderSelectedTemplate();

        resetMedicalNote();
        resetTranscription();
        resetAudioPlayback();
        resetRecordingTimer();

        recordingController.reset();
        recordingController.setInitialRecordingDuration(0);

        recordButton.disabled = false;
        recordButton.textContent = "Начать запись";
        restoreAudioButton.textContent = "Восстановить аудиозапись";

        updateVisitControls();
        setStatus("Запись не начата");

        return;
    }

    sessionId = session.sessionId;
    visitActive = true;
    recordingDuration = session.lastSegmentDuration || 0;

    templateSelect.value = session.templateId || "";
    await renderSelectedTemplate();

    recordingController.setInitialRecordingDuration(recordingDuration);
    setElapsedTime(session.elapsedMilliseconds || 0);

    transcription.textContent =
        session.transcription || INITIAL_TRANSCRIPTION;

    restoreMedicalNote(session);

    restoreTranscriptionStatus(session);

    await restoreCurrentAudio(sessionId);

    recordButton.disabled = false;
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

templateSelect.addEventListener("change", () => {
    void renderSelectedTemplate();
});

recordButton.addEventListener("click", async () => {
    try {
        await recordingController.start();
    } catch (error) {
        console.error("Ошибка записи:", error);
        setStatus(`Не удалось начать запись: ${error.message}`);
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

medicalNote.addEventListener("input", () => {
    medicalNoteController.scheduleSave();
});

generateNoteButton.addEventListener("click", async () => {
    await medicalNoteController.generateMedicalNote();
});

copyNoteButton.addEventListener("click", async () => {
    await medicalNoteController.copyNote();
});

copyTemplateButton.addEventListener("click", () => {
    const sections = structuredNote.querySelectorAll(".form-section");
    const lines = [];

    for (const section of sections) {
        const heading = section.querySelector("h3")?.textContent.trim();
        const fields = section.querySelectorAll(".form-field");
        const sectionLines = [];

        for (const field of fields) {
            const label = field.querySelector("label")?.textContent.trim();
            const input = field.querySelector(".field-control");
            const unit = field.querySelector(".field-unit")?.textContent.trim();

            if (!label || !input || !input.value.trim()) {
                continue;
            }

            const value = input.value.trim();
            const formattedValue = unit
                ? `${value} ${unit}`
                : value;

            sectionLines.push(`${label}: ${formattedValue}`);
        }

        if (sectionLines.length) {
            if (lines.length) {
                lines.push("");
            }

            if (heading) {
                lines.push(heading);
            }

            lines.push(...sectionLines);
        }
    }

    if (!lines.length) {
        setActionStatus(
            templateFormStatus,
            "Нет заполненных полей для копирования",
        );
        return;
    }

    copyText(
        lines.join("\n"),
        copyTemplateButton,
        "Копировать заполненные поля",
        templateFormStatus,
    );
});

function resetVisitInterface() {
    recordingController.reset();

    sessionId = null;
    visitActive = false;
    recordingDuration = 0;

    resetRecordingTimer();
    resetTranscription();
    resetMedicalNote();
    resetAudioPlayback();

    recordButton.disabled = false;
    recordButton.textContent = "Начать запись";

    restoreAudioButton.textContent = "Восстановить аудиозапись";

    updateVisitControls();
}

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

    visitActive = false;
    finishVisitButton.disabled = true;

    clearPendingSaveTimers();
    medicalNoteController.invalidateGeneration();
    medicalNoteController.clearPendingSaveTimer();

    try {
        await recordingController.stopAndWait();

        await deleteVisitSession({
            sessionId: finishingSessionId,
            deleteSessionData,
        });

        resetVisitInterface();

        setStatus("Приём завершён");
    } catch (error) {
        console.error("Не удалось завершить приём:", error);

        const session = await getSession(finishingSessionId).catch(
            () => null,
        );

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

        await loadTemplates({
            templateSelect,
            templateStatus,
            setActionStatus,
        });

        await restoreLatestVisit();
    } catch (error) {
        console.error("Ошибка инициализации:", error);
        setStatus("Не удалось открыть локальное хранилище");
        updateVisitControls();
    }
}

initialize();