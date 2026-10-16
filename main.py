import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from services.transcription import transcribe_audio

app = FastAPI()

templates = Jinja2Templates(directory="templates")

app.mount("/static", StaticFiles(directory="static"), name="static")


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
