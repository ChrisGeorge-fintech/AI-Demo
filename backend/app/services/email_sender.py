"""
Email sender using the Resend API.
"""

import resend
from app.core.config import get_settings


def send_receipt_analysis(to_email: str, subject: str, html_body: str) -> None:
    settings = get_settings()
    resend.api_key = settings.resend_api_key

    resend.Emails.send({
        "from": "AI Accounting Portal <receipts@resend.dev>",
        "to": [to_email],
        "subject": subject,
        "html": html_body,
    })
