"""Service de prompt engineering — source de vérité des prompts + schémas JSON.

Trois usages exposés :
  * build_generation_prompt() → génération quiz (IA-B6)
  * build_qro_evaluation_prompt() → correction QRO (IA-B9)
  * build_level_classification_prompt() → classification niveau + rang (IA-B8)

Chaque prompt est accompagné d'un `*_SCHEMA` JSON qui contraint la sortie de
Gemini (JSON mode strict). Un validateur post-appel vérifie la cohérence
métier (nombre de choix, index valide, etc.) et lève PromptValidationError
si non conforme — ce qui déclenche un retry côté generate_json().
"""
from __future__ import annotations

from typing import Any


# --- Exceptions --------------------------------------------------------------

class PromptValidationError(RuntimeError):
    """Sortie Gemini reçue mais non conforme aux règles métier."""


# --- Contexte ZOLA ASHÉ ------------------------------------------------------

BRANCH_TONE = {
    "MEMBRE": (
        "Ton adulte, bienveillant et respectueux. Vocabulaire spirituel africain "
        "accessible sans jargon obscur."
    ),
    "FEMME": (
        "Ton féminin, empathique, sororal. Références culturelles adaptées aux "
        "réalités des femmes africaines."
    ),
    "ENFANT": (
        "Ton simple, chaleureux, phrases courtes (max 15 mots). Vocabulaire "
        "adapté aux 8-14 ans. Éviter les concepts abstraits complexes."
    ),
}

DIFFICULTY_HINT = {
    "FACILE": "questions de mémorisation directe (définitions, faits explicites du texte).",
    "INTERMEDIAIRE": "questions de compréhension (reformulation, liens entre notions).",
    "DIFFICILE": "questions d'analyse et d'application (transfert, cas d'usage, nuances).",
}

# Instruction commune à tous les prompts — garde-fous critiques.
_GLOBAL_GUARDRAILS = (
    "RÈGLES ABSOLUES :\n"
    "1. Réponds UNIQUEMENT avec un objet JSON valide, sans texte hors JSON, "
    "sans balise ```json```.\n"
    "2. Toutes les questions doivent porter STRICTEMENT sur le contenu source ci-dessous. "
    "N'invente RIEN qui ne soit dans le texte.\n"
    "3. Rédige en français.\n"
    "4. Reste factuel : pas d'opinions personnelles, pas de références à ta nature "
    "d'IA, pas d'excuses."
)


# --- SCHÉMAS JSON (Gemini response_schema) ----------------------------------

# Pour l'endpoint génération. On laisse Gemini renvoyer soit QCM soit QRO
# dans la même liste — on valide côté serveur.
GENERATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["QCM", "QCM_MULTI", "QRO"]},
                    "text": {"type": "string"},
                    "choices": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "correct_index": {"type": "integer"},
                    "correct_indices": {
                        "type": "array",
                        "items": {"type": "integer"},
                    },
                    "criteria": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["kind", "text"],
            },
        },
    },
    "required": ["questions"],
}

QRO_EVALUATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "verdict": {
            "type": "string",
            "enum": ["VALIDATED", "REJECTED", "NEEDS_REVIEW"],
        },
        "score": {"type": "integer"},
        "justification": {"type": "string"},
    },
    "required": ["verdict", "score", "justification"],
}

LEVEL_CLASSIFICATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "level": {
            "type": "string",
            "enum": ["FACILE", "INTERMEDIAIRE", "DIFFICILE"],
        },
        "reason": {"type": "string"},
    },
    "required": ["level", "reason"],
}


# --- BUILDERS ---------------------------------------------------------------

