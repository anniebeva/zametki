from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


def test_upload_audio(monkeypatch):
    """Check that the API receives audio and returns transcription"""

    def fake_transcribe_audio(audio_path):
        """Return test text instead of running Whisper"""
        return "Тестовая расшифровка"

    monkeypatch.setattr(
        main,
        "transcribe_audio",
        fake_transcribe_audio,
    )

    response = client.post(
        "/upload-audio",
        files={
            "audio": (
                "test.webm",
                b"fake audio data",
                "audio/webm",
            )
        },
    )

    assert response.status_code == 200
    assert response.json()["text"] == "Тестовая расшифровка"
    assert response.json()["filename"] == "test.webm"
    assert response.json()["size"] == len(b"fake audio data")
