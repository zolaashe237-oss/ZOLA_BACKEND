import logging

logger = logging.getLogger("notifications")

def send_whatsapp_message(phone_number: str, message: str) -> bool:
    """
    Envoie un message WhatsApp via un provider externe.
    (Implémentation factice pour le moment, à remplacer par l'API Twilio ou Evolution API).
    """
    if not phone_number:
        logger.warning("Tentative d'envoi WhatsApp sans numéro de téléphone.")
        return False
        
    # TODO: Intégrer l'API HTTP du fournisseur choisi ici.
    logger.info("Message WhatsApp simulé pour %s : %s", phone_number, message)
    return True