def build_generation_prompt(
    *,
    source_text: str,
    module_title: str,
    module_description: str = "",
    branch: str = "MEMBRE",
    difficulty: str = "INTERMEDIAIRE",
    nb_questions: int = 5,
    ratio_qcm_qro: float = 0.6,
    nb_qcm_multi: int = 0,
) -> str:
    """Construit le prompt de génération d'un quiz depuis un contenu source.

    ratio_qcm_qro = fraction de QCM au total (simple + multi) par rapport aux QRO.
    nb_qcm_multi  = nombre de QCM à réponses multiples (sous-ensemble des QCM).
    """
    tone = BRANCH_TONE.get(branch, BRANCH_TONE["MEMBRE"])
    diff_hint = DIFFICULTY_HINT.get(difficulty, DIFFICULTY_HINT["INTERMEDIAIRE"])

    nb_qcm_total = round(nb_questions * ratio_qcm_qro)
    nb_qcm_multi = max(0, min(nb_qcm_multi, nb_qcm_total))
    nb_qcm_simple = nb_qcm_total - nb_qcm_multi
    nb_qro = nb_questions - nb_qcm_total

    # Build the per-type instruction lines (only mention types with count > 0).
    type_lines = []
    if nb_qcm_simple > 0:
        type_lines.append(
            f"  * {nb_qcm_simple} de type QCM : EXACTEMENT 4 choix, "
            f"UNE seule bonne réponse, \"correct_index\" entre 0 et 3."
        )
    if nb_qcm_multi > 0:
        type_lines.append(
            f"  * {nb_qcm_multi} de type QCM_MULTI : 4 à 5 choix, "
            f"PLUSIEURS bonnes réponses (exactement 2 ou 3), "
            f"\"correct_indices\" = liste des indices corrects (ex : [0, 2])."
        )
    if nb_qro > 0:
        type_lines.append(
            f"  * {nb_qro} de type QRO : question à réponse ouverte, "
            f"2 à 4 critères d'évaluation courts (10 à 20 mots chacun)."
        )
    types_block = "\n".join(type_lines)

    # Build the JSON example block.
    examples: list[str] = []
    if nb_qcm_simple > 0:
        examples.append(
            '    {\n'
            '      "kind": "QCM",\n'
            '      "text": "...",\n'
            '      "choices": ["...", "...", "...", "..."],\n'
            '      "correct_index": 0\n'
            '    }'
        )
    if nb_qcm_multi > 0:
        examples.append(
            '    {\n'
            '      "kind": "QCM_MULTI",\n'
            '      "text": "...",\n'
            '      "choices": ["...", "...", "...", "...", "..."],\n'
            '      "correct_indices": [0, 2]\n'
            '    }'
        )
    if nb_qro > 0:
        examples.append(
            '    {\n'
            '      "kind": "QRO",\n'
            '      "text": "...",\n'
            '      "criteria": ["Doit citer X", "Doit expliquer Y"]\n'
            '    }'
        )
    examples_block = ",\n".join(examples)

    return f"""Tu es l'assistant pédagogique de la plateforme ZOLA ASHÉ, spécialisée
dans la spiritualité africaine. Tu prépares un quiz à partir du contenu ci-dessous.

CONTEXTE MODULE :
- Titre : {module_title}
- Description : {module_description or "(non fournie)"}
- Branche : {branch} — {tone}
- Difficulté demandée : {difficulty} — {diff_hint}

CE QUE TU DOIS PRODUIRE :
- {nb_questions} questions au total :
{types_block}

RÈGLES PAR TYPE :
- QCM       : 1 seule bonne réponse. Champ "correct_index" obligatoire (entier 0-based).
- QCM_MULTI : 2 ou 3 bonnes réponses parmi 4–5 choix. Champ "correct_indices" obligatoire (liste d'entiers). Pas de "correct_index".
- QRO       : réponse ouverte. Champ "criteria" obligatoire (liste de 2 à 4 critères courts). Pas de "choices".

FORMAT JSON ATTENDU :
{{
  "questions": [
{examples_block}
  ]
}}

{_GLOBAL_GUARDRAILS}

CONTENU SOURCE :
\"\"\"
{source_text}
\"\"\"
"""


