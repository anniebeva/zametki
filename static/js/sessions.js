export async function createVisitSession({ saveSession, templateId }) {
    const now = Date.now();

    const session = {
        sessionId: crypto.randomUUID(),
        status: "active",
        templateId: templateId || null,

        audioVersion: 0,

        transcription: "",
        transcriptionAudioVersion: null,
        transcriptionStatus: "idle",
        transcriptionError: "",
        transcriptionVersion: 0,

        medicalNote: "",
        noteSourceTranscriptionVersion: null,
        noteStatus: "idle",
        noteError: "",

        elapsedMilliseconds: 0,
        lastSegmentDuration: 0,

        createdAt: now,
        updatedAt: now,
    };

    await saveSession(session);

    return session;
}


export async function restoreLatestSession({
    getLatestSessionId,
    getSession,
    saveSession,
}) {
    const sessionId = await getLatestSessionId();

    if (!sessionId) {
        return null;
    }

    let session = await getSession(sessionId);

    if (!session) {
        session = {
            sessionId,
            status: "active",
            templateId: null,

            audioVersion: 0,

            transcription: "",
            transcriptionAudioVersion: null,
            transcriptionStatus: "idle",
            transcriptionError: "",
            transcriptionVersion: 0,

            medicalNote: "",
            noteSourceTranscriptionVersion: null,
            noteStatus: "idle",
            noteError: "",

            elapsedMilliseconds: 0,
            lastSegmentDuration: 0,

            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        await saveSession(session);
    }

    if (session.status !== "active") {
        return null;
    }

    const updatedSession = {
        templateId: null,

        audioVersion: 0,

        transcription: "",
        transcriptionAudioVersion: null,
        transcriptionStatus: "idle",
        transcriptionError: "",
        transcriptionVersion: 0,

        medicalNote: "",
        noteSourceTranscriptionVersion: null,
        noteStatus: "idle",
        noteError: "",

        elapsedMilliseconds: 0,
        lastSegmentDuration: 0,

        ...session,
    };

    if (
        Object.keys(updatedSession).some(
            (key) => updatedSession[key] !== session[key],
        )
    ) {
        await saveSession(updatedSession);
    }

    return updatedSession;
}


export async function deleteVisitSession({
    sessionId,
    deleteSessionData,
}) {
    await deleteSessionData(sessionId);
}