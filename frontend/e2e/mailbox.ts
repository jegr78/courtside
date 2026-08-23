import { expect } from "@playwright/test";

interface MailboxSummary {
  messages: { ID: string; To: { Address: string }[] | null; Subject: string }[];
}

interface MailboxMessage {
  Subject: string;
  Text: string;
}

export async function messagesTo(mailboxURL: string, address: string): Promise<MailboxSummary["messages"]> {
  const response = await fetch(`${mailboxURL}/api/v1/messages?limit=200`);
  if (!response.ok) throw new Error(`The journey mailbox answered ${response.status}`);
  const summary = await response.json() as MailboxSummary;
  return summary.messages.filter((message) =>
    (message.To ?? []).some((recipient) => recipient.Address === address));
}

export async function messageTo(mailboxURL: string, address: string): Promise<MailboxMessage> {
  await expect.poll(async () => (await messagesTo(mailboxURL, address)).length,
    { message: `no message reached ${address}`, timeout: 20_000 }).toBeGreaterThan(0);
  const listed = await messagesTo(mailboxURL, address);
  const response = await fetch(`${mailboxURL}/api/v1/message/${listed[0].ID}`);
  if (!response.ok) throw new Error(`The journey mailbox answered ${response.status}`);
  return await response.json() as MailboxMessage;
}

// The credential is whatever the message puts on the line the template labels, and the template is
// the only place it exists, so the journey reads it the way the member does.
export function credentialIn(message: MailboxMessage, label: string): string {
  const found = new RegExp(`^${label}\\s*(\\S+)\\s*$`, "m").exec(message.Text);
  if (!found) throw new Error(`No line starting with ${label} in:\n${message.Text}`);
  return found[1];
}
