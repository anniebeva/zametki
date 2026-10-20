export async function createVisitSession({ saveSession }) {
    const now = Date.now();

    const session = {
        sessionId: crypto.randomUUID(),
        status: "active",
        transcription: "",
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
        const now = Date.now();

        session = {
            sessionId,
            status: "active",
            transcription: "",
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

    return session;
}

export async function deleteVisitSession({
    sessionId,
    deleteSessionData,
}) {
    if (!sessionId) {
        return;
    }

    await deleteSessionData(sessionId);
}