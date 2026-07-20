"""Tâches Celery — génération de quiz asynchrone (IA-B6) et correction QRO (IA-B9)."""
from __future__ import annotations

import logging
from typing import Any

from django.utils import timezone

from config.celery import app

logger = logging.getLogger("ai_quiz")


@app.task(name="ai_quiz.generate_quiz", bind=True, max_retries=0)
def generate_quiz_task(self, job_id: str) -> str:
    """Exécute la génération complète d'un quiz pour un AIQuizJob.

    - Récupère le job → PENDING → IN_PROGRESS
    - Extrait le texte source selon source_type
    - Construit prompt + appelle Gemini
    - Persiste AIQuestion en base
    - Marque le job DONE (ou FAILED avec message clair)
    """
    from apps.content.models import Module

    from .extractors import (
        PDFExtractionError,
        TranscriptNotAvailable,
        extract_pdf_text,
        extract_youtube_transcript,
    )
    from .gemini_client import AIGenerationError, generate_json
    from .models import (
        AIQuestion,
        AIQuizJob,
        DifficultyLevel,
        JobStatus,
        SourceType,
    )
    from .prompts import (
        GENERATION_SCHEMA,
        PromptValidationError,
        build_generation_prompt,
        validate_generation_output,
    )

    try:
        job = AIQuizJob.objects.select_related("module").get(pk=job_id)
    except AIQuizJob.DoesNotExist:
        logger.error("generate_quiz_task: job %s introuvable", job_id)
        return f"missing:{job_id}"

    if job.status == JobStatus.DONE:
        return f"already_done:{job_id}"

    job.status = JobStatus.IN_PROGRESS
    job.started_at = timezone.now()
    job.error_message = ""
    job.save(update_fields=["status", "started_at", "error_message"])

    try:
        # 1) Extraction du texte source
        text = _resolve_source_text(job)

        # 2) Construction du prompt
        config: dict[str, Any] = job.config or {}
        # Pour MULTI_YOUTUBE (examen final), le titre contextuel provient du config
        if job.source_type == SourceType.MULTI_YOUTUBE:
            ctx_title = config.get("formation_title") or job.module.formation.title
            ctx_desc  = f"Examen final couvrant l'ensemble de la formation."
        else:
            ctx_title = job.module.title
            ctx_desc  = getattr(job.module, "description", "") or ""
        prompt = build_generation_prompt(
            source_text=text,
            module_title=ctx_title,
            module_description=ctx_desc,
            branch=_infer_branch(job.module),
            difficulty=config.get("difficulty", DifficultyLevel.INTERMEDIAIRE),
            nb_questions=int(config.get("nb_questions", 5)),
            ratio_qcm_qro=float(config.get("ratio_qcm_qro", 0.6)),
            nb_qcm_multi=int(config.get("nb_qcm_multi", 0)),
        )

        # 3) Appel Gemini JSON mode strict (retry × N géré dans le client)
        raw = generate_json(prompt, schema=GENERATION_SCHEMA)
        job.raw_ai_output = raw

        # 4) Validation métier + persistance
        normalized = validate_generation_output(
            raw, expected_total=int(config.get("nb_questions", 5))
        )
        _persist_questions(job, normalized)

        # 5) Classification niveau + rang parcours (IA-B8) — best-effort.
        _classify_level_and_rank(job, text)

        # 6) Sauvegarde partielle si source manuelle : on garde le texte utilisé
        if not job.source_text:
            job.source_text = text[:200_000]

        job.status = JobStatus.DONE
        job.finished_at = timezone.now()
        job.save(update_fields=[
            "status", "finished_at", "raw_ai_output", "source_text",
            "suggested_level", "suggested_rank",
        ])
        logger.info(
            "generate_quiz_task done job=%s questions=%d level=%s rank=%s",
            job_id, len(normalized), job.suggested_level, job.suggested_rank,
        )
        return f"done:{job_id}:{len(normalized)}"

    except (TranscriptNotAvailable, PDFExtractionError) as exc:
        _fail_job(job, f"Extraction impossible : {exc}")
        return f"failed:{job_id}"
    except PromptValidationError as exc:
        _fail_job(job, f"Sortie Gemini invalide : {exc}")
        return f"failed:{job_id}"
    except AIGenerationError as exc:
        _fail_job(job, f"Erreur Gemini : {exc}")
        return f"failed:{job_id}"
    except Exception as exc:
        logger.exception("generate_quiz_task inattendue")
        _fail_job(job, f"Erreur inattendue : {exc}")
        return f"failed:{job_id}"


# --- Helpers privés ---------------------------------------------------------

def _resolve_source_text(job) -> str:
    from .extractors import extract_pdf_text, extract_youtube_transcript
    from .models import SourceType

    if job.source_type == SourceType.MANUAL_TEXT:
        text = (job.source_text or "").strip()
        if not text:
            raise RuntimeError("MANUAL_TEXT sans source_text.")
        return text
    if job.source_type == SourceType.VIDEO_YOUTUBE:
        return extract_youtube_transcript(job.source_ref)
    if job.source_type == SourceType.PDF:
        return extract_pdf_text(int(job.source_ref))
    if job.source_type == SourceType.MULTI_YOUTUBE:
        urls = [u.strip() for u in (job.source_ref or "").split(",") if u.strip()]
        if not urls:
            raise RuntimeError("MULTI_YOUTUBE sans source_ref.")
        texts, errors = [], []
        for url in urls:
            try:
                texts.append(extract_youtube_transcript(url))
            except Exception as exc:
                errors.append(str(exc))
        if not texts:
            raise RuntimeError(
                f"Aucune transcription disponible pour l'examen final ({len(errors)} vidéos échouées)."
            )
        logger.info(
            "multi_youtube: %d/%d transcriptions récupérées (job=%s)",
            len(texts), len(urls), job.id,
        )
        return "\n\n--- CHAPITRE SUIVANT ---\n\n".join(texts)
    raise RuntimeError(f"source_type inconnu : {job.source_type}")


