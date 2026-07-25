"""Vues de progression pour le back-office admin (KPIs, stats par formation, avancement membres, reset)."""
from collections import defaultdict

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.db.models import Q, Avg

from apps.accounts.models import Role, User, UserStatus
from apps.content.models import Quiz, QuizResult, Formation
from apps.content.services import visible_formations_qs, formation_accessible
from apps.audit.models import AuditAction
from apps.audit.services import record

from .permissions import IsAdmin
from .serializers import (
    ProgressionKpisSerializer,
    FormationProgressStatSerializer,
    MemberProgressEntrySerializer,
)


def get_member_formation_progress(user, formation):
    """Avancement d'un membre sur une formation (calcul individuel).

    Conservé pour la compatibilité avec les appels ponctuels. Pour du batch,
    utiliser `bulk_compute_progress` — beaucoup plus rapide (1 query au total).
    """
    modules = list(formation.modules.prefetch_related('courses', 'children', 'courses__quiz'))
    modules_total = len(modules)
    if modules_total == 0:
        return {
            "modules_completed": 0,
            "modules_total": 0,
            "progress_pct": 0,
            "completed": False
        }

    quiz_ids = []
    for m in modules:
        for c in m.courses.all():
            if getattr(c, 'quiz', None) and c.quiz.active:
                quiz_ids.append(c.quiz.id)

    validated_quizzes = set(
        QuizResult.objects.filter(user=user, quiz_id__in=quiz_ids, validated=True)
        .values_list('quiz_id', flat=True)
    )

    def is_course_completed(course):
        quiz = getattr(course, 'quiz', None)
        if not quiz or not quiz.active:
            return True
        return quiz.id in validated_quizzes

    children_map = {}
    for m in modules:
        if m.parent_id:
            children_map.setdefault(m.parent_id, []).append(m)

    completed_cache = {}
    def is_module_completed(module):
        if module.id in completed_cache:
            return completed_cache[module.id]
        for c in module.courses.all():
            if not is_course_completed(c):
                completed_cache[module.id] = False
                return False
        for child in children_map.get(module.id, []):
            if not is_module_completed(child):
                completed_cache[module.id] = False
                return False
        completed_cache[module.id] = True
        return True

    modules_completed = sum(1 for m in modules if is_module_completed(m))
    progress_pct = int(round(modules_completed / modules_total * 100)) if modules_total > 0 else 0
    return {
        "modules_completed": modules_completed,
        "modules_total": modules_total,
        "progress_pct": progress_pct,
        "completed": progress_pct == 100
    }


# ─── Bulk helpers (O(1) DB queries, O(members × formations) Python) ──────────

def _prepare_formation_structs(formations):
    """Précalcule pour chaque formation la liste des modules + quiz par module.

    Retourne `{formation_id: {modules, children_map, quiz_ids_per_module,
                              modules_total, all_quiz_ids}}`.
    Charge tout en 2-3 requêtes globales via prefetch_related.
    """
    formation_ids = [f.id for f in formations]
    if not formation_ids:
        return {}

    formations_full = list(
        Formation.objects
        .filter(id__in=formation_ids)
        .prefetch_related('modules__courses__quiz', 'modules__children')
    )

    result = {}
    for f in formations_full:
        modules = list(f.modules.all())
        children_map = defaultdict(list)
        for m in modules:
            if m.parent_id:
                children_map[m.parent_id].append(m)

        quiz_ids_per_module = {}
        all_quiz_ids = []
        for m in modules:
            qids = []
            for c in m.courses.all():
                q = getattr(c, 'quiz', None)
                if q and q.active:
                    qids.append(q.id)
                    all_quiz_ids.append(q.id)
            quiz_ids_per_module[m.id] = qids

        result[f.id] = {
            "modules": modules,
            "children_map": children_map,
            "quiz_ids_per_module": quiz_ids_per_module,
            "modules_total": len(modules),
            "all_quiz_ids": all_quiz_ids,
        }
    return result


