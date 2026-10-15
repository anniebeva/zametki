
const recordButton = document.getElementById("record-button");
const status = document.getElementById("status");

let mediaRecorder;
let audioChunks = [];
let audioStream;

recordButton.addEventListener("click", async () => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
        try {
            audioStream = await navigator.mediaDevices.getUserMedia({
                audio: true
            });

            audioChunks = [];
            mediaRecorder = new MediaRecorder(audioStream);

            mediaRecorder.addEventListener("dataavailable", (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            });


            mediaRecorder.addEventListener("stop", () => {
                const audioBlob = new Blob(audioChunks, {
                    type: mediaRecorder.mimeType
                });

                // Отправляем аудио на сервер
                const formData = new FormData();
                formData.append("audio", audioBlob, "recording.webm");

                fetch("/upload-audio", {
                    method: "POST",
                    body: formData
                })
                    .then((response) => response.json())
                    .then((data) => {
                        console.log("Ответ сервера:", data);
                    })
                    .catch((error) => {
                        console.error("Ошибка отправки:", error);
                    });

                // Создаём аудиоплеер
                const audioPlayback = document.getElementById("audio-playback");
                audioPlayback.src = URL.createObjectURL(audioBlob);
                audioPlayback.hidden = false;

                status.textContent =
                    `Запись завершена. Размер аудио: ${audioBlob.size} байт`;

                audioStream.getTracks().forEach((track) => track.stop());
                audioStream = null;
            });

            mediaRecorder.start();

            status.textContent = "Идёт запись...";
            recordButton.textContent = "Остановить запись";
        } catch (error) {
            status.textContent = "Не удалось получить доступ к микрофону";
            console.error(error);
        }
    } else if (mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        recordButton.textContent = "Начать запись";
    }
});
