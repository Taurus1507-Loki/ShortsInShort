import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Tag used in dev logs/tests to find a message (e.g. 'verify', 'reset'). */
  tag: string;
}

/** Captured in tests so they can follow verification/reset links. */
export const sentEmails: EmailMessage[] = [];

let transporter: Transporter | null = null;
if (env.smtp) {
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
}

/**
 * Sends a transactional email over SMTP. Without SMTP (development only — production refuses to
 * boot), the message is written to the server log so links can be followed locally.
 */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (env.isTest) {
    sentEmails.push(msg);
    return;
  }
  if (!transporter) {
    logger.warn(
      { to: msg.to, subject: msg.subject, tag: msg.tag },
      `[DEV EMAIL — SMTP not configured, not delivered]\n${msg.text}`,
    );
    return;
  }
  try {
    await transporter.sendMail({ from: env.emailFrom, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
  } catch (err) {
    // Email failures must not leak account existence or crash the request; log for ops.
    logger.error({ err, to: msg.to, tag: msg.tag }, 'Failed to send email');
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(heading: string, body: string, cta?: { label: string; url: string }) {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${escapeHtml(cta.url)}" style="background:#7C3AED;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">${escapeHtml(cta.label)}</a></p>
       <p style="color:#6B7280;font-size:13px">Or paste this link into your browser:<br>${escapeHtml(cta.url)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#F3F4F6;font-family:Inter,Segoe UI,Arial,sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:14px;padding:32px;color:#111827">
    <div style="font-weight:800;font-size:18px;margin-bottom:20px">Shorts<span style="color:#7C3AED">In</span>Short</div>
    <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(heading)}</h1>
    <div style="font-size:15px;line-height:1.6;color:#374151">${body}</div>
    ${button}
    <p style="color:#9CA3AF;font-size:12px;margin-top:32px">If you didn't request this, you can ignore this email.</p>
  </div></body></html>`;
}

export const emails = {
  verify(to: string, name: string, url: string): EmailMessage {
    return {
      to,
      tag: 'verify',
      subject: 'Verify your ShortsInShort email',
      text: `Hi ${name},\n\nConfirm your email address to activate your account:\n${url}\n\nThis link expires in 24 hours.`,
      html: layout(
        'Confirm your email',
        `<p>Hi ${escapeHtml(name)}, confirm your email address to activate your account. This link expires in 24 hours.</p>`,
        { label: 'Verify email', url },
      ),
    };
  },
  welcome(to: string, name: string): EmailMessage {
    const url = `${env.appUrl}/app`;
    return {
      to,
      tag: 'welcome',
      subject: 'Welcome to ShortsInShort',
      text: `Hi ${name},\n\nYour email is verified. Start your first project: ${url}`,
      html: layout(
        `Welcome, ${name}`,
        '<p>Your email is verified and your workspace is ready. Create your first project whenever you like.</p>',
        { label: 'Open dashboard', url },
      ),
    };
  },
  passwordReset(to: string, name: string, url: string): EmailMessage {
    return {
      to,
      tag: 'reset',
      subject: 'Reset your ShortsInShort password',
      text: `Hi ${name},\n\nReset your password using this link (valid for 1 hour):\n${url}`,
      html: layout(
        'Reset your password',
        `<p>Hi ${escapeHtml(name)}, use the button below to choose a new password. The link is valid for 1 hour and can be used once.</p>`,
        { label: 'Reset password', url },
      ),
    };
  },
  passwordChanged(to: string, name: string): EmailMessage {
    return {
      to,
      tag: 'password_changed',
      subject: 'Your ShortsInShort password was changed',
      text: `Hi ${name},\n\nYour password was just changed and other devices were signed out. If this wasn't you, reset your password immediately: ${env.appUrl}/forgot-password`,
      html: layout(
        'Your password was changed',
        `<p>Hi ${escapeHtml(name)}, your password was just changed and your other devices were signed out.</p><p>If this wasn't you, reset your password immediately.</p>`,
        { label: 'Reset password', url: `${env.appUrl}/forgot-password` },
      ),
    };
  },
  consentRequest(to: string, subjectName: string, requester: string, workspace: string, statement: string, confirmUrl: string, revokeUrl: string): EmailMessage {
    return {
      to,
      tag: 'consent_request',
      subject: `${requester} wants to create an AI copy of your voice`,
      text: `Hi ${subjectName},

${requester} (workspace "${workspace}") uploaded a recording of you saying:
"${statement}"

Nothing is created until you confirm. If you agree, confirm here (link valid 7 days):
${confirmUrl}

If this wasn't you or you don't agree, do nothing — or withdraw at any time, now or later:
${revokeUrl}`,
      html: layout(
        'Confirm your voice consent',
        `<p>Hi ${escapeHtml(subjectName)}, <strong>${escapeHtml(requester)}</strong> (workspace “${escapeHtml(workspace)}”) uploaded a recording of you saying:</p><blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #7C3AED;background:#F5F3FF">${escapeHtml(statement)}</blockquote><p>Nothing is created until you confirm. The link is valid for 7 days.</p><p style="font-size:13px">Don’t agree, or this wasn’t you? Do nothing, or <a href="${escapeHtml(revokeUrl)}">withdraw consent</a> — that link keeps working later too.</p>`,
        { label: 'Review and confirm', url: confirmUrl },
      ),
    };
  },
  consentRecorded(to: string, subjectName: string, workspace: string, revokeUrl: string): EmailMessage {
    return {
      to,
      tag: 'consent_recorded',
      subject: 'Your voice consent for ShortsInShort',
      text: `Hi ${subjectName},

You agreed to an AI copy of your voice for the "${workspace}" workspace. Keep this email: you can withdraw at any time with this link, which deletes the voice and your recordings:
${revokeUrl}`,
      html: layout(
        'Your voice consent is recorded',
        `<p>Hi ${escapeHtml(subjectName)}, you agreed to an AI copy of your voice for the “${escapeHtml(workspace)}” workspace.</p><p>Keep this email. You can withdraw at any time — the AI voice and your recordings are deleted straight away.</p>`,
        { label: 'Withdraw consent', url: revokeUrl },
      ),
    };
  },
  consentWithdrawn(to: string, name: string, subjectName: string, voiceName: string): EmailMessage {
    return {
      to,
      tag: 'consent_withdrawn',
      subject: `${subjectName} withdrew consent for the voice "${voiceName}"`,
      text: `Hi ${name},

${subjectName} withdrew their consent. The custom voice "${voiceName}" and its recordings were deleted and can no longer be used for new voiceovers.`,
      html: layout(
        'Voice consent withdrawn',
        `<p>Hi ${escapeHtml(name)}, ${escapeHtml(subjectName)} withdrew their consent. The custom voice “${escapeHtml(voiceName)}” and its recordings were deleted and can no longer be used for new voiceovers.</p>`,
      ),
    };
  },
  paymentReceipt(to: string, name: string, amountInr: string, what: string, invoiceNumber: string): EmailMessage {
    const url = `${env.appUrl}/app/billing`;
    return {
      to,
      tag: 'payment_receipt',
      subject: `Payment received — invoice ${invoiceNumber}`,
      text: `Hi ${name},

We received your payment of INR ${amountInr}. ${what}

Your GST invoice ${invoiceNumber} is on the Billing page: ${url}`,
      html: layout(
        'Payment received',
        `<p>Hi ${escapeHtml(name)}, we received your payment of <strong>INR ${escapeHtml(amountInr)}</strong>. ${escapeHtml(what)}</p><p>Your GST invoice <strong>${escapeHtml(invoiceNumber)}</strong> is ready to download.</p>`,
        { label: 'View invoice', url },
      ),
    };
  },
};