def bulk_compute_progress(members, formations):
    """Calcule la progression de N membres × M formations en 1 requête QuizResult.

    Retourne `{(user_id, formation_id): {modules_completed, modules_total,
                                          progress_pct, completed}}`.
    """
    structs = _prepare_formation_structs(formations)
    if not structs or not members:
        return {}

    all_quiz_ids = {qid for s in structs.values() for qid in s["all_quiz_ids"]}
    member_ids = [m.id for m in members]

    if all_quiz_ids and member_ids:
        validations = set(
            QuizResult.objects
            .filter(user_id__in=member_ids, quiz_id__in=all_quiz_ids, validated=True)
            .values_list('user_id', 'quiz_id')
        )
    else:
        validations = set()

    result = {}
    for member in members:
        for f_id, s in structs.items():
            modules_total = s["modules_total"]
            if modules_total == 0:
                result[(member.id, f_id)] = {
                    "modules_completed": 0,
                    "modules_total": 0,
                    "progress_pct": 0,
                    "completed": False,
                }
                continue

            cache = {}
            def _module_done(module):
                if module.id in cache:
                    return cache[module.id]
                for qid in s["quiz_ids_per_module"].get(module.id, []):
                    if (member.id, qid) not in validations:
                        cache[module.id] = False
                        return False
                for child in s["children_map"].get(module.id, []):
                    if not _module_done(child):
                        cache[module.id] = False
                        return False
                cache[module.id] = True
                return True

            modules_completed = sum(1 for m in s["modules"] if _module_done(m))
            progress_pct = int(round(modules_completed / modules_total * 100))
            result[(member.id, f_id)] = {
                "modules_completed": modules_completed,
                "modules_total": modules_total,
                "progress_pct": progress_pct,
                "completed": progress_pct == 100,
            }
    return result


class ProgressionKpisView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        members = list(User.objects.filter(role=Role.MEMBER).exclude(status=UserStatus.BLOQUE))
        formations = list(visible_formations_qs())

        progress_map = bulk_compute_progress(members, formations)

        total_enrollments = 0
        total_completions = 0
        progress_pcts = []

        for f in formations:
            for m in members:
                if formation_accessible(m, f):
                    total_enrollments += 1
                    prog = progress_map.get((m.id, f.id))
                    if prog is None:
                        continue
                    progress_pcts.append(prog["progress_pct"])
                    if prog["completed"]:
                        total_completions += 1

        avg_completion_rate = sum(progress_pcts) / len(progress_pcts) if progress_pcts else 0.0
        avg_score = QuizResult.objects.all().aggregate(avg=Avg('score'))['avg']

        data = {
            "total_enrollments": total_enrollments,
            "total_completions": total_completions,
            "avg_completion_rate": avg_completion_rate,
            "avg_quiz_score": float(avg_score) if avg_score is not None else None,
        }

        serializer = ProgressionKpisSerializer(data)
        return Response(serializer.data)


class FormationProgressStatView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        members = list(User.objects.filter(role=Role.MEMBER).exclude(status=UserStatus.BLOQUE))
        formations = list(visible_formations_qs())

        progress_map = bulk_compute_progress(members, formations)

        # Bulk fetch : avg score par formation
        avg_scores = {}
        for f in formations:
            quizzes = Quiz.objects.filter(Q(course__module__formation=f) | Q(formation=f))
            avg = QuizResult.objects.filter(quiz__in=quizzes).aggregate(avg=Avg('score'))['avg']
            avg_scores[f.id] = float(avg) if avg is not None else None

        from apps.content.services import generate_signed_url

        stats = []
        for f in formations:
            enrolled_count = 0
            completed_count = 0
            progress_pcts = []

            for m in members:
                if formation_accessible(m, f):
                    enrolled_count += 1
                    prog = progress_map.get((m.id, f.id))
                    if prog is None:
                        continue
                    progress_pcts.append(prog["progress_pct"])
                    if prog["completed"]:
                        completed_count += 1

            completion_rate = (completed_count / enrolled_count * 100.0) if enrolled_count > 0 else 0.0
            avg_progress_pct = (sum(progress_pcts) / len(progress_pcts)) if progress_pcts else 0.0

            cover = generate_signed_url(f.cover_key) if f.cover_key else f.cover_url

            stats.append({
                "formation_id": f.id,
                "formation_title": f.title,
                "cover_url": cover or None,
                "enrolled_count": enrolled_count,
                "completed_count": completed_count,
                "completion_rate": completion_rate,
                "avg_quiz_score": avg_scores.get(f.id),
                "avg_progress_pct": avg_progress_pct,
            })

        serializer = FormationProgressStatSerializer(stats, many=True)
        return Response(serializer.data)


