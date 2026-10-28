import { createHmac } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";

export function authenticatorCode(secret: string, instant: string, offset = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let value = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of secret.toUpperCase().replace(/=+$/, "")) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid authenticator setup key");
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 255); value &= (1 << bits) - 1; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.parse(instant) / 30_000) + offset));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const position = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(position) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export async function virtualSecurityKeys(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const authenticators: string[] = [];
  return {
    async add(): Promise<string> {
      const created = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
        protocol: "ctap2", transport: "usb", hasResidentKey: true, hasUserVerification: true,
        isUserVerified: true, automaticPresenceSimulation: true
      } });
      authenticators.push(created.authenticatorId);
      return created.authenticatorId;
    },
    async useOnly(chosen: string): Promise<void> {
      for (const authenticatorId of authenticators) {
        await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: authenticatorId === chosen });
      }
    },
    async close(): Promise<void> {
      for (const authenticatorId of authenticators) await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
      await cdp.detach();
    }
  };
}
