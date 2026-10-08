import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { it, type TestContext } from "node:test";

import nodemailer from "nodemailer-smtp";

import { sendNotificationEmailWithTransport } from "./email-core";

// Real SMTP and MIME handling, confined to loopback with synthetic credentials.
// This does not load application env or contact a mail provider.
async function localSmtp(t: TestContext, rejectRecipient = false) {
  const received = { auth: "", recipients: [] as string[], messages: [] as string[] };
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    socket.write("220 localhost ESMTP test\r\n");
    let buffer = "";
    let message: string[] | null = null;
    socket.on("data", (chunk) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (message) {
          if (line === ".") {
            received.messages.push(message.join("\r\n"));
            message = null;
            socket.write("250 2.0.0 accepted\r\n");
          } else {
            message.push(line.replace(/^\.\./, "."));
          }
        } else if (line.startsWith("EHLO ")) {
          socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
        } else if (line.startsWith("AUTH PLAIN ")) {
          received.auth = Buffer.from(line.slice(11), "base64").toString("utf8");
          socket.write("235 2.7.0 authenticated\r\n");
        } else if (line.startsWith("MAIL FROM:")) {
          socket.write("250 2.1.0 sender accepted\r\n");
        } else if (line.startsWith("RCPT TO:")) {
          received.recipients.push(line);
          socket.write(rejectRecipient ? "550 5.1.1 rejected\r\n" : "250 2.1.5 recipient accepted\r\n");
        } else if (line === "DATA") {
          message = [];
          socket.write("354 send message\r\n");
        } else if (line === "QUIT") {
          socket.end("221 goodbye\r\n");
        } else {
          socket.write("500 unexpected command\r\n");
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const transport = nodemailer.createTransport({
    host: "127.0.0.1",
    port: address.port,
    secure: false,
    auth: { user: "local-test", pass: "synthetic-password" },
    connectionTimeout: 2000,
    greetingTimeout: 2000,
    socketTimeout: 2000,
  });
  t.after(async () => {
    transport.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  return { transport, received };
}

it("delivers an invoice attachment through the installed SMTP mailer without changing its recipient", { timeout: 10000 }, async (t) => {
  const { transport, received } = await localSmtp(t);
  const pdf = Buffer.from("%PDF-1.4\nSynthetic invoice fixture\n%%EOF");
  await sendNotificationEmailWithTransport({
    transport,
    envelope: { from: "Kify <invoices@example.test>", to: "operator@example.test" },
    message: {
      subject: "Invoice F00054 - EUR 24.90",
      text: "Invoice attached.",
      html: "<p>Invoice attached.</p>",
      attachments: [{ content: pdf, contentType: "application/pdf", filename: "F00054.pdf" }],
    },
  });
  assert.equal(received.auth, "\0local-test\0synthetic-password");
  assert.deepEqual(received.recipients, ["RCPT TO:<operator@example.test>"]);
  assert.equal(received.messages.length, 1);
  const message = received.messages[0];
  assert.match(message, /To: operator@example\.test/);
  assert.match(message, /Subject: Invoice F00054 - EUR 24\.90/);
  assert.match(message, /Content-Type: text\/plain/);
  assert.match(message, /Content-Type: text\/html/);
  assert.match(message, /Content-Type: application\/pdf; name=F00054\.pdf/);
  assert.match(message, /Content-Disposition: attachment; filename=F00054\.pdf/);
  assert.ok(message.includes(pdf.toString("base64")));
});

it("propagates SMTP rejection without sending data or retrying the recipient", { timeout: 10000 }, async (t) => {
  const { transport, received } = await localSmtp(t, true);
  await assert.rejects(sendNotificationEmailWithTransport({
    transport,
    envelope: { from: "invoices@example.test", to: "operator@example.test" },
    message: { subject: "Cron summary", text: "Synthetic local test." },
  }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & { responseCode?: number }).responseCode, 550);
    return true;
  });
  assert.equal(received.recipients.length, 1);
  assert.equal(received.messages.length, 0);
});
