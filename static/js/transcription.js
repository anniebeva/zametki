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
    const chunks = await getAudioChunks(currentSessionId);

    if (!chunks.length) {
        setStatus("Нет аудио для распознавания");
        return;
    }

    const audioBlob = new Blob(
        chunks.map((chunk) => chunk.audio),
        { type: "audio/webm" },
    );

    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");

    transcribeButton.disabled = true;
    setStatus("Распознаём аудио…");

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
            updatedAt: Date.now(),
        });

        transcription.textContent = text || initialTranscription;

        setStatus("Распознавание завершено");

        await restoreAudio(currentSessionId);
    } finally {
        transcribeButton.disabled = false;
    }
}