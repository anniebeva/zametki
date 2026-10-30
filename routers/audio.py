"""Routes for audio processing"""

import tempfile
from pathlib import Path

from fastapi import APIRouter, File, UploadFile

from services.transcription import transcribe_audio

router = APIRouter()


@router.post("/upload-audio")
async def upload_audio(audio: UploadFile = File(...)):  # noqa: B008
    """Receive and temporarily save an audio recording"""
    audio_data = await audio.read()

    with tempfile.NamedTemporaryFile(
        suffix=".webm",
        delete=False,
    ) as temp_file:
        temp_file.write(audio_data)
        audio_path = Path(temp_file.name)

    try:
        text = transcribe_audio(str(audio_path))
    finally:
        audio_path.unlink(missing_ok=True)

    return {
        "filename": audio.filename,
        "content_type": audio.content_type,
        "size": len(audio_data),
        "text": text,
    }
