"""Email helper — tries SMTP first (Hostinger/cPanel/any SMTP), falls back to Resend API.
   Configuration is read from DB settings (set via admin panel), then env vars.
   Never raises — returns (bool, error_message)."""
import os
import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

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


def _smtp_send_sync(host: str, port: int, user: str, password: str,
                    from_addr: str, to: str, subject: str, html: str, secure: bool):
    """Blocking SMTP send — run via asyncio.to_thread."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to
    msg.attach(MIMEText(html, "html"))
    if secure:
        with smtplib.SMTP_SSL(host, port, timeout=15) as srv:
            srv.login(user, password)
            srv.sendmail(from_addr, [to], msg.as_string())
    else:
        with smtplib.SMTP(host, port, timeout=15) as srv:
            srv.ehlo()
            srv.starttls()
            srv.ehlo()
            srv.login(user, password)
            srv.sendmail(from_addr, [to], msg.as_string())


async def send_email(db, to: str, subject: str, title: str, body_html: str,
                     cta_label: str = "", cta_link: str = "") -> bool:
    """Send email. SMTP first (if configured), then Resend fallback. Never raises."""
    ok, _ = await _send_email_inner(db, to, subject, title, body_html, cta_label, cta_link)
    return ok


async def send_email_with_error(db, to: str, subject: str, title: str, body_html: str,
                                cta_label: str = "", cta_link: str = ""):
    """Like send_email but returns (bool, error_str | None). Used by test-email endpoint."""
    return await _send_email_inner(db, to, subject, title, body_html, cta_label, cta_link)


async def _send_email_inner(db, to: str, subject: str, title: str, body_html: str,
                            cta_label: str = "", cta_link: str = ""):
    """Internal implementation — returns (bool, last_error_str | None)."""
    if not to:
        return False, "No recipient address"
    settings = await db.settings.find_one({"key": "global"}, {"_id": 0}) or {}
    brand = settings.get("brand_name") or "Ajo Platform"
    html = _wrap(title, body_html, cta_label, cta_link, brand)
    last_error = None

    # ── 1. Try SMTP (Hostinger / cPanel / any SMTP) ──────────────────────────
    smtp_host = settings.get("smtp_host") or os.environ.get("SMTP_HOST", "")
    smtp_user = settings.get("smtp_user") or os.environ.get("SMTP_USER", "")
    smtp_pw   = settings.get("smtp_password") or os.environ.get("SMTP_PASSWORD", "")
    if smtp_host and smtp_user and smtp_pw:
        smtp_port   = int(settings.get("smtp_port") or os.environ.get("SMTP_PORT", 587))
        smtp_from   = settings.get("smtp_from") or smtp_user
        smtp_secure = bool(settings.get("smtp_secure", False))
        try:
            await asyncio.to_thread(
                _smtp_send_sync, smtp_host, smtp_port, smtp_user, smtp_pw,
                smtp_from, to, subject, html, smtp_secure
            )
            logger.info(f"[smtp sent] {to} — {subject}")
            return True, None
        except Exception as e:
            last_error = f"SMTP error: {e}"
            logger.warning(f"[smtp failed, trying Resend] {to} — {e}")

    # ── 2. Fallback: Resend API (uses native async send_async) ────────────────
    api_key = settings.get("resend_api_key") or os.environ.get("RESEND_API_KEY", "")
    sender  = settings.get("resend_sender") or os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
    if not api_key:
        msg = "No email configured: add SMTP or Resend credentials in Settings."
        logger.info(f"[email skipped — no SMTP or Resend configured] {to} — {subject}")
        return False, last_error or msg
    try:
        import resend
        resend.api_key = api_key
        params = {"from": sender, "to": [to], "subject": subject, "html": html}
        # Use the native async method (resend v2+) to avoid event-loop conflicts
        if hasattr(resend.Emails, "send_async"):
            result = await resend.Emails.send_async(params)
        else:
            result = await asyncio.to_thread(resend.Emails.send, params)
        rid = result.get("id") if isinstance(result, dict) else getattr(result, "id", result)
        logger.info(f"[resend sent] {to} — {subject} — id={rid}")
        return True, None
    except Exception as e:
        last_error = f"Resend error: {e}"
        logger.warning(f"[resend failed] {to} — {subject} — {e}")
        return False, last_error
