import "server-only";

import nodemailer from "nodemailer";

import { getNotificationConfig } from "@/lib/env";

let transport: nodemailer.Transporter | null = null;

export function notificationsAreConfigured() {
  try {
    getNotificationConfig();
    return true;
  } catch {
    return false;
  }
}

function getTransport() {
  if (transport) {
    return transport;
  }

  const config = getNotificationConfig();

  transport = nodemailer.createTransport({
    auth: {
      pass: config.SMTP_PASSWORD,
      user: config.SMTP_USER,
    },
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
  });

  return transport;
}

export async function sendPlainEmail(input: {
  subject: string;
  text: string;
}) {
  const config = getNotificationConfig();
  const transporter = getTransport();

  await transporter.sendMail({
    from: config.SMTP_FROM,
    subject: input.subject,
    text: input.text,
    to: config.ALERT_EMAIL_TO,
  });
}
