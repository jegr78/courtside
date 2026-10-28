import type { TFunction } from "i18next";
import type { components } from "../api/schema";
import { abortable } from "../api/abortable";

type CreationOptions = components["schemas"]["WebAuthnCreationOptions"];
type RequestOptions = components["schemas"]["WebAuthnRequestOptions"];
type Descriptor = components["schemas"]["WebAuthnCredentialDescriptor"];

export function supportsSecurityKeys() {
  return window.isSecureContext === true && typeof PublicKeyCredential !== "undefined"
    && typeof navigator.credentials?.create === "function" && typeof navigator.credentials?.get === "function";
}

function decode(value: string): ArrayBuffer {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0)).buffer;
}

function encode(value: ArrayBuffer): string {
  return btoa(Array.from(new Uint8Array(value), (byte) => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function descriptor(value: Descriptor): PublicKeyCredentialDescriptor {
  return { ...value, id: decode(value.id), transports: value.transports as AuthenticatorTransport[] | undefined };
}

function credential(value: Credential | null, signal: AbortSignal): PublicKeyCredential {
  signal.throwIfAborted();
  if (!value || value.type !== "public-key") throw new DOMException("Security key request cancelled", "NotAllowedError");
  return value as PublicKeyCredential;
}

function common(value: PublicKeyCredential) {
  return { id: value.id, rawId: encode(value.rawId), type: "public-key" as const,
    clientExtensionResults: { ...value.getClientExtensionResults() },
    authenticatorAttachment: value.authenticatorAttachment as "platform" | "cross-platform" | null };
}

export async function createSecurityKey(options: CreationOptions, signal: AbortSignal): Promise<components["schemas"]["WebAuthnRegistrationCredential"]> {
  const publicKey: PublicKeyCredentialCreationOptions = { ...options, challenge: decode(options.challenge),
    user: { ...options.user, id: decode(options.user.id) }, excludeCredentials: options.excludeCredentials?.map(descriptor),
    authenticatorSelection: { ...options.authenticatorSelection, userVerification: "required" } };
  const value = credential(await abortable(() => navigator.credentials.create({ publicKey, signal }), signal), signal);
  const response = value.response as AuthenticatorAttestationResponse;
  return { ...common(value), response: { attestationObject: encode(response.attestationObject),
    clientDataJSON: encode(response.clientDataJSON), transports: response.getTransports?.() as Descriptor["transports"] } };
}

export async function getSecurityKey(options: RequestOptions, signal: AbortSignal): Promise<components["schemas"]["WebAuthnAssertionCredential"]> {
  const publicKey: PublicKeyCredentialRequestOptions = { ...options, challenge: decode(options.challenge),
    allowCredentials: options.allowCredentials.map(descriptor), userVerification: "required" };
  const value = credential(await abortable(() => navigator.credentials.get({ publicKey, signal }), signal), signal);
  const response = value.response as AuthenticatorAssertionResponse;
  return { ...common(value), response: { authenticatorData: encode(response.authenticatorData),
    clientDataJSON: encode(response.clientDataJSON), signature: encode(response.signature),
    userHandle: response.userHandle ? encode(response.userHandle) : null } };
}

const securityKeyFailures: Record<string, string> = {
  NotAllowedError: "mfa.keyCancelled",
  AbortError: "mfa.keyCancelled",
  TimeoutError: "mfa.keyTimedOut",
  InvalidStateError: "mfa.keyAlreadyRegistered"
};

export function securityKeyFailure(failure: unknown, t: TFunction): string | undefined {
  if (!(failure instanceof DOMException || failure instanceof Error)) return undefined;
  const key = securityKeyFailures[failure.name];
  return key ? t(key) : undefined;
}
