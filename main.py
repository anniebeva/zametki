"""FastAPI application for recording and extracting notes"""

import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from services.notes import generate_note as generate_note_from_transcript
from services.transcription import transcribe_audio

app = FastAPI()

templates = Jinja2Templates(directory="templates")

app.mount("/static", StaticFiles(directory="static"), name="static")


class GenerateNoteRequest(BaseModel):
    """Validate a note generation request"""

    transcription: str


@app.get("/")
def home(request: Request):
    """Display the home page"""
    context = {"request": request}
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context=context,
    )


@app.post("/upload-audio")
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


@app.post("/generate-note")
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
