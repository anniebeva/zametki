"""FastAPI application for recording and extracting notes"""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from routers import audio, notes, pages, templates

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")

app.include_router(pages.router)
app.include_router(templates.router)
app.include_router(audio.router)
app.include_router(notes.router)
