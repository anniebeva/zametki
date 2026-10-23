export async function transcribeCurrentSession({
    sessionId,
    getAudioChunks,
    getSession,
    saveSession,
    transcription,
    initialTranscription,
    transcribeButton,
    setStatus,
    restoreAudio,
}) {
    if (!sessionId) {
        setStatus("Сначала начните приём");
        return;
    }

    const currentSessionId = sessionId;
    let requestAudioVersion = null;

    transcribeButton.disabled = true;

    try {
        const session = await getSession(currentSessionId);

        if (!session || session.status !== "active") {
            setStatus("Приём завершён или не найден");
            return;
        }

        const chunks = await getAudioChunks(currentSessionId);

        if (!chunks.length) {
            setStatus("Нет аудио для распознавания");
            return;
        }

        // If the transcript already matches the current audio, reuse it
        if (
            session.transcriptionAudioVersion === session.audioVersion &&
            session.transcriptionStatus === "done"
        ) {
            transcription.textContent =
                session.transcription || initialTranscription;
            setStatus("Транскрипция уже актуальна");
            return;
        }

        requestAudioVersion = session.audioVersion || 0;

        const audioBlob = new Blob(
            chunks.map((chunk) => chunk.audio),
            { type: "audio/webm" },
        );

        const formData = new FormData();
        formData.append("audio", audioBlob, "recording.webm");

        await updateSessionStatus({
            getSession,
            saveSession,
            sessionId: currentSessionId,
            status: "processing",
            error: "",
        });

        setStatus("Распознаём аудио…");

        const response = await fetch("/upload-audio", {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`Ошибка сервера: ${response.status}`);
        }

        const data = await response.json();
        const text = data.text || "";

        const latestSession = await getSession(currentSessionId);

        // Do not save a result for a deleted or changed session
        if (!latestSession || latestSession.status !== "active") {
            setStatus("Приём уже завершён или не найден");
            return;
        }

        if ((latestSession.audioVersion || 0) !== requestAudioVersion) {
            setStatus(
                "Во время распознавания аудио изменилось. Запустите распознавание ещё раз.",
            );
            return;
        }

        await saveSession({
            ...latestSession,
            transcription: text,
            transcriptionAudioVersion: requestAudioVersion,
            transcriptionStatus: "done",
            transcriptionError: "",
            transcriptionVersion:
                (latestSession.transcriptionVersion || 0) + 1,
            noteStatus: latestSession.medicalNote ? "stale" : "idle",
            noteError: "",
            updatedAt: Date.now(),
        });

        // Verify the session still exists and is unchanged before updating the UI
        const verifiedSession = await getSession(currentSessionId);

        if (
            !verifiedSession ||
            verifiedSession.status !== "active" ||
            (verifiedSession.audioVersion || 0) !== requestAudioVersion
        ) {
            setStatus("Сессия изменилась. Проверьте актуальность транскрипции.");
            return;
        }

        transcription.textContent = text || initialTranscription;

        setStatus("Распознавание завершено");

        await restoreAudio(currentSessionId);
    } catch (error) {
        console.error("Ошибка распознавания:", error);

        // Preserve audio and mark the failed attempt for manual retry
        const session = await getSession(currentSessionId).catch(() => null);

        if (
            session &&
            session.status === "active" &&
            (requestAudioVersion === null ||
                (session.audioVersion || 0) === requestAudioVersion)
        ) {
            await saveSession({
                ...session,
                transcriptionStatus: "error",
                transcriptionError: error.message,
                updatedAt: Date.now(),
            }).catch((saveError) => {
                console.error("Не удалось сохранить статус ошибки:", saveError);
            });
        }

        setStatus(`Не удалось распознать аудио: ${error.message}`);
    } finally {
        transcribeButton.disabled = false;
    }
}

async function updateSessionStatus({
    getSession,
    saveSession,
    sessionId,
    status,
    error,
}) {
    const session = await getSession(sessionId);

    if (!session || session.status !== "active") {
        return;
    }

    await saveSession({
        ...session,
        transcriptionStatus: status,
        transcriptionError: error,
        updatedAt: Date.now(),
    });
}
