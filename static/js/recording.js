export function createRecordingController({
    getSessionId,
    isVisitActive,
    createVisit,
    saveAudioChunk,
    getSession,
    saveSession,
    getElapsedTime,
    startRecordingTimer,
    stopRecordingTimer,
    transcribeCurrentSession,
    setStatus,
    recordButton,
    setRecordingDuration,
}) {
    let mediaRecorder = null;
    let audioStream = null;
    let pendingSaves = [];
    let stopProcessingPromise = Promise.resolve();
    let recordingStartedAt = null;
    let recordingDuration = 0;
    let recordingStarted = false;

    function getState() {
        return mediaRecorder?.state ?? "inactive";
    }

    function stopStream() {
        if (audioStream) {
            audioStream.getTracks().forEach((track) => track.stop());
            audioStream = null;
        }
    }

    async function getMicrophone() {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("Браузер не поддерживает запись с микрофона");
        }

        return navigator.mediaDevices.getUserMedia({ audio: true });
    }

    async function processStoppedRecording(currentSessionId) {
        stopStream();

        try {
            await Promise.all(pendingSaves);

            const session = await getSession(currentSessionId);

            if (session && session.status === "active") {
                await saveSession({
                    ...session,
                    elapsedMilliseconds: getElapsedTime(),
                    lastSegmentDuration: recordingDuration,
                    updatedAt: Date.now(),
                });
            }

            setStatus("Подготавливаем аудио для распознавания…");

            await transcribeCurrentSession(currentSessionId);
        } catch (error) {
            console.error("Ошибка обработки записи:", error);
            setStatus(`Не удалось обработать запись: ${error.message}`);
        } finally {
            recordingStarted = false;
            recordButton.disabled = false;
            recordButton.textContent = "Продолжить запись";
        }
    }

    async function start() {
        if (getState() === "recording") {
            await stopAndWait();
            return;
        }

        if (getState() === "paused") {
            resume();
            return;
        }

        if (!isVisitActive()) {
            await createVisit();
        }

        const currentSessionId = getSessionId();

        if (!currentSessionId) {
            throw new Error("Не удалось создать приём");
        }

        try {
            audioStream = await getMicrophone();
            pendingSaves = [];

            mediaRecorder = new MediaRecorder(audioStream);

            mediaRecorder.addEventListener("dataavailable", (event) => {
                if (!event.data || event.data.size === 0) {
                    return;
                }

                const savePromise = saveAudioChunk(
                    currentSessionId,
                    event.data,
                );

                pendingSaves.push(savePromise);

                savePromise.catch((error) => {
                    console.error("Не удалось сохранить аудиофрагмент:", error);
                    setStatus("Не удалось сохранить часть аудиозаписи");
                });
            });

            mediaRecorder.addEventListener("stop", () => {
                if (recordingStartedAt !== null) {
                    recordingDuration = Date.now() - recordingStartedAt;
                    setRecordingDuration(recordingDuration);
                    recordingStartedAt = null;
                }

                stopRecordingTimer();

                stopProcessingPromise =
                    processStoppedRecording(currentSessionId);
            });

            mediaRecorder.start(5000);

            recordingStartedAt = Date.now();
            recordingStarted = true;

            startRecordingTimer();

            recordButton.textContent = "Остановить запись";
            setStatus("Идёт запись");
        } catch (error) {
            stopStream();
            recordingStartedAt = null;
            recordingStarted = false;
            stopRecordingTimer();
            throw error;
        }
    }

    function resume() {
        if (getState() !== "paused") {
            return;
        }

        mediaRecorder.resume();
        recordingStartedAt = Date.now();
        startRecordingTimer();

        recordButton.textContent = "Остановить запись";
        setStatus("Запись продолжается");
    }

    async function stopAndWait() {
        if (
            mediaRecorder &&
            (mediaRecorder.state === "recording" ||
                mediaRecorder.state === "paused")
        ) {
            const stopped = new Promise((resolve) => {
                mediaRecorder.addEventListener("stop", resolve, { once: true });
            });

            mediaRecorder.stop();
            await stopped;
        }

        await stopProcessingPromise;
    }

    function reset() {
        stopStream();

        mediaRecorder = null;
        pendingSaves = [];
        recordingStartedAt = null;
        recordingDuration = 0;
        recordingStarted = false;
        stopProcessingPromise = Promise.resolve();

        stopRecordingTimer();
    }

    function getRecordingDuration() {
        return recordingDuration;
    }

    function setInitialRecordingDuration(duration) {
        recordingDuration = duration || 0;
    }

    function hasRecordingStarted() {
        return recordingStarted;
    }

    return {
        start,
        resume,
        stopAndWait,
        getState,
        reset,
        getRecordingDuration,
        setInitialRecordingDuration,
        hasRecordingStarted,
    };
}