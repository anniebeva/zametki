"""Routes for application pages"""

from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates

router = APIRouter()

templates = Jinja2Templates(directory="templates")


@router.get("/")
def home(request: Request):
    """Display the home page"""
    context = {"request": request}

    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context=context,
    )
