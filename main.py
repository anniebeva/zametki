from fastapi import FastAPI, Request, UploadFile, File
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles

templates = Jinja2Templates(directory="templates")

app = FastAPI()

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
async def upload_audio(audio: UploadFile = File(...)):
    """Receive an audio recording from the browser"""
    audio_data = await audio.read()

    return {
        "filename": audio.filename,
        "content_type": audio.content_type,
        "size": len(audio_data),
    }
