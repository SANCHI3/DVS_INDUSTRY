import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import type { Inquiry } from '@prisma/client';
import { logger } from '../logger';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (env.SMTP_HOST === undefined || env.SMTP_HOST.trim() === '') return null;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER !== undefined && {
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' },
    }),
  });
  return transporter;
}

/**
 * Sends the password-reset link. Never throws: the forgot-password endpoint
 * must respond identically whether or not the account exists or mail works.
 */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const mailer = getTransporter();

  if (mailer === null) {
    if (env.NODE_ENV === 'production') {
      logger.error('Password reset requested but SMTP is not configured (set SMTP_HOST)');
    } else {
      // Development convenience — the link is only ever logged outside production
      logger.info('SMTP not configured; password reset link (dev only)', { to, resetUrl });
    }
    return;
  }

  try {
    await mailer.sendMail({
      from: env.MAIL_FROM,
      to,
      subject: 'Reset your DVS Industries password',
      text:
        `A password reset was requested for your account.\n\n` +
        `Open this link within 15 minutes to choose a new password:\n${resetUrl}\n\n` +
        `If you did not request this, you can ignore this email.`,
    });
  } catch (err) {
    logger.error('Failed to send password reset email', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Tells the sales inbox about a new website inquiry. Never throws: the
 * inquiry is already saved and listed for admins either way.
 */
export async function sendInquiryNotification(inquiry: Inquiry): Promise<void> {
  const mailer = getTransporter();
  const to = env.INQUIRY_NOTIFY_EMAIL;
  if (mailer === null || to === undefined) {
    logger.info('Inquiry saved; email skipped (SMTP or INQUIRY_NOTIFY_EMAIL not set)', {
      inquiryId: inquiry.id,
    });
    return;
  }

  try {
    await mailer.sendMail({
      from: env.MAIL_FROM,
      to,
      replyTo: inquiry.email,
      subject: `Website inquiry from ${inquiry.name}${inquiry.company ? ` (${inquiry.company})` : ''}`,
      text:
        `Name: ${inquiry.name}\n` +
        `Company: ${inquiry.company ?? '-'}\n` +
        `Email: ${inquiry.email}\n` +
        `Phone: ${inquiry.phone ?? '-'}\n\n` +
        `${inquiry.message}\n`,
    });
  } catch (err) {
    logger.error('Failed to send inquiry notification', {
      inquiryId: inquiry.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
