"""Generate a medical note from a consultation transcript"""

import asyncio
import json
import math
import os
import re
from datetime import date
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROMPT_PATH = PROJECT_ROOT / "prompts" / "medical_notes.txt"
TEMPLATE_PROMPT_PATH = PROJECT_ROOT / "prompts" / "template_extraction.txt"
TEMPLATES_PATH = PROJECT_ROOT / "templates_data"

load_dotenv(PROJECT_ROOT / ".env")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "openrouter/free"


def read_template_schema(template_id: str) -> dict:
    """Read a medical template schema by its identifier"""
    schema_path = TEMPLATES_PATH / "medical" / template_id / "schema.json"

    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise RuntimeError("Шаблон не найден") from error
    except json.JSONDecodeError as error:
        raise RuntimeError("Файл схемы содержит некорректный JSON") from error

    if not isinstance(schema, dict):
        raise RuntimeError("Некорректная структура файла схемы")

    if schema.get("template_id") != template_id:
        raise RuntimeError("Идентификатор шаблона не совпадает")

    return schema


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


def read_template_prompt() -> str:
    """Read the structured template extraction instructions"""
    return TEMPLATE_PROMPT_PATH.read_text(encoding="utf-8")


def get_schema_fields(schema: dict) -> list[dict]:
    """Extract fields from the template schema"""
    fields = []

    for section in schema.get("sections", []):
        fields.extend(section.get("fields", []))

    return fields


def validate_template_data(data: dict, schema: dict) -> dict:
    """Validate extracted values against the template schema"""
    if not isinstance(data, dict):
        raise RuntimeError("Модель вернула не JSON-объект")

    validated_data = {}

    for field in get_schema_fields(schema):
        field_id = field.get("id")
        field_type = field.get("type")

        if not field_id:
            continue

        value = data.get(field_id)

        if field_type in ("text", "textarea"):
            validated_data[field_id] = value if isinstance(value, str) else ""

        elif field_type == "date":
            if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                try:
                    date.fromisoformat(value)
                except ValueError:
                    value = ""
            else:
                value = ""

            validated_data[field_id] = value

        elif field_type == "time":
            if isinstance(value, str) and re.fullmatch(
                r"(?:[01]\d|2[0-3]):[0-5]\d", value
            ):
                pass
            else:
                value = ""

            validated_data[field_id] = value

        elif field_type == "number":
            if (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(value)
            ):
                validated_data[field_id] = value
            else:
                validated_data[field_id] = None

        elif field_type == "select":
            allowed_values = field.get("options", [])

            if isinstance(value, str) and value in allowed_values:
                validated_data[field_id] = value
            else:
                validated_data[field_id] = ""

        else:
            validated_data[field_id] = ""

    return validated_data


def request_template_data(transcription: str, schema: dict) -> dict:
    """Extract structured medical data using the selected template schema"""
    api_key = os.getenv("OPENROUTER_API_KEY")

    if not api_key:
        raise RuntimeError("В .env не указан OPENROUTER_API_KEY")

    prompt = read_template_prompt()
    prompt = prompt.replace(
        "{{schema}}",
        json.dumps(schema, ensure_ascii=False),
    )
    prompt = prompt.replace("{{transcription}}", transcription)

    payload = {
        "model": MODEL,
        "temperature": 0,
        "messages": [
            {
                "role": "system",
                "content": prompt,
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
        content = result["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError("OpenRouter вернул ответ в неожиданном формате") from error

    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("Модель вернула пустой ответ")

    # Remove Markdown code fences if the model included them
    content = content.strip()
    content = re.sub(r"^```(?:json)?\s*", "", content)
    content = re.sub(r"\s*```$", "", content)

    try:
        extracted_data = json.loads(content)
    except json.JSONDecodeError as error:
        raise RuntimeError("Модель вернула некорректный JSON") from error

    return validate_template_data(extracted_data, schema)


async def generate_template_data(
    transcription: str,
    schema: dict,
) -> dict:
    """Extract structured medical data without blocking the event loop"""
    return await asyncio.to_thread(
        request_template_data,
        transcription,
        schema,
    )