def build_qro_evaluation_prompt(
    *,
    source_text: str,
    question_text: str,
    criteria: list[str],
    student_answer: str,
) -> str:
    """Construit le prompt de correction sémantique d'une QRO."""
    criteria_bullet = "\n".join(f"- {c}" for c in criteria) or "- (aucun critère)"

    return f"""Tu es le correcteur de la plateforme ZOLA ASHÉ. Tu évalues la
réponse d'un étudiant à une question ouverte, sur une note de 0 à 20.

CONTENU SOURCE (référence de correction) :
\"\"\"
{source_text}
\"\"\"

QUESTION POSÉE :
{question_text}

CRITÈRES D'ÉVALUATION :
{criteria_bullet}

RÉPONSE DE L'ÉTUDIANT :
\"\"\"
{student_answer}
\"\"\"

BARÈME :
- 16 à 20 → VALIDATED : la réponse couvre l'essentiel des critères.
- 8 à 15  → NEEDS_REVIEW : réponse partielle, ambiguë, ou nécessite un jugement humain.
- 0 à 7   → REJECTED : réponse absente, hors-sujet, ou factuellement fausse.

FORMAT JSON ATTENDU :
{{
  "verdict": "VALIDATED" | "REJECTED" | "NEEDS_REVIEW",
  "score": 0-20,
  "justification": "une phrase courte (≤ 200 caractères) expliquant la note."
}}

{_GLOBAL_GUARDRAILS}
"""


def build_level_classification_prompt(
    *,
    module_title: str,
    source_text: str,
    peer_titles: list[str] | None = None,
) -> str:
    """Prompt de classification du niveau d'un quiz + rang suggéré (IA-B8).

    `peer_titles` : titres des autres modules de la même branche (pour situer
    le niveau relatif). Si vide, on classifie sur la seule difficulté intrinsèque.
    """
    peers_block = ""
    if peer_titles:
        peers_bullet = "\n".join(f"- {t}" for t in peer_titles)
        peers_block = f"\n\nAUTRES MODULES DE LA BRANCHE (pour situer le niveau) :\n{peers_bullet}\n"

    return f"""Tu classifies la difficulté d'un module pédagogique de la plateforme
ZOLA ASHÉ. Estime son niveau parmi FACILE, INTERMEDIAIRE, DIFFICILE.

MODULE À CLASSIFIER : {module_title}

EXTRAIT DU CONTENU :
\"\"\"
{source_text[:8000]}
\"\"\"
{peers_block}
CRITÈRES :
- FACILE : vocabulaire simple, notions de base, prérequis nuls.
- INTERMEDIAIRE : notions structurées, quelques prérequis (module d'introduction fait).
- DIFFICILE : analyse fine, nuances, prérequis de plusieurs modules.

FORMAT JSON ATTENDU :
{{
  "level": "FACILE" | "INTERMEDIAIRE" | "DIFFICILE",
  "reason": "une phrase courte justifiant la classification."
}}

{_GLOBAL_GUARDRAILS}
"""


# --- VALIDATEURS post-Gemini -----------------------------------------------

