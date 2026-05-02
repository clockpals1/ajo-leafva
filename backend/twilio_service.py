"""Twilio WhatsApp helper. Reads credentials from DB settings. Never raises."""
import asyncio
import logging

logger = logging.getLogger("ajo.whatsapp")


async def send_whatsapp(db, to_phone: str, body: str) -> bool:
    """Send a WhatsApp message via Twilio. to_phone is a raw phone number like +2348012345678."""
    if not to_phone:
        return False
    settings = await db.settings.find_one({"key": "global"}, {"_id": 0}) or {}
    sid = settings.get("twilio_account_sid", "")
    token = settings.get("twilio_auth_token", "")
    wa_from = settings.get("twilio_whatsapp_from", "")  # e.g. whatsapp:+14155238886
    if not sid or not token or not wa_from:
        logger.info(f"[whatsapp skipped - no creds] {to_phone}")
        return False
    try:
        from twilio.rest import Client
        client = Client(sid, token)
        clean = to_phone.strip()
        if not clean.startswith("whatsapp:"):
            clean = f"whatsapp:{clean if clean.startswith('+') else '+' + clean}"
        msg = await asyncio.to_thread(
            lambda: client.messages.create(from_=wa_from, to=clean, body=body)
        )
        logger.info(f"[whatsapp sent] {to_phone} — sid={msg.sid}")
        return True
    except Exception as e:
        logger.warning(f"[whatsapp failed] {to_phone} — {e}")
        return False
