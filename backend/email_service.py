"""Email helper using Resend API. Reads settings from DB first, falls back to env."""
import os
import asyncio
import logging

logger = logging.getLogger("ajo.email")


def _wrap(title: str, body_html: str, cta_label: str = "", cta_link: str = "",
          brand: str = "Ajo Platform"):
    cta = ""
    if cta_label and cta_link:
        cta = f'<tr><td style="padding:24px 0"><a href="{cta_link}" style="background:#1E3F33;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:500">{cta_label}</a></td></tr>'
    return f"""<!doctype html>
<html><body style="background:#FDFBF7;font-family:Arial,Helvetica,sans-serif;color:#2C2B29;margin:0;padding:24px">
  <table align="center" cellpadding="0" cellspacing="0" width="560" style="background:#F4F1EA;border:1px solid rgba(44,43,41,0.1);border-radius:8px;padding:32px">
    <tr><td><div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-weight:700;color:#7B7A77">{brand}</div></td></tr>
    <tr><td><h1 style="font-size:24px;margin:8px 0 16px;color:#1E3F33">{title}</h1></td></tr>
    <tr><td style="font-size:14px;line-height:1.6">{body_html}</td></tr>
    {cta}
    <tr><td style="font-size:11px;color:#7B7A77;border-top:1px solid rgba(44,43,41,0.1);padding-top:16px;margin-top:24px">© {brand} · Community Finance, accounted for.</td></tr>
  </table>
</body></html>"""


async def send_email(db, to: str, subject: str, title: str, body_html: str,
                    cta_label: str = "", cta_link: str = "") -> bool:
    """Send an email via Resend. Uses DB settings (fallback env). Never raises."""
    if not to:
        return False
    settings = await db.settings.find_one({"key": "global"}, {"_id": 0}) or {}
    api_key = settings.get("resend_api_key") or os.environ.get("RESEND_API_KEY", "")
    sender = settings.get("resend_sender") or os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
    brand = settings.get("brand_name") or "Ajo Platform"
    if not api_key:
        logger.info(f"[email skipped - no key] {to} — {subject}")
        return False
    try:
        import resend
        resend.api_key = api_key
        params = {"from": sender, "to": [to], "subject": subject,
                  "html": _wrap(title, body_html, cta_label, cta_link, brand)}
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"[email sent] {to} — {subject} — id={result.get('id') if isinstance(result, dict) else result}")
        return True
    except Exception as e:
        logger.warning(f"[email failed] {to} — {subject} — {e}")
        return False
