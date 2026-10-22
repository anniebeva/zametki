from pathlib import Path

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


def test_upload_audio_removes_temp_file(monkeypatch, tmp_path):
    """Check that the temporary audio file is removed after transcription"""
    temp_paths = []
    original_named_temporary_file = main.tempfile.NamedTemporaryFile

    def fake_named_temporary_file(*args, **kwargs):
        kwargs["dir"] = tmp_path
        file = original_named_temporary_file(*args, **kwargs)
        temp_paths.append(Path(file.name))
        return file

    monkeypatch.setattr(
        main.tempfile,
        "NamedTemporaryFile",
        fake_named_temporary_file,
    )
    monkeypatch.setattr(
        main,
        "transcribe_audio",
        lambda audio_path: "Тестовая расшифровка",
    )

    error_client = TestClient(
        main.app,
        raise_server_exceptions=False,
    )

    response = error_client.post(
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
    assert len(temp_paths) == 1
    assert not temp_paths[0].exists()


def test_upload_audio_removes_temp_file_on_error(monkeypatch, tmp_path):
    """Check that the temporary audio file is removed when transcription fails"""
    temp_paths = []
    original_named_temporary_file = main.tempfile.NamedTemporaryFile

    def fake_named_temporary_file(*args, **kwargs):
        kwargs["dir"] = tmp_path
        file = original_named_temporary_file(*args, **kwargs)
        temp_paths.append(Path(file.name))
        return file

    def fake_transcribe_audio(audio_path):
        """Simulate a transcription error"""
        raise RuntimeError("Transcription failed")

    monkeypatch.setattr(
        main,
        "tempfile",
        main.tempfile,
    )
    monkeypatch.setattr(
        main.tempfile,
        "NamedTemporaryFile",
        fake_named_temporary_file,
    )
    monkeypatch.setattr(
        main,
        "transcribe_audio",
        fake_transcribe_audio,
    )

    error_client = TestClient(
        main.app,
        raise_server_exceptions=False,
    )

    response = error_client.post(
        "/upload-audio",
        files={
            "audio": (
                "test.webm",
                b"fake audio data",
                "audio/webm",
            )
        },
    )

    assert response.status_code == 500
    assert len(temp_paths) == 1
    assert not temp_paths[0].exists()


def test_generate_note(monkeypatch):
    """Check that the API returns a generated medical note"""

    async def fake_generate_note(transcription):
        """Return test note instead of calling the LLM"""
        assert transcription == "Тестовая транскрипция"
        return "Тестовая медицинская заметка"

    monkeypatch.setattr(
        main,
        "generate_note_from_transcript",
        fake_generate_note,
    )

    response = client.post(
        "/generate-note",
        json={"transcription": "Тестовая транскрипция"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "note": "Тестовая медицинская заметка",
    }


def test_generate_note_empty_transcription():
    """Check that empty transcription is rejected"""

    response = client.post(
        "/generate-note",
        json={"transcription": "   "},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == ("Сначала добавьте текст транскрипции")


def test_generate_note_service_error(monkeypatch):
    """Check that the API handles note generation errors"""

    async def fake_generate_note(transcription):
        """Simulate an LLM service error"""
        raise RuntimeError("LLM service failed")

    monkeypatch.setattr(
        main,
        "generate_note_from_transcript",
        fake_generate_note,
    )

    response = client.post(
        "/generate-note",
        json={"transcription": "Тестовая транскрипция"},
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "LLM service failed"
