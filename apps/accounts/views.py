"""Vues d'authentification et de profil (CDC §3.3, §7.1).

Stratégie tokens : l'access JWT est renvoyé dans le corps (gardé en mémoire côté
front), le refresh est posé dans un cookie HttpOnly — invisible au JavaScript,
donc protégé du XSS. Le refresh tourne à chaque rafraîchissement (rotation +
blacklist via SimpleJWT).
"""
from django.conf import settings
from django.contrib.auth import authenticate
from drf_spectacular.utils import OpenApiResponse, extend_schema, extend_schema_view, inline_serializer
from rest_framework import generics, serializers as drf_serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from .models import User, UserStatus
from .serializers import (
    DeleteAccountSerializer,
    LoginSerializer,
    PasswordChangeSerializer,
    PasswordForgotSerializer,
    PasswordResetSerializer,
    RegisterSerializer,
    ResendOTPSerializer,
    UserSerializer,
    VerifyOTPSerializer,
)
from .services import (
    anonymize_account,
    generate_otp,
    is_locked,
    register_failed_login,
    reset_login_attempts,
    verify_otp,
)
from .tasks import send_otp_email

REFRESH_COOKIE = "refresh_token"
REFRESH_COOKIE_PATH = "/api/auth/"

# Réponses réutilisables pour la doc Swagger.
_DetailResponse = inline_serializer(
    name="DetailMessage", fields={"detail": drf_serializers.CharField()})
_OtpInitResponse = inline_serializer(
    name="OtpInitResponse",
    fields={"detail": drf_serializers.CharField(),
            "dev_code": drf_serializers.CharField(
                required=False, help_text="Code OTP exposé UNIQUEMENT en mode démo (EMAIL_MOCK).")})
_LoginResponse = inline_serializer(
    name="LoginResponse",
    fields={"access": drf_serializers.CharField(help_text="JWT d'accès (à mettre en Bearer)."),
            "user": UserSerializer()})
_AccessResponse = inline_serializer(
    name="AccessResponse", fields={"access": drf_serializers.CharField()})


def _set_refresh_cookie(response: Response, refresh: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        refresh,
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        httponly=True,                 # inaccessible au JS (anti-XSS)
        secure=not settings.DEBUG,     # HTTPS only en prod
        samesite="Lax",               # api/app partagent le même site
        path=REFRESH_COOKIE_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH)


def _issue_tokens(user: User) -> tuple[str, str]:
    """Retourne (access, refresh). Session admin raccourcie à 4h (CDC §5.1)."""
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    if user.role == "ADMIN":
        access.set_exp(lifetime=settings.ADMIN_ACCESS_TOKEN_LIFETIME)
    return str(access), str(refresh)


class _AuthThrottle(ScopedRateThrottle):
    scope = "auth"


@extend_schema(
    tags=["Authentification"],
    summary="Inscription d'un membre",
    description=(
        "Crée un compte au statut **RESTREINT** (email non vérifié) puis envoie un code OTP "
        "d'activation par email.\n\nEn mode démo (`EMAIL_MOCK`, aucune clé Brevo), le code est "
        "renvoyé dans `dev_code` pour permettre de tester sans boîte mail. Anti-abus : throttle `auth`."
    ),
    responses={201: OpenApiResponse(_OtpInitResponse, description="Compte créé, OTP envoyé.")},
)
class RegisterView(generics.GenericAPIView):
    """Inscription → crée le compte (RESTREINT) puis envoie un OTP d'activation."""
    permission_classes = [AllowAny]
    throttle_classes = [_AuthThrottle]
    serializer_class = RegisterSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        code = generate_otp(user)
        send_otp_email.delay(user.email, code, "verification")
        body = {"detail": "Compte créé. Un code de vérification a été envoyé par email."}
        if settings.EMAIL_MOCK:   # dev/local : pas d'email réel → on expose le code
            body["dev_code"] = code
        return Response(body, status=status.HTTP_201_CREATED)


@extend_schema(
    tags=["Authentification"],
    summary="Vérifier l'OTP (activer l'email)",
    description="Valide le code OTP reçu et marque l'email du compte comme vérifié, "
                "autorisant ensuite la connexion.",
    responses={200: OpenApiResponse(_DetailResponse, description="Email vérifié."),
               400: OpenApiResponse(_DetailResponse, description="Code invalide ou expiré."),
               404: OpenApiResponse(_DetailResponse, description="Compte introuvable.")},
)
class VerifyOTPView(generics.GenericAPIView):
    """Valide l'OTP et active l'email du compte."""
    permission_classes = [AllowAny]
    throttle_classes = [_AuthThrottle]
    serializer_class = VerifyOTPSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.filter(email__iexact=serializer.validated_data["email"]).first()
        if user is None:
            return Response({"detail": "Compte introuvable."}, status=status.HTTP_404_NOT_FOUND)

        ok, message = verify_otp(user, serializer.validated_data["code"])
        if not ok:
            return Response({"detail": message}, status=status.HTTP_400_BAD_REQUEST)

        if not user.email_verified:
            user.email_verified = True
            user.save(update_fields=["email_verified"])
        return Response({"detail": "Email vérifié. Vous pouvez vous connecter."})


