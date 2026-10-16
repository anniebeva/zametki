from services.transcription import transcribe_audio


def test_transcribe_audio():
    """Check that audio transcription returns text"""
    text = transcribe_audio("test_recording.webm")

    print(f"\nРезультат распознавания: {text}")

    assert text.strip()
