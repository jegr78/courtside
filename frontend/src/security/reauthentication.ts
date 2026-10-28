import { createContext } from "react";
import { api } from "../api/client";
import { abortable } from "../api/abortable";
import { getSecurityKey } from "./webauthn";

export const MfaProofContext = createContext(false);
export const WebauthnProofContext = createContext(false);
export const ProofOwnerContext = createContext<string | undefined>(undefined);

const proofForms = new WeakMap<HTMLFormElement, () => AbortController>();

export function bindProofForm(form: HTMLFormElement, begin: () => AbortController) {
  proofForms.set(form, begin);
  return () => { if (proofForms.get(form) === begin) proofForms.delete(form); };
}

export async function reauthenticateForm(form: HTMLFormElement, password: string) {
  const data = new FormData(form);
  if (data.get("reauthentication-method") === "security-key") {
    const controller = proofForms.get(form)?.();
    if (!controller) throw new DOMException("The proof dialog has closed", "AbortError");
    const signal = controller.signal;
    const deadline = setTimeout(() => controller.abort(new DOMException("Proof timed out", "TimeoutError")), 60_000);
    try {
      const options = await abortable(() => api.webauthnProofOptions(signal), signal);
      const credential = await getSecurityKey(options, signal);
      signal.throwIfAborted();
      await abortable(() => api.reauthenticate(password, undefined, credential, signal), signal);
      signal.throwIfAborted();
    } finally {
      clearTimeout(deadline);
    }
    return;
  }
  const code = data.get("reauthentication-mfa-code");
  return typeof code === "string" ? api.reauthenticate(password, code) : api.reauthenticate(password);
}
