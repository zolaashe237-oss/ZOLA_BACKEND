"""
Client IA centralisé, multi-fournisseur : Gemini, OpenAI (ChatGPT), Claude.

Le fournisseur actif est choisi par `AI_PROVIDER` (gemini | openai | anthropic).
Toutes les tâches de l'agent (extraction, génération, correction QRO,
transcription) doivent passer par ce module pour bénéficier du logging
uniforme, du timeout, des retries et de la validation JSON.
"""
from __future__ import annotations

import copy
import json
import logging
import time
from typing import Any

from django.conf import settings

logger = logging.getLogger("ai_quiz")

PROVIDERS = ("gemini", "openai", "anthropic")

TRANSCRIBE_INSTRUCTIONS = (
    "Transcris fidèlement ce témoignage oral en français. "
    "Conserve le style parlé et les tournures naturelles. "
    "Ne corrige pas les imperfections grammaticales du registre oral. "
    "Renvoie uniquement la transcription, sans commentaire ni ajout."
)


class AIConfigError(RuntimeError):
    """Config IA absente ou invalide."""


class AIGenerationError(RuntimeError):
    """L'appel IA a échoué après retries ou la sortie est invalide."""


_CLIENT_CACHE: dict[str, Any] = {}


def _provider() -> str:
    provider = (settings.AI_PROVIDER or "").lower().strip()
    if provider not in PROVIDERS:
        raise AIConfigError(
            f"AI_PROVIDER={settings.AI_PROVIDER!r} invalide — attendu : {', '.join(PROVIDERS)}."
        )
    return provider


def _api_key(provider: str) -> str:
    return {
        "gemini": settings.GEMINI_API_KEY,
        "openai": settings.OPENAI_API_KEY,
        "anthropic": settings.ANTHROPIC_API_KEY,
    }[provider]


def _default_model(provider: str) -> str:
    return {
        "gemini": settings.GEMINI_MODEL,
        "openai": settings.OPENAI_MODEL,
        "anthropic": settings.ANTHROPIC_MODEL,
    }[provider]


def _require_enabled(provider: str) -> None:
    if not settings.AI_ENABLED:
        raise AIConfigError("AI_ENABLED=False — agent IA désactivé.")
    if not _api_key(provider):
        raise AIConfigError(f"Clé API manquante pour le fournisseur IA « {provider} ».")


# --- Clients SDK ------------------------------------------------------------

def get_model(model_name: str | None = None):
    """Retourne (et met en cache) un GenerativeModel Gemini configuré."""
    _require_enabled("gemini")
    import google.generativeai as genai

    name = model_name or settings.GEMINI_MODEL
    key = f"gemini:{name}"
    if key in _CLIENT_CACHE:
        return _CLIENT_CACHE[key]

    genai.configure(api_key=settings.GEMINI_API_KEY)
    model = genai.GenerativeModel(name)
    _CLIENT_CACHE[key] = model
    return model


def _openai_client():
    _require_enabled("openai")
    if "openai" not in _CLIENT_CACHE:
        from openai import OpenAI

        # Les retries sont gérés par generate_json (boucle AI_MAX_RETRIES).
        _CLIENT_CACHE["openai"] = OpenAI(
            api_key=settings.OPENAI_API_KEY,
            timeout=settings.AI_TIMEOUT_S,
            max_retries=0,
        )
    return _CLIENT_CACHE["openai"]


def _anthropic_client():
    _require_enabled("anthropic")
    if "anthropic" not in _CLIENT_CACHE:
        import anthropic

        _CLIENT_CACHE["anthropic"] = anthropic.Anthropic(
            api_key=settings.ANTHROPIC_API_KEY,
            timeout=settings.AI_TIMEOUT_S,
            max_retries=0,
        )
    return _CLIENT_CACHE["anthropic"]


# --- Appels bruts par fournisseur -------------------------------------------

def _closed_schema(schema: dict) -> dict:
    """Copie du schéma avec additionalProperties=False sur chaque objet
    (exigé par les structured outputs de Claude)."""
    schema = copy.deepcopy(schema)

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object":
                node.setdefault("additionalProperties", False)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(schema)
    return schema


def _gemini_call(prompt: str, *, schema: dict | None, json_mode: bool, model_name: str) -> str:
    import google.generativeai as genai

    model = get_model(model_name)
    kwargs: dict[str, Any] = {"request_options": {"timeout": settings.AI_TIMEOUT_S}}
    if json_mode:
        generation_config: dict[str, Any] = {"response_mime_type": "application/json"}
        if schema is not None:
            generation_config["response_schema"] = schema
        kwargs["generation_config"] = genai.types.GenerationConfig(**generation_config)
    response = model.generate_content(prompt, **kwargs)
    return (response.text or "").strip()


def _openai_call(prompt: str, *, schema: dict | None, json_mode: bool, model_name: str) -> str:
    client = _openai_client()
    kwargs: dict[str, Any] = {}
    if json_mode:
        if schema is not None:
            kwargs["response_format"] = {
                "type": "json_schema",
                # strict=False : nos schémas ont des champs optionnels, que le
                # mode strict d'OpenAI refuse. La sortie est validée côté serveur.
                "json_schema": {"name": "response", "schema": schema, "strict": False},
            }
        else:
            kwargs["response_format"] = {"type": "json_object"}
    response = client.chat.completions.create(
        model=model_name,
        messages=[{"role": "user", "content": prompt}],
        **kwargs,
    )
    choice = response.choices[0]
    if choice.finish_reason == "content_filter":
        raise AIGenerationError("OpenAI a filtré la réponse (content_filter).")
    return (choice.message.content or "").strip()


