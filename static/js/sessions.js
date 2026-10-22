export async function createVisitSession({ saveSession }) {
    const now = Date.now();

    const session = {
        sessionId: crypto.randomUUID(),
        status: "active",

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

/** Restore the latest unfinished visit and initialize missing state fields */
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
        const now = Date.now();

        session = {
            sessionId,
            status: "active",
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
    }

    if (session.status !== "active") {
        return null;
    }

    // Add missing fields to sessions created by an older version
    const updatedSession = {
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

/** Delete a visit and its associated locally stored data */
export async function deleteVisitSession({
    sessionId,
    deleteSessionData,
}) {
    if (!sessionId) {
        return;
    }

    await deleteSessionData(sessionId);
}