def validate_generation_output(
    data: dict,
    *,
    expected_total: int | None = None,
) -> list[dict]:
    """Valide la sortie de génération. Lève PromptValidationError si non conforme.

    Retourne la liste `questions` normalisée (choices/criteria toujours présents).
    """
    if not isinstance(data, dict) or "questions" not in data:
        raise PromptValidationError("Champ 'questions' absent de la sortie Gemini.")

    questions = data["questions"]
    if not isinstance(questions, list) or not questions:
        raise PromptValidationError("La liste 'questions' est vide ou invalide.")

    if expected_total is not None and len(questions) != expected_total:
        # On tolère ±1 sans casser (Gemini arrondit parfois).
        if abs(len(questions) - expected_total) > 1:
            raise PromptValidationError(
                f"Nombre de questions attendu {expected_total}, reçu {len(questions)}."
            )

    normalized: list[dict] = []
    for idx, q in enumerate(questions):
        if not isinstance(q, dict):
            raise PromptValidationError(f"Question #{idx} n'est pas un objet.")
        kind = q.get("kind")
        text = (q.get("text") or "").strip()
        if kind not in ("QCM", "QCM_MULTI", "QRO"):
            raise PromptValidationError(f"Question #{idx} : kind invalide ({kind!r}).")
        if not text:
            raise PromptValidationError(f"Question #{idx} : texte vide.")

        if kind == "QCM":
            choices = q.get("choices") or []
            correct_index = q.get("correct_index")
            if not isinstance(choices, list) or len(choices) != 4:
                raise PromptValidationError(
                    f"QCM #{idx} : exactement 4 choix attendus, reçu {len(choices)}."
                )
            if any(not isinstance(c, str) or not c.strip() for c in choices):
                raise PromptValidationError(f"QCM #{idx} : choix vide ou non-string.")
            if not isinstance(correct_index, int) or not (0 <= correct_index < 4):
                raise PromptValidationError(
                    f"QCM #{idx} : correct_index invalide ({correct_index!r})."
                )
            normalized.append({
                "kind": "QCM",
                "text": text,
                "choices": [c.strip() for c in choices],
                "correct_index": correct_index,
                "correct_indices": [],
                "criteria": [],
            })

        elif kind == "QCM_MULTI":
            choices = q.get("choices") or []
            correct_indices = q.get("correct_indices") or []
            if not isinstance(choices, list) or not (4 <= len(choices) <= 5):
                raise PromptValidationError(
                    f"QCM_MULTI #{idx} : 4 à 5 choix attendus, reçu {len(choices)}."
                )
            if any(not isinstance(c, str) or not c.strip() for c in choices):
                raise PromptValidationError(f"QCM_MULTI #{idx} : choix vide ou non-string.")
            if not isinstance(correct_indices, list) or not (2 <= len(correct_indices) <= 3):
                raise PromptValidationError(
                    f"QCM_MULTI #{idx} : 2 ou 3 indices corrects attendus, reçu {len(correct_indices)}."
                )
            if any(not isinstance(i, int) or not (0 <= i < len(choices)) for i in correct_indices):
                raise PromptValidationError(
                    f"QCM_MULTI #{idx} : correct_indices hors bornes ({correct_indices!r})."
                )
            normalized.append({
                "kind": "QCM_MULTI",
                "text": text,
                "choices": [c.strip() for c in choices],
                "correct_index": None,
                "correct_indices": list(dict.fromkeys(correct_indices)),  # déduplique
                "criteria": [],
            })

        else:  # QRO
            criteria = q.get("criteria") or []
            if not isinstance(criteria, list) or not (2 <= len(criteria) <= 4):
                raise PromptValidationError(
                    f"QRO #{idx} : 2 à 4 critères attendus, reçu {len(criteria)}."
                )
            if any(not isinstance(c, str) or not c.strip() for c in criteria):
                raise PromptValidationError(f"QRO #{idx} : critère vide ou non-string.")
            normalized.append({
                "kind": "QRO",
                "text": text,
                "choices": [],
                "correct_index": None,
                "correct_indices": [],
                "criteria": [c.strip() for c in criteria],
            })

    return normalized


def validate_qro_evaluation_output(data: dict) -> dict:
    """Valide la sortie de correction QRO."""
    if not isinstance(data, dict):
        raise PromptValidationError("Sortie QRO non-dict.")
    verdict = data.get("verdict")
    score = data.get("score")
    justification = (data.get("justification") or "").strip()

    if verdict not in ("VALIDATED", "REJECTED", "NEEDS_REVIEW"):
        raise PromptValidationError(f"Verdict invalide : {verdict!r}.")
    if not isinstance(score, int) or not (0 <= score <= 20):
        raise PromptValidationError(f"Score invalide : {score!r}.")
    if not justification:
        raise PromptValidationError("Justification vide.")

    return {"verdict": verdict, "score": score, "justification": justification}


def validate_level_classification_output(data: dict) -> dict:
    """Valide la sortie de classification niveau."""
    if not isinstance(data, dict):
        raise PromptValidationError("Sortie level non-dict.")
    level = data.get("level")
    reason = (data.get("reason") or "").strip()
    if level not in ("FACILE", "INTERMEDIAIRE", "DIFFICILE"):
        raise PromptValidationError(f"Niveau invalide : {level!r}.")
    return {"level": level, "reason": reason}
