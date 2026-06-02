import "server-only";

import { lookup } from "node:dns/promises";

import nodemailer from "nodemailer";

import { getNotificationConfig } from "@/lib/env";
import { sendNotificationEmailWithTransport } from "@/lib/notifications/email-core";

let transport: nodemailer.Transporter | null = null;
let fallbackIpv6Transport: nodemailer.Transporter | null = null;

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

async function getFallbackIpv6Transport() {
  if (fallbackIpv6Transport) {
    return fallbackIpv6Transport;
  }

  const config = getNotificationConfig();
  const resolved = await lookup(config.SMTP_HOST, {
    all: true,
    verbatim: true,
  });
  const ipv6Address = resolved.find((record) => record.family === 6)?.address;

  if (!ipv6Address) {
    return null;
  }

  fallbackIpv6Transport = nodemailer.createTransport({
    auth: {
      pass: config.SMTP_PASSWORD,
      user: config.SMTP_USER,
    },
    host: ipv6Address,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    tls: {
      servername: config.SMTP_HOST,
    },
  });

  return fallbackIpv6Transport;
}

export async function sendPlainEmail(input: {
  attachments?: Array<{
    content: Buffer;
    contentType?: string;
    filename: string;
  }>;
  html?: string;
  subject: string;
  text: string;
}) {
  const config = getNotificationConfig();
  const transporter = getTransport();

  const envelope = {
    from: config.SMTP_FROM,
    to: config.ALERT_EMAIL_TO,
  };
  const message = {
    attachments: input.attachments,
    html: input.html,
    subject: input.subject,
    text: input.text,
  };

  try {
    await sendNotificationEmailWithTransport({
      envelope,
      message,
      transport: transporter,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "";
    const isTimeoutError = /timeout|etimedout/i.test(errorMessage);

    if (!isTimeoutError) {
      throw error;
    }

    const ipv6Transport = await getFallbackIpv6Transport();

    if (!ipv6Transport) {
      throw error;
    }

    await sendNotificationEmailWithTransport({
      envelope,
      message,
      transport: ipv6Transport,
    });
  }
}

export async function sendEmailTo(input: {
  attachments?: Array<{
    content: Buffer;
    contentType?: string;
    filename: string;
  }>;
  html?: string;
  subject: string;
  text: string;
  to: string;
}) {
  const config = getNotificationConfig();
  const transporter = getTransport();

  const envelope = {
    from: config.SMTP_FROM,
    to: input.to,
  };
  const message = {
    attachments: input.attachments,
    html: input.html,
    subject: input.subject,
    text: input.text,
  };

  try {
    await sendNotificationEmailWithTransport({
      envelope,
      message,
      transport: transporter,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "";
    const isTimeoutError = /timeout|etimedout/i.test(errorMessage);

    if (!isTimeoutError) {
      throw error;
    }

    const ipv6Transport = await getFallbackIpv6Transport();

    if (!ipv6Transport) {
      throw error;
    }

    await sendNotificationEmailWithTransport({
      envelope,
      message,
      transport: ipv6Transport,
    });
  }
}