@extend_schema(
    tags=["Authentification"],
    summary="Renvoyer un OTP de vérification",
    description="Renvoie un nouveau code de vérification si un compte non vérifié existe. "
                "Réponse volontairement neutre (pas d'énumération d'emails). `dev_code` en mode démo.",
    responses={200: OpenApiResponse(_OtpInitResponse, description="Réponse neutre.")},
)
class ResendOTPView(generics.GenericAPIView):
    permission_classes = [AllowAny]
    throttle_classes = [_AuthThrottle]
    serializer_class = ResendOTPSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.filter(email__iexact=serializer.validated_data["email"]).first()
        code = None
        if user and not user.email_verified:
            code = generate_otp(user)
            send_otp_email.delay(user.email, code, "verification")
        # Réponse neutre : ne révèle pas l'existence du compte.
        body = {"detail": "Si un compte non vérifié existe, un code a été renvoyé."}
        if settings.EMAIL_MOCK and code:
            body["dev_code"] = code
        return Response(body)


@extend_schema(
    tags=["Authentification"],
    summary="Connexion",
    description=(
        "Authentifie le membre et émet les tokens. L'`access` est dans le corps ; le `refresh` est "
        "posé en **cookie HttpOnly** (`refresh_token`).\n\nProtections : anti-brute-force (5 essais / "
        "15 min → 429), email non vérifié → 403, compte bloqué → 403."
    ),
    responses={200: OpenApiResponse(_LoginResponse, description="Connecté, tokens émis."),
               401: OpenApiResponse(_DetailResponse, description="Identifiants invalides."),
               403: OpenApiResponse(_DetailResponse, description="Email non vérifié ou compte bloqué."),
               429: OpenApiResponse(_DetailResponse, description="Trop de tentatives.")},
)
class LoginView(generics.GenericAPIView):
    """Connexion : anti-brute-force (5 essais / 15 min) puis émission des tokens."""
    permission_classes = [AllowAny]
    throttle_classes = [_AuthThrottle]
    serializer_class = LoginSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].lower()
        password = serializer.validated_data["password"]

        if is_locked(email):
            return Response(
                {"detail": "Trop de tentatives. Réessayez dans quelques minutes."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        user = authenticate(request, username=email, password=password)
        if user is None:
            register_failed_login(email)
            return Response({"detail": "Identifiants invalides."},
                            status=status.HTTP_401_UNAUTHORIZED)
        if not user.email_verified:
            return Response({"detail": "Veuillez d'abord vérifier votre email."},
                            status=status.HTTP_403_FORBIDDEN)
        if user.status == UserStatus.BLOQUE:
            return Response({"detail": "Compte bloqué. Contactez l'administration."},
                            status=status.HTTP_403_FORBIDDEN)

        reset_login_attempts(email)
        access, refresh = _issue_tokens(user)
        response = Response({"access": access, "user": UserSerializer(user).data})
        _set_refresh_cookie(response, refresh)
        return response


@extend_schema(
    tags=["Authentification"],
    summary="Rafraîchir l'access (via cookie)",
    description="Lit le `refresh_token` dans le cookie HttpOnly et renvoie un nouvel `access`. "
                "Le refresh tourne (rotation + blacklist) et le cookie est reposé. Aucun corps requis.",
    request=None,
    responses={200: OpenApiResponse(_AccessResponse, description="Nouvel access."),
               401: OpenApiResponse(_DetailResponse, description="Refresh absent ou session expirée.")},
)
class CookieTokenRefreshView(TokenRefreshView):
    """Rafraîchit l'access en lisant le refresh dans le cookie HttpOnly."""
    permission_classes = [AllowAny]
    throttle_classes = [_AuthThrottle]

    def post(self, request, *args, **kwargs):
        refresh = request.COOKIES.get(REFRESH_COOKIE)
        if not refresh:
            return Response({"detail": "Refresh token absent."},
                            status=status.HTTP_401_UNAUTHORIZED)
        serializer = self.get_serializer(data={"refresh": refresh})
        try:
            serializer.is_valid(raise_exception=True)
        except (TokenError, InvalidToken):
            response = Response({"detail": "Session expirée."},
                                status=status.HTTP_401_UNAUTHORIZED)
            _clear_refresh_cookie(response)
            return response

        data = serializer.validated_data
        response = Response({"access": data["access"]})
        # ROTATE_REFRESH_TOKENS=True → un nouveau refresh est renvoyé : on le repose.
        if "refresh" in data:
            _set_refresh_cookie(response, data["refresh"])
        return response


@extend_schema(
    tags=["Authentification"],
    summary="Déconnexion",
    description="Blackliste le refresh courant et efface le cookie. Nécessite d'être authentifié.",
    request=None,
    responses={200: OpenApiResponse(_DetailResponse, description="Déconnecté.")},
)
class LogoutView(APIView):
    """Déconnexion : blackliste le refresh courant et efface le cookie."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        refresh = request.COOKIES.get(REFRESH_COOKIE)
        if refresh:
            try:
                RefreshToken(refresh).blacklist()
            except TokenError:
                pass
        response = Response({"detail": "Déconnecté."})
        _clear_refresh_cookie(response)
        return response


@extend_schema(
    tags=["Authentification"],
    summary="Mot de passe oublié",
    description="Envoie un code OTP de réinitialisation si un compte existe (réponse neutre). "
                "`dev_code` exposé en mode démo.",
    responses={200: OpenApiResponse(_OtpInitResponse, description="Réponse neutre.")},
)
class PasswordForgotView(generics.GenericAPIView):
    permission_classes = [AllowAny]
    throttle_classes = [_AuthThrottle]
    serializer_class = PasswordForgotSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.filter(email__iexact=serializer.validated_data["email"]).first()
        code = None
        if user:
            code = generate_otp(user)
            send_otp_email.delay(user.email, code, "reset")
        # Réponse neutre (pas d'énumération d'emails).
        body = {"detail": "Si un compte existe, un code de réinitialisation a été envoyé."}
        if settings.EMAIL_MOCK and code:
            body["dev_code"] = code
        return Response(body)


@extend_schema(
    tags=["Authentification"],
    summary="Réinitialiser le mot de passe (OTP)",
    description="Vérifie le code OTP de réinitialisation et définit le nouveau mot de passe.",
    responses={200: OpenApiResponse(_DetailResponse, description="Mot de passe réinitialisé."),
               400: OpenApiResponse(_DetailResponse, description="Code invalide."),
               404: OpenApiResponse(_DetailResponse, description="Compte introuvable.")},
)
class PasswordResetView(generics.GenericAPIView):
    permission_classes = [AllowAny]
    throttle_classes = [_AuthThrottle]
    serializer_class = PasswordResetSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.filter(email__iexact=serializer.validated_data["email"]).first()
        if user is None:
            return Response({"detail": "Compte introuvable."}, status=status.HTTP_404_NOT_FOUND)

        ok, message = verify_otp(user, serializer.validated_data["code"])
        if not ok:
            return Response({"detail": message}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        return Response({"detail": "Mot de passe réinitialisé."})


@extend_schema(
    tags=["Authentification"],
    summary="Changer son mot de passe",
    description="Modifie le mot de passe du membre connecté (l'ancien mot de passe est requis).",
    responses={200: OpenApiResponse(_DetailResponse, description="Mot de passe modifié."),
               400: OpenApiResponse(_DetailResponse, description="Ancien mot de passe incorrect.")},
)
class PasswordChangeView(generics.GenericAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = PasswordChangeSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not request.user.check_password(serializer.validated_data["old_password"]):
            return Response({"detail": "Ancien mot de passe incorrect."},
                            status=status.HTTP_400_BAD_REQUEST)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        return Response({"detail": "Mot de passe modifié."})


@extend_schema_view(
    get=extend_schema(tags=["Profil"], summary="Mon profil",
                      description="Renvoie le profil du membre connecté."),
    put=extend_schema(tags=["Profil"], summary="Remplacer mon profil"),
    patch=extend_schema(tags=["Profil"], summary="Mettre à jour mon profil",
                        description="Met à jour les champs modifiables (ex. nom complet)."),
    delete=extend_schema(
        tags=["Profil"], summary="Supprimer mon compte (RGPD)",
        description="**Droit à l'effacement** (RGPD art. 17). Anonymise irréversiblement le compte : "
                    "e-mail, nom, photo et mot de passe sont effacés, le compte est désactivé, "
                    "l'adhésion clôturée et les publications/commentaires masqués. Les **paiements "
                    "sont conservés** (obligation comptable), dépersonnalisés. Confirmation par "
                    "**mot de passe** requise ; les sessions sont révoquées. Opération journalisée.",
        request=DeleteAccountSerializer,
        responses={200: _DetailResponse,
                   400: OpenApiResponse(_DetailResponse, description="Mot de passe incorrect ou manquant.")}),
)
class MeView(generics.RetrieveUpdateDestroyAPIView):
    """Profil du membre connecté (GET / PATCH) + suppression RGPD (DELETE)."""
    permission_classes = [IsAuthenticated]
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user

    def destroy(self, request, *args, **kwargs):
        """Suppression RGPD : confirmation par mot de passe, anonymisation, révocation."""
        serializer = DeleteAccountSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data["password"]):
            return Response({"detail": "Mot de passe incorrect."}, status=status.HTTP_400_BAD_REQUEST)

        # Révoque tous les refresh tokens encore valides (déconnexion partout).
        try:
            from rest_framework_simplejwt.token_blacklist.models import (
                BlacklistedToken, OutstandingToken)
            for token in OutstandingToken.objects.filter(user=user):
                BlacklistedToken.objects.get_or_create(token=token)
        except Exception:
            pass

        anonymize_account(user, reason=serializer.validated_data.get("reason", ""))
        response = Response({"detail": "Votre compte a été supprimé."})
        _clear_refresh_cookie(response)
        return response