def _infer_branch(module) -> str:
    """Remonte au Formation pour lire la branche (le Module n'a pas de branche propre)."""
    try:
        return module.formation.branch or "MEMBRE"
    except Exception:
        return "MEMBRE"


def _persist_questions(job, normalized: list[dict]) -> None:
    from .models import AIQuestion

    AIQuestion.objects.filter(job=job).delete()  # au cas où retry
    to_create = [
        AIQuestion(
            job=job,
            kind=q["kind"],
            text=q["text"],
            order=idx,
            choices=q.get("choices") or [],
            correct_index=q.get("correct_index"),           # None pour QCM_MULTI et QRO
            correct_indices=q.get("correct_indices") or [], # rempli pour QCM_MULTI
            criteria=q.get("criteria") or [],
        )
        for idx, q in enumerate(normalized)
    ]
    AIQuestion.objects.bulk_create(to_create)


def _fail_job(job, message: str) -> None:
    from .models import JobStatus

    job.status = JobStatus.FAILED
    job.finished_at = timezone.now()
    job.error_message = message[:2000]
    job.save(update_fields=["status", "finished_at", "error_message"])
    logger.error("generate_quiz_task fail job=%s → %s", job.id, message)


# --- IA-B8 : classification niveau + rang parcours --------------------------

_LEVEL_ORDER = {"FACILE": 1, "INTERMEDIAIRE": 2, "DIFFICILE": 3}
_MIN_TEXT_FOR_CLASSIFICATION = 500  # sous ce seuil, on ne peut pas classer


def _classify_level_and_rank(job, source_text: str) -> None:
    """Détermine `suggested_level` (via Gemini) + `suggested_rank` (algorithme).

    Best-effort : les erreurs Gemini n'invalident PAS la génération. On log et
    on laisse les champs vides — l'admin les fixe à la main dans le back-office.
    """
    from .gemini_client import AIGenerationError, generate_json
    from .prompts import (
        LEVEL_CLASSIFICATION_SCHEMA,
        PromptValidationError,
        build_level_classification_prompt,
        validate_level_classification_output,
    )

    if len(source_text or "") < _MIN_TEXT_FOR_CLASSIFICATION:
        logger.info(
            "classify.skip job=%s source_too_short len=%d",
            job.id, len(source_text or ""),
        )
        return

    branch = _infer_branch(job.module)
    peer_titles = _peer_module_titles(job, branch)

    prompt = build_level_classification_prompt(
        module_title=job.module.title,
        source_text=source_text,
        peer_titles=peer_titles,
    )

    try:
        raw = generate_json(prompt, schema=LEVEL_CLASSIFICATION_SCHEMA)
        parsed = validate_level_classification_output(raw)
    except (AIGenerationError, PromptValidationError) as exc:
        logger.warning("classify.fail job=%s → %s", job.id, exc)
        # Stocke tout de même l'erreur dans raw_ai_output pour debug.
        job.raw_ai_output = {**(job.raw_ai_output or {}), "classification_error": str(exc)}
        return

    job.suggested_level = parsed["level"]
    job.suggested_rank = _compute_rank(job, branch, parsed["level"])
    job.raw_ai_output = {**(job.raw_ai_output or {}), "classification": parsed}
    logger.info(
        "classify.done job=%s level=%s rank=%d",
        job.id, job.suggested_level, job.suggested_rank,
    )


def _peer_module_titles(job, branch: str, limit: int = 20) -> list[str]:
    """Titres des autres modules de la même branche, pour contextualiser Gemini."""
    from apps.content.models import Module

    return list(
        Module.objects
        .filter(formation__branch=branch)
        .exclude(pk=job.module_id)
        .order_by("formation__order", "order", "id")
        .values_list("title", flat=True)[:limit]
    )


def _compute_rank(job, branch: str, level: str) -> int:
    """Rang = nombre de jobs pairs (branche) avec un niveau ≤ + 1.

    Déterministe, éditable par l'admin ensuite. Ne prend en compte que les
    autres jobs DONE (les FAILED / IN_PROGRESS ne pèsent pas dans le parcours).
    """
    from .models import AIQuizJob, JobStatus

    my_score = _LEVEL_ORDER.get(level, 2)
    peer_levels = (
        AIQuizJob.objects
        .filter(module__formation__branch=branch, status=JobStatus.DONE)
        .exclude(pk=job.id)
        .values_list("suggested_level", flat=True)
    )
    lower_or_equal = sum(
        1 for lvl in peer_levels
        if lvl and _LEVEL_ORDER.get(lvl, 2) <= my_score
    )
    return lower_or_equal + 1