def _anthropic_call(prompt: str, *, schema: dict | None, json_mode: bool, model_name: str) -> str:
    client = _anthropic_client()
    kwargs: dict[str, Any] = {}
    if json_mode:
        if schema is not None:
            kwargs["output_config"] = {
                "format": {"type": "json_schema", "schema": _closed_schema(schema)}
            }
        else:
            prompt = f"{prompt}\n\nRéponds uniquement avec un objet JSON valide."
    # fallbacks="default" : si les classifieurs de sécurité refusent la
    # requête, l'API la rejoue sur le modèle de repli recommandé.
    response = client.beta.messages.create(
        model=model_name,
        max_tokens=16000,
        messages=[{"role": "user", "content": prompt}],
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        **kwargs,
    )
    if response.stop_reason == "refusal":
        raise AIGenerationError("Claude a refusé la requête (stop_reason=refusal).")
    return "".join(b.text for b in response.content if b.type == "text").strip()


_CALLS = {
    "gemini": _gemini_call,
    "openai": _openai_call,
    "anthropic": _anthropic_call,
}


# --- API publique -------------------------------------------------------------

def generate_text(prompt: str, *, model_name: str | None = None) -> str:
    """Appel IA simple → texte. Utilisé pour le ping et les tests."""
    provider = _provider()
    _require_enabled(provider)
    name = model_name or _default_model(provider)
    start = time.perf_counter()
    try:
        text = _CALLS[provider](prompt, schema=None, json_mode=False, model_name=name)
    except AIGenerationError:
        raise
    except Exception as exc:
        logger.exception("%s generate_text échec", provider)
        raise AIGenerationError(str(exc)) from exc

    duration_ms = int((time.perf_counter() - start) * 1000)
    logger.info(
        "%s.generate_text model=%s duration_ms=%d output_len=%d",
        provider,
        name,
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
    Appel IA en JSON mode strict, avec retry × AI_MAX_RETRIES.

    - `schema` : JSON schema optionnel, transmis au fournisseur actif
      (response_schema Gemini, json_schema OpenAI, output_config Claude).
    - Retourne un dict parsé, ou lève AIGenerationError après épuisement.
    """
    provider = _provider()
    _require_enabled(provider)
    name = model_name or _default_model(provider)

    last_error: Exception | None = None
    for attempt in range(1, settings.AI_MAX_RETRIES + 2):
        start = time.perf_counter()
        try:
            raw = _CALLS[provider](prompt, schema=schema, json_mode=True, model_name=name)
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            last_error = exc
            logger.warning(
                "%s.generate_json JSON invalide (attempt %d) — %s",
                provider,
                attempt,
                exc,
            )
            continue
        except Exception as exc:
            last_error = exc
            logger.warning(
                "%s.generate_json erreur API (attempt %d) — %s",
                provider,
                attempt,
                exc,
            )
            continue

        duration_ms = int((time.perf_counter() - start) * 1000)
        logger.info(
            "%s.generate_json model=%s attempt=%d duration_ms=%d keys=%s",
            provider,
            name,
            attempt,
            duration_ms,
            list(data.keys()) if isinstance(data, dict) else "non-dict",
        )
        return data

    raise AIGenerationError(
        f"{provider} a échoué après {settings.AI_MAX_RETRIES + 1} tentatives : {last_error}"
    )


def transcribe_audio(audio_bytes: bytes, mime_type: str, filename: str = "audio") -> str:
    """
    Transcrit un enregistrement audio en français.

    Claude ne lit pas l'audio : si AI_PROVIDER=anthropic, on bascule sur
    OpenAI puis Gemini, selon la clé disponible.
    """
    provider = _provider()
    if provider == "anthropic":
        if settings.OPENAI_API_KEY:
            provider = "openai"
        elif settings.GEMINI_API_KEY:
            provider = "gemini"
        else:
            raise AIConfigError(
                "Transcription audio : Claude ne gère pas l'audio, "
                "configurer OPENAI_API_KEY ou GEMINI_API_KEY."
            )

    if provider == "openai":
        response = _openai_client().audio.transcriptions.create(
            model=settings.OPENAI_TRANSCRIBE_MODEL,
            file=(filename, audio_bytes, mime_type),
            language="fr",
            prompt="Témoignage oral en français, style parlé conservé.",
        )
        return (response.text or "").strip()

    # Le SDK Gemini encode lui-même en base64 — passer les bytes bruts
    response = get_model().generate_content(
        [{"mime_type": mime_type, "data": audio_bytes}, TRANSCRIBE_INSTRUCTIONS],
        request_options={"timeout": settings.AI_TIMEOUT_S},
    )
    return (response.text or "").strip()


def ping() -> str:
    """Sanity check — vérifie que la clé + le modèle du fournisseur actif répondent."""
    reply = generate_text("Réponds uniquement par le mot: pong")
    provider = _provider()
    return f"{reply.lower().strip('.')}: {provider}/{_default_model(provider)}"
