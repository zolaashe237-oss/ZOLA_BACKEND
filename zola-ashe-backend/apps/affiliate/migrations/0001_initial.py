from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AffiliateConfig",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ("commission_amount", models.PositiveIntegerField(default=2000, help_text="Commission versée au parrain par filleul validé (FCFA).")),
                ("min_withdrawal", models.PositiveIntegerField(default=5000, help_text="Solde minimum pour demander un retrait (FCFA).")),
                ("whatsapp_number", models.CharField(blank=True, default="", help_text="Numéro WhatsApp admin (ex: +237600000000) pour les retraits.", max_length=30)),
                ("is_active", models.BooleanField(default=True, help_text="Activer/désactiver le programme d'affiliation.")),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": "affiliate_config", "verbose_name": "Configuration affiliation"},
        ),
        migrations.CreateModel(
            name="Referral",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ("commission", models.PositiveIntegerField(default=0, help_text="Commission en FCFA (0 tant que PENDING, fixée à la validation).")),
                ("status", models.CharField(
                    choices=[("PENDING", "En attente (filleul non abonné)"), ("VALIDATED", "Validé (commission due)"), ("PAID", "Payé")],
                    db_index=True, default="PENDING", max_length=12)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("validated_at", models.DateTimeField(blank=True, null=True)),
                ("paid_at", models.DateTimeField(blank=True, null=True)),
                ("referrer", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="referrals_given",
                    to=settings.AUTH_USER_MODEL,
                    verbose_name="Parrain")),
                ("referred", models.OneToOneField(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="referral_from",
                    to=settings.AUTH_USER_MODEL,
                    verbose_name="Filleul")),
            ],
            options={"db_table": "referrals", "verbose_name": "Parrainage"},
        ),
        migrations.AddIndex(
            model_name="referral",
            index=models.Index(fields=["referrer", "status"], name="referrals_referr_idx"),
        ),
    ]
