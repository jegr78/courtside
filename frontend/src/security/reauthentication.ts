import { createContext } from "react";
import { api } from "../api/client";

export const MfaProofContext = createContext(false);
export const ProofOwnerContext = createContext<string | undefined>(undefined);


export function reauthenticateForm(form: HTMLFormElement, password: string) {
  const code = new FormData(form).get("reauthentication-mfa-code");
  return typeof code === "string" ? api.reauthenticate(password, code) : api.reauthenticate(password);
}
