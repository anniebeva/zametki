
export function createMedicalNoteController({
    getSessionId,
    isVisitActive,
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
}) {
    let generationVersion = 0;
    let saveTimeout = null;
    let copyTimeout = null;

    async function saveEditedNote() {
        const currentSessionId = getSessionId();
        const text = medicalNote.value;

        try {
            const session = await getSession(currentSessionId);

            if (
                !session ||
                session.status !== "active" ||
                !isVisitActive() ||
                getSessionId() !== currentSessionId
            ) {
                return;
            }

            await saveSession({
                ...session,
                medicalNote: text,
                noteSourceTranscriptionVersion:
                    session.transcriptionVersion || 0,
                noteStatus: "edited",
                noteError: "",
                updatedAt: Date.now(),
            });

            setActionStatus(
                noteStatus,
                "Изменения заметки сохранены",
                "success",
            );
        } catch (error) {
            console.error("Не удалось сохранить заметку:", error);
            setActionStatus(
                noteStatus,
                "Не удалось сохранить заметку",
                "error",
            );
        }
    }

    function scheduleSave() {
        if (!getSessionId() || !isVisitActive()) {
            return;
        }

        if (saveTimeout !== null) {
            clearTimeout(saveTimeout);
        }

        setActionStatus(noteStatus, "Сохраняем изменения…");

        saveTimeout = setTimeout(() => {
            saveTimeout = null;
            void saveEditedNote();
        }, 300);
    }

    function clearPendingSaveTimer() {
        if (saveTimeout !== null) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
        }
    }

    async function generateMedicalNote() {
        if (!getSessionId() || !isVisitActive()) {
            setStatus("Сначала начните приём");
            return;
        }

        const currentSessionId = getSessionId();
        const currentGenerationVersion = ++generationVersion;

        await flushPendingTranscriptionSave();

        if (
            !isVisitActive() ||
            getSessionId() !== currentSessionId ||
            currentGenerationVersion !== generationVersion
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

            if (
                !isVisitActive() ||
                getSessionId() !== currentSessionId ||
                currentGenerationVersion !== generationVersion
            ) {
                return;
            }

            const session = await getSession(currentSessionId);

            if (
                !session ||
                session.status !== "active" ||
                !isVisitActive() ||
                getSessionId() !== currentSessionId ||
                currentGenerationVersion !== generationVersion
            ) {
                return;
            }

            const noteText = result.note || "";

            await saveSession({
                ...session,
                medicalNote: noteText,
                noteSourceTranscriptionVersion:
                    session.transcriptionVersion || 0,
                noteStatus: "done",
                noteError: "",
                updatedAt: Date.now(),
            });

            if (
                !isVisitActive() ||
                getSessionId() !== currentSessionId ||
                currentGenerationVersion !== generationVersion
            ) {
                return;
            }

            clearPendingSaveTimer();
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
                isVisitActive() &&
                getSessionId() === currentSessionId &&
                currentGenerationVersion === generationVersion
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
                setStatus(
                    `Не удалось сформировать заметку: ${error.message}`,
                );
            }
        } finally {
            if (currentGenerationVersion === generationVersion) {
                generateNoteButton.disabled = false;
                generateNoteButton.textContent = "Сформировать заметку";
            }
        }
    }

    async function copyNote() {
        const text = medicalNote.value;

        if (!text.trim()) {
            setActionStatus(
                noteStatus,
                "Нет текста для копирования",
                "error",
            );
            setStatus("Нет текста для копирования");
            return;
        }

        try {
            await navigator.clipboard.writeText(text);

            copyNoteButton.textContent = "Скопировано ✓";
            setActionStatus(noteStatus, "Текст скопирован", "success");
            setStatus("Скопировано!");

            if (copyTimeout !== null) {
                clearTimeout(copyTimeout);
            }

            copyTimeout = setTimeout(() => {
                copyNoteButton.textContent = "Копировать заметку";
                setActionStatus(noteStatus, "");
                copyTimeout = null;
            }, 2000);
        } catch (error) {
            console.error("Не удалось скопировать заметку:", error);

            setActionStatus(
                noteStatus,
                "Не удалось скопировать текст. Проверьте разрешения браузера.",
                "error",
            );
            setStatus("Не удалось скопировать текст");
        }
    }

    function invalidateGeneration() {
        generationVersion += 1;
    }

    return {
        scheduleSave,
        clearPendingSaveTimer,
        generateMedicalNote,
        copyNote,
        invalidateGeneration,
    };
}
