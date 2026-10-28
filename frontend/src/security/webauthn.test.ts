import { afterEach, expect, it, vi } from "vitest";
import { createSecurityKey, getSecurityKey, supportsSecurityKeys } from "./webauthn";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;
const common = { id: "-_8", rawId: bytes(251, 255), type: "public-key", authenticatorAttachment: "cross-platform", getClientExtensionResults: () => ({}) };

afterEach(() => vi.unstubAllGlobals());

it("given creation options, when registering a security key, then decode binary options and require user verification", async () => {
  // given
  const create = vi.fn<(options: CredentialCreationOptions) => Promise<unknown>>().mockResolvedValue({ ...common, response: { attestationObject: bytes(1, 2), clientDataJSON: bytes(3, 4), getTransports: () => ["usb"] } });
  vi.stubGlobal("navigator", { credentials: { create } });
  const controller = new AbortController();
  // when
  const result = await createSecurityKey({ rp: { id: "example.org", name: "Example" }, user: { id: "-_8", name: "jane.doe", displayName: "Jane Doe" }, challenge: "AQI", pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { userVerification: "preferred" }, excludeCredentials: [{ type: "public-key", id: "-_8" }] }, controller.signal);
  // then
  const options = create.mock.calls[0][0];
  expect(new Uint8Array(options.publicKey!.challenge as ArrayBuffer)).toEqual(new Uint8Array([1, 2]));
  expect(new Uint8Array(options.publicKey!.user.id as ArrayBuffer)).toEqual(new Uint8Array([251, 255]));
  expect(new Uint8Array(options.publicKey!.excludeCredentials![0].id as ArrayBuffer)).toEqual(new Uint8Array([251, 255]));
  expect(options.publicKey!.authenticatorSelection!.userVerification).toBe("required");
  expect(options.signal).toBe(controller.signal);
  expect(result).toMatchObject({ id: "-_8", rawId: "-_8", response: { attestationObject: "AQI", clientDataJSON: "AwQ", transports: ["usb"] } });
});

it("given request options, when proving with a security key, then serialize the assertion without retaining its buffers", async () => {
  // given
  const get = vi.fn<(options: CredentialRequestOptions) => Promise<unknown>>().mockResolvedValue({ ...common, response: { authenticatorData: bytes(1), clientDataJSON: bytes(2), signature: bytes(3), userHandle: null } });
  vi.stubGlobal("navigator", { credentials: { get } });
  // when
  const result = await getSecurityKey({ challenge: "AQI", rpId: "example.org", allowCredentials: [{ id: "-_8", type: "public-key" }], userVerification: "preferred" }, new AbortController().signal);
  // then
  expect(get.mock.calls[0][0].publicKey!.userVerification).toBe("required");
  expect(new Uint8Array(get.mock.calls[0][0].publicKey!.allowCredentials![0].id as ArrayBuffer)).toEqual(new Uint8Array([251, 255]));
  expect(result.response).toEqual({ authenticatorData: "AQ", clientDataJSON: "Ag", signature: "Aw", userHandle: null });
});

it("given browser dismissal, when requesting a key, then reject without inventing an assertion", async () => {
  // given
  vi.stubGlobal("navigator", { credentials: { get: vi.fn().mockResolvedValue(null) } });
  // when / then
  await expect(getSecurityKey({ challenge: "AQI", rpId: "example.org", allowCredentials: [], userVerification: "required" }, new AbortController().signal)).rejects.toMatchObject({ name: "NotAllowedError" });
});

it("given an aborted browser request, when the browser resolves late, then discard the credential", async () => {
  // given
  const controller = new AbortController();
  vi.stubGlobal("navigator", { credentials: { get: vi.fn().mockImplementation(() => { controller.abort(); return Promise.resolve(common); }) } });
  // when / then
  await expect(getSecurityKey({ challenge: "AQI", rpId: "example.org", allowCredentials: [], userVerification: "required" }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});

it.each([false, true])("given secure context is %s, when checking browser support, then require both security and credential APIs", (secure) => {
  // given
  vi.stubGlobal("isSecureContext", secure);
  vi.stubGlobal("PublicKeyCredential", class {});
  vi.stubGlobal("navigator", { credentials: { create: vi.fn(), get: vi.fn() } });
  // when / then
  expect(supportsSecurityKeys()).toBe(secure);
});
