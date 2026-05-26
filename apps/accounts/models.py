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
