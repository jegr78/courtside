import type { SessionStatus } from "../api/client";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AccountSecurityView } from "./AccountSecurityView";

export function AccountView({ session, offline = false, focusSecurity = false, passwordChanged, signedOut }: {
  session: SessionStatus; offline?: boolean; focusSecurity?: boolean;
  passwordChanged: () => void; signedOut: () => void;
}) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const identified = session.authenticated && !offline && typeof session.username === "string" && session.username.length > 0;
  useLayoutEffect(() => {
    if (focusSecurity) return;
    heading.current?.scrollIntoView?.({ block: "start" });
    heading.current?.focus({ preventScroll: true });
  }, [focusSecurity]);
  return <div data-testid="account-view" className="grid w-full min-w-0 max-w-3xl gap-6">
    <h1 ref={heading} tabIndex={-1} data-testid="account-title" className="focus-ring scroll-mt-4 rounded text-2xl font-bold">{t("account.title")}</h1>
    <section data-testid="account-profile" aria-labelledby="account-profile-title"
      className="surface-panel grid min-w-0 gap-4 rounded-2xl border p-6 sm:p-8">
      <h2 id="account-profile-title" className="text-xl font-bold">{t("account.profile")}</h2>
      {identified ? <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-muted text-sm">{t("auth.username")}</dt>
          <dd data-testid="profile-username" className="break-all font-semibold">{session.username}</dd></div>
        <div className="min-w-0"><dt className="text-muted text-sm">{t("account.firstName")}</dt>
          <dd data-testid="profile-first-name" className="break-words font-semibold">{session.firstName ?? t("account.fieldUnavailable")}</dd></div>
        <div className="min-w-0"><dt className="text-muted text-sm">{t("account.lastName")}</dt>
          <dd data-testid="profile-last-name" className="break-words font-semibold">{session.lastName ?? t("account.fieldUnavailable")}</dd></div>
        <div className="min-w-0"><dt className="text-muted text-sm">{t("account.roles")}</dt>
          <dd>{session.roles.length ? <ul className="grid gap-1">
            {session.roles.map((role) => <li key={role} data-testid="profile-role" className="break-words font-semibold">{t(`role.${role}`)}</li>)}
          </ul> : <span data-testid="profile-no-roles">{t("account.noRoles")}</span>}</dd></div>
      </dl> : <p data-testid="profile-unavailable" role="status">{t("account.unavailable")}</p>}
    </section>
    <AccountSecurityView key={session.username ?? "unavailable"} embedded focusRequested={focusSecurity}
      passwordChanged={passwordChanged} signedOut={signedOut} />
  </div>;
}