class MemberProgressListView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        params = request.query_params

        members_qs = User.objects.filter(role=Role.MEMBER).exclude(status=UserStatus.BLOQUE)
        search = params.get("search")
        if search:
            members_qs = members_qs.filter(Q(full_name__icontains=search) | Q(email__icontains=search))

        members = list(members_qs)

        formations_qs = visible_formations_qs()
        formation_id = params.get("formation_id")
        if formation_id:
            formations_qs = formations_qs.filter(id=formation_id)

        formations = list(formations_qs)

        progress_map = bulk_compute_progress(members, formations)

        # Bulk fetch : examen final par formation + last activity + score
        final_exams = {q.formation_id: q for q in Quiz.objects.filter(formation__in=formations)}
        final_exam_ids = [q.id for q in final_exams.values()]
        member_ids = [m.id for m in members]

        # Scores examens finaux : {(user_id, quiz_id): score}
        final_scores = {}
        if final_exam_ids and member_ids:
            for r in QuizResult.objects.filter(user_id__in=member_ids, quiz_id__in=final_exam_ids):
                final_scores[(r.user_id, r.quiz_id)] = r.score

        # Last activity : dernier QuizResult par (user, formation)
        last_activity = {}
        for f in formations:
            quizzes_ids = list(
                Quiz.objects.filter(Q(course__module__formation=f) | Q(formation=f))
                .values_list('id', flat=True)
            )
            if not quizzes_ids or not member_ids:
                continue
            for r in (
                QuizResult.objects
                .filter(user_id__in=member_ids, quiz_id__in=quizzes_ids)
                .order_by('user_id', '-validated_at')
            ):
                key = (r.user_id, f.id)
                if key not in last_activity:
                    last_activity[key] = r.validated_at

        entries = []
        for f in formations:
            final_quiz = final_exams.get(f.id)
            for m in members:
                if not formation_accessible(m, f):
                    continue
                prog = progress_map.get((m.id, f.id))
                if prog is None:
                    continue

                quiz_score = None
                if final_quiz is not None:
                    quiz_score = final_scores.get((m.id, final_quiz.id))

                entries.append({
                    "user_id": m.id,
                    "user_name": m.full_name,
                    "user_email": m.email,
                    "formation_id": f.id,
                    "formation_title": f.title,
                    "progress_pct": prog["progress_pct"],
                    "modules_completed": prog["modules_completed"],
                    "modules_total": prog["modules_total"],
                    "quiz_score": float(quiz_score) if quiz_score is not None else None,
                    "last_activity": last_activity.get((m.id, f.id)),
                    "completed": prog["completed"],
                })

        completed_filter = params.get("completed")
        if completed_filter is not None:
            is_completed = completed_filter.lower() == 'true'
            entries = [e for e in entries if e["completed"] == is_completed]

        serializer = MemberProgressEntrySerializer(entries, many=True)
        return Response(serializer.data)


class ResetProgressView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request):
        user_id = request.data.get("user_id")
        formation_id = request.data.get("formation_id")
        reason = request.data.get("reason", "")

        if not user_id or not formation_id:
            return Response({"detail": "Champs user_id et formation_id requis."}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(id=user_id).first()
        formation = Formation.objects.filter(id=formation_id).first()
        if not user or not formation:
            return Response({"detail": "Membre ou formation introuvable."}, status=status.HTTP_404_NOT_FOUND)

        quizzes = Quiz.objects.filter(Q(course__module__formation=formation) | Q(formation=formation))
        deleted_count, _ = QuizResult.objects.filter(user=user, quiz__in=quizzes).delete()

        record(
            request.user,
            AuditAction.RESET_QUIZ,
            target_type="FormationProgress",
            target_id=f"{user.id}-{formation.id}",
            reason=reason,
            payload={"user_id": user.id, "formation_id": formation.id}
        )

        return Response({"detail": "Progression réinitialisée avec succès."})
