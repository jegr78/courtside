import { useContext, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { bindProofForm, MfaProofContext, ProofOwnerContext, WebauthnProofContext } from "../security/reauthentication";
import { supportsSecurityKeys } from "../security/webauthn";
import { Button } from "./Button";
import { TextField } from "./TextField";

export function ReauthenticationCode({ required }: { required?: boolean }) {
  const { t } = useTranslation();
  const enabled = useContext(MfaProofContext);
  const available = useContext(WebauthnProofContext) && supportsSecurityKeys();
  const owner = useContext(ProofOwnerContext);
  const [method, setMethod] = useState("code");
  const root = useRef<HTMLDivElement>(null);
  const attempt = useRef<AbortController | undefined>(undefined);
  useLayoutEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const unbind = bindProofForm(form, () => {
      attempt.current?.abort();
      const controller = new AbortController();
      attempt.current = controller;
      return controller;
    });
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") attempt.current?.abort(); };
    window.addEventListener("keydown", cancel, true);
    return () => { unbind(); window.removeEventListener("keydown", cancel, true); attempt.current?.abort(); };
  }, [owner, enabled, required]);
  function choose(value: string) { attempt.current?.abort(); setMethod(value); }
  if (!(required ?? enabled)) return null;
  const keySelected = available && method === "security-key";
  return <div ref={root} className="grid gap-3">
    <input type="hidden" name="reauthentication-method" value={keySelected ? "security-key" : "code"} />
    {available && <div className="flex flex-wrap gap-3">
      <Button variant="secondary" type="button" data-testid="reauthentication-use-key" aria-pressed={keySelected} onClick={() => choose("security-key")}>{t("mfa.useKey")}</Button>
      <Button variant="secondary" type="button" data-testid="reauthentication-use-code" aria-pressed={!keySelected} onClick={() => choose("code")}>{t("mfa.codeAlternative")}</Button>
    </div>}
    {!keySelected && <TextField id="reauthentication-mfa-code" name="reauthentication-mfa-code"
      data-testid="reauthentication-mfa-code" label={t("mfa.code")} autoComplete="one-time-code" maxLength={128} required />}
  </div>;
}
