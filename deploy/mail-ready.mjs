import { readFileSync, readlinkSync } from "node:fs";
import { verifyServedCertificate } from "./mail-certificate-peer.mjs";

try {
  const environment = process.env;
  const version = readlinkSync("/tls/current").replace(/^versions\//, "");
  if (!/^[a-f0-9]{64}$/.test(version)) throw new Error("mail readiness has no validated certificate version");
  const username = environment.COURTSIDE_MAIL_SENDER_USERNAME ?? "courtside";
  const domain = environment.COURTSIDE_MAIL_DOMAIN;
  const password = process.env.COURTSIDE_MAIL_PASSWORD;
  if (!domain || !password || !environment.COURTSIDE_MAIL_HOSTNAME) {
    throw new Error("mail readiness requires managed sender credentials and hostname");
  }
  await verifyServedCertificate({
    hostname: environment.COURTSIDE_MAIL_HOSTNAME,
    host: "mail",
    expected: readFileSync(`/tls/fingerprints/${version}`, "utf8").trim(),
    username: `${username}@${domain}`,
    password,
    ...(environment.COURTSIDE_MAIL_RELOAD_CA_FILE
      ? { authority: readFileSync(environment.COURTSIDE_MAIL_RELOAD_CA_FILE) } : {})
  });
  process.stdout.write("mail_readiness=local-verified\nexternal_delivery=operator-check-required\n");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
