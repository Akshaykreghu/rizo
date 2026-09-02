import nodemailer from 'nodemailer';

// Optional email transport, mirroring legacy's PHPMailer-over-SMTP setup
// (DocumentManagerController::sendemailtemplate()). Configured entirely through env vars; when
// they're absent the app still runs and every send is a logged no-op — same optional-infra
// fallback pattern as src/lib/storage.ts (DigitalOcean Spaces) and getCompanyPool's dev
// credential fallback.
//
// .env(.local) keys:
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
//   SMTP_FROM (envelope From, e.g. "HR <hr@company.com>"),
//   SMTP_SECURE ("true" for implicit TLS / port 465)

export function isMailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export interface SendResult {
  status: 'sent' | 'skipped-no-smtp';
  messageId?: string;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendResult> {
  if (!isMailConfigured()) {
    console.info(`[mailer] SMTP not configured — skipping mail to ${opts.to} ("${opts.subject}")`);
    return { status: 'skipped-no-smtp' };
  }

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });

  const info = await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });

  return { status: 'sent', messageId: info.messageId };
}
