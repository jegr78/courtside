import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { MfaProofContext } from "../security/reauthentication";
import { TextField } from "./TextField";

export function ReauthenticationCode({ required }: { required?: boolean }) {
  const { t } = useTranslation();
  const enabled = useContext(MfaProofContext);
  return (required ?? enabled) ? <TextField id="reauthentication-mfa-code" name="reauthentication-mfa-code"
    data-testid="reauthentication-mfa-code" label={t("mfa.code")} autoComplete="one-time-code" maxLength={128} required /> : null;
}

