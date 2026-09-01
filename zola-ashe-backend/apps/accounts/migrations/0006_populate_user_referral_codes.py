import secrets
from django.db import migrations

def populate_referral_codes(apps, schema_editor):
    User = apps.get_model('accounts', 'User')
    for user in User.objects.all().order_by('id'):
        if not user.referral_code:
            code = f"ZA{user.id:04d}"
            if User.objects.filter(referral_code=code).exclude(id=user.id).exists():
                code = f"ZA{user.id:04d}{secrets.token_hex(2).upper()}"
            user.referral_code = code
            user.save(update_fields=['referral_code'])

class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0005_alter_user_referral_code'),
    ]

    operations = [
        migrations.RunPython(populate_referral_codes, reverse_code=migrations.RunPython.noop),
    ]
