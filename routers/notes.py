"""Routes for medical note generation"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.notes import generate_note as generate_note_from_transcript

router = APIRouter()


class GenerateNoteRequest(BaseModel):
    """Validate a note generation request"""

    transcription: str


@router.post("/generate-note")
async def generate_note(payload: GenerateNoteRequest):
    """Generate a note from the supplied transcript"""
    transcription = payload.transcription.strip()

    if not transcription:
        raise HTTPException(
            status_code=400,
            detail="Сначала добавьте текст транскрипции",
        )

    try:
        note = await generate_note_from_transcript(transcription)
    except RuntimeError as error:
        raise HTTPException(
            status_code=502,
            detail=str(error),
        ) from error

    return {"note": note}
