import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "../../components/Alert";
import { SuccessFeedback } from "../../components/SuccessFeedback";

interface FacilityPageProps {
  testId: string;
  title: string;
  loaded: boolean;
  error?: string;
  success?: string;
  children: ReactNode;
}

export function FacilityPage({ testId, title, loaded, error, success, children }: FacilityPageProps) {
  const { t } = useTranslation();
  return <section data-testid={testId} className="surface-panel grid gap-6 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-3xl font-bold">{title}</h1>
    {error && <Alert>{error}</Alert>}
    {loaded
      ? <>
        {success && <SuccessFeedback>{success}</SuccessFeedback>}
        {children}
      </>
      : !error && <p role="status">{t("status.loading")}</p>}
  </section>;
}
