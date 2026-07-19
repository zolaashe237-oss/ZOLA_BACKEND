from rest_framework import serializers

from .models import MemoirDraft


class MemoirDraftSerializer(serializers.ModelSerializer):
    class Meta:
        model = MemoirDraft
        fields = ["answers", "status", "updated_at", "submitted_at"]
        read_only_fields = ["status", "updated_at", "submitted_at"]

    def validate_answers(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("answers doit être un objet JSON.")
        return value
