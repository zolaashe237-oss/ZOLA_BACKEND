"""
Client centralisé pour l'API Gemini (Google AI Studio).

Une seule instance de modèle est créée à la demande. Toutes les tâches de
l'agent (extraction, génération, correction QRO) doivent passer par ce module
pour bénéficier du logging uniforme, du timeout, et de la validation JSON.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from django.conf import settings

logger = logging.getLogger("ai_quiz")


class AIConfigError(RuntimeError):
    """Config Gemini absente ou invalide."""


class AIGenerationError(RuntimeError):
    """L'appel Gemini a échoué après retries ou la sortie est invalide."""


_MODEL_CACHE: dict[str, Any] = {}


def _require_enabled() -> None:
    if not settings.AI_ENABLED:
        raise AIConfigError("AI_ENABLED=False — agent IA désactivé.")
    if not settings.GEMINI_API_KEY:
        raise AIConfigError("GEMINI_API_KEY manquant dans l'environnement.")


def get_model(model_name: str | None = None):
    """Retourne (et met en cache) un GenerativeModel configuré."""
    _require_enabled()
    import google.generativeai as genai

    name = model_name or settings.GEMINI_MODEL
    if name in _MODEL_CACHE:
        return _MODEL_CACHE[name]

    genai.configure(api_key=settings.GEMINI_API_KEY)
    model = genai.GenerativeModel(name)
    _MODEL_CACHE[name] = model
    return model


def generate_text(prompt: str, *, model_name: str | None = None) -> str:
    """Appel Gemini simple → texte. Utilisé pour le ping et les tests."""
    model = get_model(model_name)
    start = time.perf_counter()
    try:
        response = model.generate_content(
            prompt,
            request_options={"timeout": settings.GEMINI_TIMEOUT_S},
        )
    except Exception as exc:
        logger.exception("Gemini generate_text échec")
        raise AIGenerationError(str(exc)) from exc

    duration_ms = int((time.perf_counter() - start) * 1000)
    text = (response.text or "").strip()
    logger.info(
        "gemini.generate_text model=%s duration_ms=%d output_len=%d",
        model_name or settings.GEMINI_MODEL,
        duration_ms,
        len(text),
    )
    return text


def generate_json(
    prompt: str,
    *,
    schema: dict | None = None,
    model_name: str | None = None,
) -> dict:
    """
    Appel Gemini en JSON mode strict, avec retry × GEMINI_MAX_RETRIES.

    - `schema` : JSON schema optionnel (google-generativeai le respecte via
      `response_schema` quand fourni).
    - Retourne un dict parsé, ou lève AIGenerationError après épuisement.
    """
    import google.generativeai as genai

    model = get_model(model_name)
    generation_config: dict[str, Any] = {"response_mime_type": "application/json"}
    if schema is not None:
        generation_config["response_schema"] = schema

    last_error: Exception | None = None
    for attempt in range(1, settings.GEMINI_MAX_RETRIES + 2):
        start = time.perf_counter()
        try:
            response = model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(**generation_config),
                request_options={"timeout": settings.GEMINI_TIMEOUT_S},
            )
            raw = (response.text or "").strip()
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            last_error = exc
            logger.warning(
                "gemini.generate_json JSON invalide (attempt %d) — %s",
                attempt,
                exc,
            )
            continue
        except Exception as exc:
            last_error = exc
            logger.warning(
                "gemini.generate_json erreur API (attempt %d) — %s",
                attempt,
                exc,
            )
            continue

        duration_ms = int((time.perf_counter() - start) * 1000)
        logger.info(
            "gemini.generate_json model=%s attempt=%d duration_ms=%d keys=%s",
            model_name or settings.GEMINI_MODEL,
            attempt,
            duration_ms,
            list(data.keys()) if isinstance(data, dict) else "non-dict",
        )
        return data

    raise AIGenerationError(
        f"Gemini a échoué après {settings.GEMINI_MAX_RETRIES + 1} tentatives : {last_error}"
    )


def ping() -> str:
    """Sanity check — vérifie que la clé + le modèle répondent."""
    reply = generate_text("Réponds uniquement par le mot: pong")
    return f"{reply.lower().strip('.')}: {settings.GEMINI_MODEL}"
