from groq import Groq


def transcribe_audio(audio_path: str) -> str:
    """Convert an audio recording to text"""
    client = Groq()

    with open(audio_path, "rb") as audio_file:
        transcription = client.audio.transcriptions.create(
            file=(audio_path, audio_file.read()),
            model="whisper-large-v3",
            language="ru",
            response_format="json",
            temperature=0.0,
        )

    return transcription.text.strip()
