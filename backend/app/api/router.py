"""Top-level API router mounted under ``/api``."""

from fastapi import APIRouter

from app.api import admin, documents, explainer, health, quiz, quota, study, tts, user

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(documents.router)
api_router.include_router(quiz.router)
api_router.include_router(explainer.router)
api_router.include_router(tts.router)
api_router.include_router(study.router)
api_router.include_router(admin.router)
api_router.include_router(user.router)
api_router.include_router(quota.router)
