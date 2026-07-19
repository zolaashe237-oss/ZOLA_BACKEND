"""Utilisateurs, statuts et vérification OTP (CDC Partie I glossaire, §3.3, §4.1)."""
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


class UserStatus(models.TextChoices):
    ACTIF = "ACTIF", "Actif"
    RESTREINT = "RESTREINT", "Restreint"
    BLOQUE = "BLOQUE", "Bloqué"


class Role(models.TextChoices):
    MEMBER = "MEMBER", "Membre"
    ADMIN = "ADMIN", "Administrateur"


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError("L'adresse email est obligatoire.")
        user = self.model(email=self.normalize_email(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("role", Role.ADMIN)
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("status", UserStatus.ACTIF)
        extra.setdefault("email_verified", True)
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    """Membre ou administrateur de la plateforme."""
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=150)
    photo = models.ImageField(upload_to="avatars/", blank=True, null=True)

    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    status = models.CharField(max_length=10, choices=UserStatus.choices, default=UserStatus.RESTREINT)
    status_changed_at = models.DateTimeField(default=timezone.now)

    email_verified = models.BooleanField(default=False)
    nb_warnings = models.PositiveIntegerField(default=0)  # modération (RG-32)

    is_staff = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    class Meta:
        db_table = "users"

    def __str__(self):
        return self.email

    def set_status(self, status: str):
        self.status = status
        self.status_changed_at = timezone.now()
        self.save(update_fields=["status", "status_changed_at"])


class WhatsAppTemplate(models.Model):
    """Template WhatsApp approuvé par Meta, stocké en base pour modification sans déploiement.

    Chaque template est identifié par son Content SID (ex. HXb5b32575a...) et sa
    locale (ex. ``fr``, ``en``). Le champ ``variables`` liste les noms des variables
    attendues par le template (``{{1}}``, ``{{2}}``… nommées pour la documentation).
    """

    name = models.CharField(max_length=100, unique=True, help_text="Nom logique du template (ex. 'otp_verification')")
    content_sid = models.CharField(max_length=100, help_text="Content SID Meta/Twilio (ex. HXb5b32575a...)")
    locale = models.CharField(max_length=10, default="fr", help_text="Code langue Meta (fr, en, …)")
    variables = models.JSONField(default=list, blank=True,
                                  help_text='Liste des noms de variables, p.ex. ["code", "prenom"]')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "whatsapp_templates"
        verbose_name = "Template WhatsApp"
        verbose_name_plural = "Templates WhatsApp"

    def __str__(self):
        return f"{self.name} ({self.content_sid})"


class EmailOTP(models.Model):
    """Code OTP de vérification email — 6 chiffres, 15 min, 3 tentatives (CDC §3.3)."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="otps")
    code_hash = models.CharField(max_length=128)   # stocké hashé (CDC §7.1)
    attempts = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField()
    consumed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "email_otps"

    def is_valid(self) -> bool:
        return not self.consumed and timezone.now() < self.expires_at
