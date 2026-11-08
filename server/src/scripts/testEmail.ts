/**
 * Checks SMTP settings and sends one test email:
 *   npm --prefix server run email:test -- you@example.com
 */
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const to = process.argv[2];
if (!to) {
  console.error('Usage: npm --prefix server run email:test -- <recipient@example.com>');
  process.exit(1);
}
if (!env.smtp) {
  console.error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS and EMAIL_FROM in server/.env.');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.secure,
  auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
});

try {
  await transporter.verify();
  console.log(`✓ Connected and logged in to ${env.smtp.host}:${env.smtp.port}`);
  const info = await transporter.sendMail({
    from: env.emailFrom,
    to,
    subject: 'ShortsInShort test email',
    text: `Email delivery is working. Verification and password-reset links will now be sent from ${env.emailFrom}.`,
  });
  console.log(`✓ Test email sent to ${to} (message id ${info.messageId}). Check the inbox and spam folder.`);
} catch (err) {
  const e = err as { code?: string; responseCode?: number; message: string };
  console.error(`✗ Email failed: ${e.message}`);
  if (e.code === 'EAUTH' || e.responseCode === 535) {
    console.error('  Login rejected. For Gmail, SMTP_PASS must be a 16-character App Password (not your normal password), with 2-Step Verification on.');
  } else if (e.code === 'ESOCKET' || e.code === 'ECONNECTION' || e.code === 'ETIMEDOUT') {
    console.error('  Could not connect. Check SMTP_HOST/SMTP_PORT, and use SMTP_SECURE=true with port 465 or false with 587.');
  }
  process.exit(1);
}
