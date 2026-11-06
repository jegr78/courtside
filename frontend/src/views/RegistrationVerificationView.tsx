import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";

export function RegistrationVerificationView() {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const [outcome, setOutcome] = useState<{ verified?: boolean; error?: string }>({});
  const sent = useRef(false);

  useEffect(() => {
    const code = hash.replace(/^#/, "").trim();
    if (sent.current) return;
    sent.current = true;
    if (!code) {
      setOutcome({ error: t("registration.codeMissing") });
      return;
    }
    api.verifyRegistration(code)
      .then(() => setOutcome({ verified: true }))
      .catch((failure: unknown) => setOutcome({ error: problemMessage(failure, t) }));
  }, [hash, t]);

  return <section data-testid="registration-verification-view" className="surface-panel w-full max-w-md rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-2xl font-bold">{t("registration.verifyTitle")}</h1>
    {outcome.verified && <Alert tone="success" testId="registration-verified">{t("registration.verified")}</Alert>}
    {outcome.error && <Alert>{outcome.error}</Alert>}
    <p className="mt-6"><Link to="/login" data-testid="registration-to-login" className="font-semibold underline underline-offset-4">{t("registration.toLogin")}</Link></p>
  </section>;
}
