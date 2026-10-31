"""Interrupteurs de fonctionnalités (quiz, cotisation mensuelle, sections de l'espace membre).

Les valeurs sont stockées dans le singleton `GlobalSettings` et modifiées depuis
le back-office (`/api/admin/settings/features/`). Elles sont lues via le cache
(`GlobalSettings.cached()`) car certains contrôles s'exécutent à chaque requête.
"""
from .models import GlobalSettings

# Sections masquables de l'espace membre : clé → (libellé, préfixes d'API bloqués).
# Les clés correspondent aux identifiants d'onglets du front membre.
# Une section sans préfixe est seulement masquée côté front (son API sert aussi
# ailleurs : catalogue public, paiements…).
MEMBER_SECTIONS: dict[str, tuple[str, tuple[str, ...]]] = {
    "communaute":   ("Communauté", ("/api/community/",)),
    "formations":   ("Formations", ()),
    "progression":  ("Progression", ()),
    "bibliotheque": ("Bibliothèque", ("/api/library/",)),
    "audio":        ("Audiothèque", ("/api/audio/",)),
    "lives":        ("Lives", ("/api/lives/",)),
    "transactions": ("Transactions", ()),
    "parrainage":   ("Parrainage", ("/api/affiliation/", "/api/affiliate/")),
    "mon-histoire": ("Mon histoire", ("/api/memoir/",)),
}

# Endpoints membre des QCM (les routes admin vivent sous /api/admin/).
QUIZ_API_PREFIXES = ("/api/quizzes/", "/api/quiz/")


def quiz_enabled() -> bool:
    return GlobalSettings.cached().quiz_enabled


def monthly_subscription_enabled() -> bool:
    return GlobalSettings.cached().monthly_subscription_enabled


def hidden_sections() -> list[str]:
    return [s for s in (GlobalSettings.cached().hidden_sections or []) if s in MEMBER_SECTIONS]


def blocked_feature_for_path(path: str) -> str | None:
    """Clé de la fonctionnalité désactivée qui couvre ce chemin d'API, sinon None."""
    if path.startswith(QUIZ_API_PREFIXES) and not quiz_enabled():
        return "quiz"
    for key in hidden_sections():
        if path.startswith(MEMBER_SECTIONS[key][1]):
            return key
    return None
