"""Routes for medical note templates"""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()

TEMPLATES_DATA_DIR = Path("templates_data/medical")


def load_template_schema(template_id: str):
    """Load a medical template schema"""
    schema_path = TEMPLATES_DATA_DIR / template_id / "schema.json"

    if not schema_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Шаблон не найден",
        )

    try:
        with schema_path.open(encoding="utf-8") as file:
            schema = json.load(file)
    except (OSError, json.JSONDecodeError) as error:
        raise HTTPException(
            status_code=500,
            detail=f"Не удалось прочитать шаблон {template_id}",
        ) from error

    return schema


@router.get("/api/templates")
def get_templates():
    """Return available medical note templates"""
    available_templates = []

    for schema_path in TEMPLATES_DATA_DIR.glob("*/schema.json"):
        try:
            with schema_path.open(encoding="utf-8") as file:
                schema = json.load(file)
        except (OSError, json.JSONDecodeError) as error:
            raise HTTPException(
                status_code=500,
                detail=f"Не удалось прочитать шаблон {schema_path.parent.name}",
            ) from error

        available_templates.append(
            {
                "template_id": schema["template_id"],
                "name": schema["name"],
                "version": schema["version"],
            }
        )

    return {"templates": available_templates}


@router.get("/api/templates/{template_id}")
def get_template(template_id: str):
    """Return a complete medical template schema"""
    return load_template_schema(template_id)
