let elapsedMilliseconds = 0;
let segmentStartedAt = null;
let intervalId = null;

const timerElement = document.getElementById("recording-timer");

export function formatRecordingTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getCurrentElapsedTime() {
    if (segmentStartedAt === null) {
        return elapsedMilliseconds;
    }

    return elapsedMilliseconds + (Date.now() - segmentStartedAt);
}

function renderTimer() {
    if (timerElement) {
        timerElement.textContent = formatRecordingTime(
            getCurrentElapsedTime()
        );
    }
}

export function startRecordingTimer() {
    if (segmentStartedAt !== null) {
        return;
    }

    segmentStartedAt = Date.now();
    renderTimer();

    intervalId = setInterval(renderTimer, 250);
}

export function stopRecordingTimer() {
    if (segmentStartedAt !== null) {
        elapsedMilliseconds += Date.now() - segmentStartedAt;
        segmentStartedAt = null;
    }

    if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
    }

    renderTimer();

    return elapsedMilliseconds;
}

export function setElapsedTime(milliseconds = 0) {
    elapsedMilliseconds = Math.max(0, Number(milliseconds) || 0);
    segmentStartedAt = null;

    if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
    }

    renderTimer();
}

export function getElapsedTime() {
    return getCurrentElapsedTime();
}

export function resetRecordingTimer() {
    setElapsedTime(0);
}
