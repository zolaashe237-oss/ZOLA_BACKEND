"""Serializers de l'authentification et du profil (CDC §3.3)."""
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import User, UserStatus


class UserSerializer(serializers.ModelSerializer):
    """Représentation publique d'un membre (profil « moi »)."""
    class Meta:
        model = User
        fields = ("id", "email", "full_name", "photo", "role", "status",
                  "email_verified", "nb_warnings", "created_at")
        read_only_fields = ("id", "email", "role", "status", "email_verified",
                            "nb_warnings", "created_at")


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True)
    password2 = serializers.CharField(write_only=True)

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Un compte existe déjà avec cet email.")
        return value.lower()

    def validate(self, attrs):
        if attrs["password"] != attrs["password2"]:
            raise serializers.ValidationError({"password2": "Les mots de passe ne correspondent pas."})
        validate_password(attrs["password"])
        return attrs

    def create(self, validated_data):
        # Statut RESTREINT par défaut (modèle), email non vérifié → OTP requis.
        return User.objects.create_user(
            email=validated_data["email"],
            password=validated_data["password"],
            full_name=validated_data["full_name"],
            status=UserStatus.RESTREINT,
        )


class VerifyOTPSerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField(min_length=6, max_length=6)


class ResendOTPSerializer(serializers.Serializer):
    email = serializers.EmailField()


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class PasswordForgotSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetSerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField(min_length=6, max_length=6)
    new_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        validate_password(value)
        return value


class PasswordChangeSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        validate_password(value)
        return value


class DeleteAccountSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True, help_text="Mot de passe actuel (confirmation).")
    reason = serializers.CharField(required=False, allow_blank=True,
                                   help_text="Motif facultatif de la suppression.")
