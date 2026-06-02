export type NotificationEmailPayload = {
  attachments?: Array<{
    content: Buffer;
    contentType?: string;
    filename: string;
  }>;
  html?: string;
  subject: string;
  text: string;
};

export type NotificationEnvelope = {
  from: string;
  to: string;
};

export type NotificationTransport = {
  sendMail: (input: {
    attachments?: Array<{
      content: Buffer;
      contentType?: string;
      filename: string;
    }>;
    from: string;
    html?: string;
    subject: string;
    text: string;
    to: string;
  }) => Promise<unknown>;
};

export async function sendNotificationEmailWithTransport(input: {
  envelope: NotificationEnvelope;
  message: NotificationEmailPayload;
  transport: NotificationTransport;
}) {
  await input.transport.sendMail({
    attachments: input.message.attachments,
    from: input.envelope.from,
    html: input.message.html,
    subject: input.message.subject,
    text: input.message.text,
    to: input.envelope.to,
  });
}
