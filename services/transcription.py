from faster_whisper import WhisperModel

model = WhisperModel(
    "small",
    device="cpu",
    compute_type="int8",
)


def transcribe_audio(audio_path: str) -> str:
    """Convert an audio recording to text"""
    segments, info = model.transcribe(
        audio_path,
        language="ru",
    )

    text = " ".join(segment.text.strip() for segment in segments)
    return text
