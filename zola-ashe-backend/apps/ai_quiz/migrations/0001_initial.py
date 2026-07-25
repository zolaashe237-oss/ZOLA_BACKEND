import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("content", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AIQuizJob",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("PENDING", "En attente"),
                            ("IN_PROGRESS", "En cours"),
                            ("DONE", "Terminé"),
                            ("FAILED", "Échec"),
                        ],
                        default="PENDING",
                        max_length=16,
                    ),
                ),
                (
                    "source_type",
                    models.CharField(
                        choices=[
                            ("VIDEO_YOUTUBE", "Vidéo YouTube (captions)"),
                            ("PDF", "Document PDF"),
                            ("MANUAL_TEXT", "Texte saisi manuellement"),
                        ],
                        max_length=16,
                    ),
                ),
                ("source_ref", models.CharField(blank=True, max_length=500)),
                ("source_text", models.TextField(blank=True)),
                ("config", models.JSONField(default=dict)),
                ("raw_ai_output", models.JSONField(blank=True, default=dict)),
                (
                    "suggested_level",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("FACILE", "Facile"),
                            ("INTERMEDIAIRE", "Intermédiaire"),
                            ("DIFFICILE", "Difficile"),
                        ],
                        max_length=16,
                    ),
                ),
                (
                    "suggested_rank",
                    models.PositiveIntegerField(blank=True, null=True),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("error_message", models.TextField(blank=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="ai_quiz_jobs",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "module",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ai_quiz_jobs",
                        to="content.module",
                    ),
                ),
                (
                    "resulting_quiz",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to="content.quiz",
                    ),
                ),
            ],
            options={
                "db_table": "ai_quiz_jobs",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="AIQuestion",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "kind",
                    models.CharField(
                        choices=[
                            ("QCM", "Question à choix multiple"),
                            ("QRO", "Question à réponse ouverte"),
                        ],
                        max_length=8,
                    ),
                ),
                ("text", models.TextField()),
                ("order", models.PositiveIntegerField(default=0)),
                ("choices", models.JSONField(blank=True, default=list)),
                (
                    "correct_index",
                    models.PositiveSmallIntegerField(blank=True, null=True),
                ),
                ("criteria", models.JSONField(blank=True, default=list)),
                ("is_published", models.BooleanField(default=False)),
                ("edited_by_admin", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "job",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="questions",
                        to="ai_quiz.aiquizjob",
                    ),
                ),
            ],
            options={
                "db_table": "ai_quiz_questions",
                "ordering": ["job_id", "order", "id"],
            },
        ),
        migrations.CreateModel(
            name="AIQROAnswer",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("answer_text", models.TextField()),
                (
                    "verdict",
                    models.CharField(
                        choices=[
                            ("VALIDATED", "Validé"),
                            ("REJECTED", "Non validé"),
                            ("NEEDS_REVIEW", "À revoir manuellement"),
                        ],
                        default="NEEDS_REVIEW",
                        max_length=16,
                    ),
                ),
                ("score", models.PositiveSmallIntegerField(default=0)),
                ("justification", models.TextField(blank=True)),
                ("submitted_at", models.DateTimeField(auto_now_add=True)),
                ("ai_evaluated_at", models.DateTimeField(blank=True, null=True)),
                (
                    "admin_decision",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("VALIDATED", "Validé"),
                            ("REJECTED", "Non validé"),
                            ("NEEDS_REVIEW", "À revoir manuellement"),
                        ],
                        max_length=16,
                    ),
                ),
                ("admin_decided_at", models.DateTimeField(blank=True, null=True)),
                ("admin_note", models.TextField(blank=True)),
                (
                    "admin_decided_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="qro_decisions_made",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "question",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="qro_answers",
                        to="ai_quiz.aiquestion",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ai_qro_answers",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "ai_qro_answers",
                "ordering": ["-submitted_at"],
            },
        ),
        migrations.AddIndex(
            model_name="aiquizjob",
            index=models.Index(fields=["status"], name="ai_quiz_job_status_idx"),
        ),
        migrations.AddIndex(
            model_name="aiquizjob",
            index=models.Index(
                fields=["module", "-created_at"], name="ai_quiz_job_mod_cre_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="aiquestion",
            index=models.Index(fields=["job", "kind"], name="ai_quiz_q_job_kind_idx"),
        ),
        migrations.AddIndex(
            model_name="aiqroanswer",
            index=models.Index(fields=["verdict"], name="ai_qro_ans_verdict_idx"),
        ),
        migrations.AddIndex(
            model_name="aiqroanswer",
            index=models.Index(
                fields=["user", "-submitted_at"], name="ai_qro_ans_user_sub_idx"
            ),
        ),
    ]
