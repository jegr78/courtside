import { useTranslation } from "react-i18next";
import { LoadFailure } from "../components/LoadFailure";
import { SetupProgress, SetupSteps } from "./setup/SetupChecklist";
import { useSetupSteps } from "./setup/useSetupSteps";

export function AdminSetupView() {
  const { t } = useTranslation();
  const { steps, completed, error, retry } = useSetupSteps();

  return <section data-testid="admin-setup-view" className="surface-panel grid gap-6 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="grid gap-2">
      <h1 className="text-3xl font-bold">{t("admin.setup.title")}</h1>
      <p className="text-muted">{t("admin.setup.description")}</p>
    </div>
    {!steps
      ? error ? <LoadFailure message={error} retry={retry} /> : <p role="status">{t("status.loading")}</p>
      : <>
        <SetupProgress completed={completed} />
        <SetupSteps steps={steps} />
      </>}
  </section>;
}
