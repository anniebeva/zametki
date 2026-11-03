"""Routes for medical note generation"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.notes import (
    generate_note as generate_note_from_transcript,
)
from services.notes import (
    generate_template_data,
    read_template_schema,
)

router = APIRouter(prefix="/api")


class GenerateNoteRequest(BaseModel):
    """Validate a note generation request"""

    transcription: str


class FillTemplateRequest(BaseModel):
    """Validate a structured template filling request"""

    template_id: str = Field(pattern=r"^[a-zA-Z0-9_-]+$")
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


@router.post("/fill-template")
async def fill_template(payload: FillTemplateRequest):
    """Fill a medical template using the supplied transcript"""
    transcription = payload.transcription.strip()

    if not transcription:
        raise HTTPException(
            status_code=400,
            detail="Сначала добавьте текст транскрипции",
        )

    try:
        schema = read_template_schema(payload.template_id)
    except RuntimeError as error:
        status_code = 404 if str(error) == "Шаблон не найден" else 500
        raise HTTPException(
            status_code=status_code,
            detail=str(error),
        ) from error

    try:
        data = await generate_template_data(transcription, schema)
    except RuntimeError as error:
        raise HTTPException(
            status_code=502,
            detail=str(error),
        ) from error

    return {
        "template_id": payload.template_id,
        "data": data,
    }
