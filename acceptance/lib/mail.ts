import { config } from "./context";

export const mailAvailable = () => config.mail !== undefined;
const mailpit = () => {
  if (!config.mail) throw new Error("PRECONDITION: mail.url is not configured, so this journey is not checkable");
  return config.mail.url;
};

export type Mail = { id: string; subject: string; html: string; text: string };

export async function latestMailTo(address: string, since: Date, subject?: RegExp, until?: Date): Promise<Mail | null> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await (await fetch(`${mailpit()}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=10`)).json();
    const hit = (search.messages ?? []).find((m: { Created: string; Subject: string }) => Date.parse(m.Created) >= since.getTime() && (!until || Date.parse(m.Created) < until.getTime()) && (!subject || subject.test(m.Subject)));
    if (hit) {
      const message = await (await fetch(`${mailpit()}/api/v1/message/${hit.ID}`)).json();
      return { id: hit.ID, subject: message.Subject, html: message.HTML, text: message.Text };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

export async function mailsTo(address: string, since: Date, count: number): Promise<Mail[]> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await (await fetch(`${mailpit()}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=10`)).json();
    const hits = (search.messages ?? []).filter((m: { Created: string }) => Date.parse(m.Created) >= since.getTime())
      .sort((a: { Created: string }, b: { Created: string }) => Date.parse(a.Created) - Date.parse(b.Created));
    if (hits.length >= count) {
      return Promise.all(hits.map(async (hit: { ID: string }) => {
        const message = await (await fetch(`${mailpit()}/api/v1/message/${hit.ID}`)).json();
        return { id: hit.ID, subject: message.Subject, html: message.HTML, text: message.Text };
      }));
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return [];
}
