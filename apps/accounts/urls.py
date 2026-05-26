"""Routes d'authentification et de profil (montées sous /api/)."""
from django.urls import path

from . import views

urlpatterns = [
    # Authentification — /api/auth/...
    path("auth/register/", views.RegisterView.as_view(), name="register"),
    path("auth/verify-otp/", views.VerifyOTPView.as_view(), name="verify-otp"),
    path("auth/resend-otp/", views.ResendOTPView.as_view(), name="resend-otp"),
    path("auth/login/", views.LoginView.as_view(), name="login"),
    path("auth/refresh/", views.CookieTokenRefreshView.as_view(), name="refresh"),
    path("auth/logout/", views.LogoutView.as_view(), name="logout"),
    path("auth/password/forgot/", views.PasswordForgotView.as_view(), name="password-forgot"),
    path("auth/password/reset/", views.PasswordResetView.as_view(), name="password-reset"),
    path("auth/password/change/", views.PasswordChangeView.as_view(), name="password-change"),

    # Profil — /api/me/
    path("me/", views.MeView.as_view(), name="me"),
]
