"""
Invitation email service — sends branded HTML emails via AWS SES.
"""

import asyncio
import logging
import boto3
from botocore.exceptions import ClientError
from app.config import get_settings

logger = logging.getLogger(__name__)


def _build_html_email(
    inviter_name: str,
    club_name: str,
    invite_url: str,
    role: str,
) -> str:
    role_display = "an Admin" if role == "club_admin" else "a Player"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#080C14;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#080C14;">
<tr><td align="center" style="padding:40px 20px;">

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;">

<!-- Logo -->
<tr><td align="center" style="padding-bottom:32px;">
  <img src="https://app.onestat.ai/oneStatLogoTransparent.png" alt="OneStat" height="40" style="height:40px;" />
</td></tr>

<!-- Card -->
<tr><td style="
  background-color:#111827;
  border:1px solid #1F2937;
  border-radius:20px;
  padding:40px 32px;
">

  <!-- Heading -->
  <h1 style="
    margin:0 0 8px;
    font-size:22px;font-weight:700;
    color:#F0F4F8;
    text-align:center;
  ">You're invited to join</h1>

  <h2 style="
    margin:0 0 24px;
    font-size:26px;font-weight:800;
    color:#00E676;
    text-align:center;
  ">{club_name}</h2>

  <!-- Body -->
  <p style="
    margin:0 0 32px;
    font-size:15px;line-height:1.7;
    color:#9CA3AF;
    text-align:center;
  ">
    <strong style="color:#F0F4F8;">{inviter_name}</strong> has invited you as {role_display} on OneStat&nbsp;Analytics.
  </p>

  <!-- CTA Button — using VML for Outlook + solid fallback -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  <tr><td align="center">
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{invite_url}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="25%" fillcolor="#00E676" stroke="f">
    <w:anchorlock/>
    <center style="color:#080C14;font-family:'Segoe UI',sans-serif;font-size:15px;font-weight:bold;">Accept Invitation</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-->
    <a href="{invite_url}" target="_blank" style="
      display:inline-block;
      padding:14px 40px;
      border-radius:12px;
      background-color:#00E676;
      color:#080C14;
      font-size:15px;font-weight:700;
      text-decoration:none;
      letter-spacing:0.01em;
      mso-hide:all;
    ">Accept Invitation</a>
    <!--<![endif]-->
  </td></tr>
  </table>

  <!-- Decline note -->
  <p style="
    margin:24px 0 0;
    font-size:13px;
    color:#6B7280;
    text-align:center;
    line-height:1.6;
  ">
    If you don't want to join, you can ignore this email or
    <a href="{invite_url}" style="color:#6B7280;text-decoration:underline;">decline the invitation</a>.
  </p>

</td></tr>

<!-- Footer -->
<tr><td style="padding:24px 0;text-align:center;">
  <p style="margin:0;font-size:12px;color:#6B7280;line-height:1.6;">
    This invitation expires in 7 days.<br/>
    &copy; OneStat Sports AI
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>"""


def _build_text_email(
    inviter_name: str,
    club_name: str,
    invite_url: str,
    role: str,
) -> str:
    role_display = "an Admin" if role == "club_admin" else "a Player"
    return (
        f"You're invited to join {club_name} on OneStat Analytics!\n\n"
        f"{inviter_name} has invited you as {role_display}.\n\n"
        f"Accept the invitation: {invite_url}\n\n"
        f"This invitation expires in 7 days.\n"
    )


def _send_ses_email_sync(settings, invitee_email: str, club_name: str, text_body: str, html_body: str) -> None:
    """Synchronous SES client creation + send — run inside a thread by the caller."""
    ses = boto3.client("ses", region_name=settings.ses_region)
    ses.send_email(
        Source=f"OneStat Analytics <{settings.ses_sender_email}>",
        Destination={"ToAddresses": [invitee_email]},
        Message={
            "Subject": {"Data": f"You've been invited to {club_name} on OneStat"},
            "Body": {
                "Text": {"Data": text_body},
                "Html": {"Data": html_body},
            },
        },
    )


async def send_invitation_email(
    invitee_email: str,
    inviter_name: str,
    club_name: str,
    token: str,
    role: str = "club_admin",
) -> None:
    """Send a branded invitation email via SES."""
    settings = get_settings()
    invite_url = f"{settings.app_url.rstrip('/')}/invitation/{token}"

    html_body = _build_html_email(inviter_name, club_name, invite_url, role)
    text_body = _build_text_email(inviter_name, club_name, invite_url, role)

    try:
        # Offloaded to a thread — boto3 client creation + ses.send_email are
        # both synchronous network calls that would otherwise block the
        # whole event loop for the round-trip.
        await asyncio.to_thread(
            _send_ses_email_sync, settings, invitee_email, club_name, text_body, html_body
        )
        logger.info(f"Invitation email sent to {invitee_email} for {club_name}")
    except ClientError as e:
        logger.error(f"SES send_email failed for {invitee_email}: {e}")
        raise
