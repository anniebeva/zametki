"""Generate a medical note from a consultation transcript"""

import asyncio
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROMPT_PATH = PROJECT_ROOT / "prompts" / "medical_notes.txt"

load_dotenv(PROJECT_ROOT / ".env")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "openrouter/free"


def read_prompt() -> str:
    """Read the medical note generation instructions"""
    return PROMPT_PATH.read_text(encoding="utf-8")


def request_note(transcription: str) -> str:
    """Send a transcript to OpenRouter and return the generated note"""
    api_key = os.getenv("OPENROUTER_API_KEY")

    if not api_key:
        raise RuntimeError("В .env не указан OPENROUTER_API_KEY")

    payload = {
        "model": MODEL,
        "messages": [
            {
                "role": "system",
                "content": read_prompt(),
            },
            {
                "role": "user",
                "content": (
                    "Составь черновик медицинской заметки "
                    "по следующей транскрипции:\n\n"
                    f"{transcription}"
                ),
            },
        ],
    }

    request = Request(
        OPENROUTER_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-Title": "Zametki",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=90) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError(f"OpenRouter вернул HTTP {error.code}") from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError("Не удалось связаться с OpenRouter") from error

    try:
        note = result["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError("OpenRouter вернул ответ в неожиданном формате") from error

    if not isinstance(note, str) or not note.strip():
        raise RuntimeError("Модель вернула пустую заметку")

    return note.strip()


async def generate_note(transcription: str) -> str:
    """Generate a note without blocking the FastAPI event loop"""
    return await asyncio.to_thread(request_note, transcription)
