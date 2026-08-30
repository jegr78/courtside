import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { Button } from "../components/Button";

// The router renders this in place of the whole tree, so it carries none of the navigation and
// offers the two ways out that do not depend on what failed.
export function ApplicationErrorView() {
  const { t } = useTranslation();

  function signOut() {
    void api.logout()
      .catch(() => undefined)
      .finally(() => { window.location.assign("/login"); });
  }

  return <main className="flex min-h-screen items-start justify-center bg-(--cs-page) px-4 py-8 text-(--cs-text)">
    <section role="alert" data-testid="application-error"
             className="surface-panel w-full max-w-md rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
      <h1 className="text-2xl font-bold">{t("error.title")}</h1>
      <p className="mt-3">{t("error.explanation")}</p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" type="button" data-testid="application-error-sign-out" onClick={signOut}>
          {t("auth.logout")}
        </Button>
        <Button variant="primary" type="button" data-testid="application-error-reload"
                onClick={() => window.location.reload()}>{t("error.reload")}</Button>
      </div>
    </section>
  </main>;
}
