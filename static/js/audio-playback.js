let currentAudioUrl = null;

export function revokeCurrentAudioUrl() {
    if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
        currentAudioUrl = null;
    }
}

export async function restoreAudio({
    sessionId,
    getAudioChunks,
    audioPlayback,
    recordingDuration,
    getElapsedTime,
}) {
    const chunks = await getAudioChunks(sessionId);

    revokeCurrentAudioUrl();

    if (!chunks.length) {
        audioPlayback.removeAttribute("src");
        audioPlayback.hidden = true;
        audioPlayback.load();
        return false;
    }

    const audioBlob = new Blob(
        chunks.map((chunk) => chunk.audio),
        { type: "audio/webm" },
    );

    const duration = Math.max(
        recordingDuration || 0,
        getElapsedTime(),
    );

    const fixedBlob =
        typeof window.ysFixWebmDuration === "function"
            ? await window.ysFixWebmDuration(audioBlob, duration)
            : audioBlob;

    currentAudioUrl = URL.createObjectURL(fixedBlob);

    audioPlayback.src = currentAudioUrl;
    audioPlayback.hidden = false;
    audioPlayback.load();

    return true;
}