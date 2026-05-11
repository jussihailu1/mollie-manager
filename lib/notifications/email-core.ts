export type NotificationEmailPayload = {
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
    from: input.envelope.from,
    html: input.message.html,
    subject: input.message.subject,
    text: input.message.text,
    to: input.envelope.to,
  });
}
