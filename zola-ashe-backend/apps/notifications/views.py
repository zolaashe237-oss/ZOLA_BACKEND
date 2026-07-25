from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification
from .serializers import NotificationSerializer


class NotificationsListView(APIView):
    """Liste les 30 dernières notifications du membre connecté + compteur non-lus."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = Notification.objects.filter(user=request.user)[:30]
        unread_count = Notification.objects.filter(user=request.user, read=False).count()
        return Response({
            "unread_count": unread_count,
            "results": NotificationSerializer(qs, many=True).data,
        })


class MarkNotifReadView(APIView):
    """Marque une notification comme lue."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        Notification.objects.filter(user=request.user, pk=pk).update(read=True)
        return Response({"read": True})


class MarkAllReadView(APIView):
    """Marque toutes les notifications comme lues."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        Notification.objects.filter(user=request.user, read=False).update(read=True)
        return Response({"read_all": True})
