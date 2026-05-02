"""Email helper using Resend API. Non-blocking via asyncio.to_thread."""
import os
import asyncio
import logging

logger = logging.getLogger("ajo.email")

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")

_resend = None
if RESEND_API_KEY:
    try:
        import resend as _resend_mod
        _resend_mod.api_key = RESEND_API_KEY
        _resend = _resend_mod
    except Exception as e:
        logger.warning(f"Resend init failed: {e}")


def _wrap(title: str, body_html: str, cta_label: str = "", cta_link: str = ""):
    cta = ""
    if cta_label and cta_link:
        cta = f'<tr><td style="padding:24px 0"><a href="{cta_link}" style="background:#1E3F33;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:500">{cta_label}</a></td></tr>'
    return f"""<!doctype html>
<html><body style="background:#FDFBF7;font-family:Arial,Helvetica,sans-serif;color:#2C2B29;margin:0;padding:24px">
  <table align="center" cellpadding="0" cellspacing="0" width="560" style="background:#F4F1EA;border:1px solid rgba(44,43,41,0.1);border-radius:8px;padding:32px">
    <tr><td><div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-weight:700;color:#7B7A77">Ajo Platform</div></td></tr>
    <tr><td><h1 style="font-size:24px;margin:8px 0 16px;color:#1E3F33">{title}</h1></td></tr>
    <tr><td style="font-size:14px;line-height:1.6">{body_html}</td></tr>
    {cta}
    <tr><td style="font-size:11px;color:#7B7A77;border-top:1px solid rgba(44,43,41,0.1);padding-top:16px;margin-top:24px">© Ajo Platform · Community Finance, accounted for.</td></tr>
  </table>
</body></html>"""


async def send_email(to: str, subject: str, title: str, body_html: str,
                    cta_label: str = "", cta_link: str = "") -> bool:
    """Send an email via Resend. Non-blocking. Logs failures, never raises."""
    if not _resend or not to:
        logger.info(f"[email skipped] {to} — {subject}")
        return False
    try:
        params = {
            "from": SENDER_EMAIL,
            "to": [to],
            "subject": subject,
            "html": _wrap(title, body_html, cta_label, cta_link),
        }
        result = await asyncio.to_thread(_resend.Emails.send, params)
        logger.info(f"[email sent] {to} — {subject} — id={result.get('id') if isinstance(result, dict) else result}")
        return True
    except Exception as e:
        logger.warning(f"[email failed] {to} — {subject} — {e}")
        return False
