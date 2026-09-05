import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type AdminClubConfig } from "../api/client";
import { Alert } from "../components/Alert";
import { useReportedFailure } from "../failures/useReportedFailure";

interface SetupState {
  configuration: boolean;
  facility: boolean;
  membershipTypes: boolean;
  roster: boolean;
  importSource: boolean;
}

interface SetupStep {
  id: keyof Omit<SetupState, "importSource"> | "import";
  to: string;
  complete: boolean;
  optional?: boolean;
}

const factoryConfiguration = {
  clubName: "Courtside",
  primaryColor: "#AF5030",
  accentColor: "#D7E24B",
  logoUrl: null,
  imprintUrl: null,
  privacyUrl: null,
  defaultLocale: "de",
  slotMinutes: 30,
  timeZone: "Europe/Berlin",
  newAccountCredentialHours: 168,
  passwordResetCredentialHours: 24,
  bookingReminderHours: 24,
  logoUploaded: false,
  noMembershipTypeRuleSetId: null
} as const;

function configurationChanged(configuration: AdminClubConfig): boolean {
  return Object.entries(factoryConfiguration)
    .some(([key, value]) => configuration[key as keyof AdminClubConfig] !== value);
}

async function hasCurrentMember(isActive: () => boolean): Promise<boolean> {
  let cursor: string | undefined;
  do {
    const page = await api.roster(undefined, cursor, 200);
    if (page.entries.some((entry) => entry.membershipTypeId && !entry.membershipEndedOn)) return true;
    cursor = page.nextCursor ?? undefined;
  } while (cursor && isActive());
  return false;
}

export function AdminSetupView() {
  const { t } = useTranslation();
  const { message: error, report } = useReportedFailure();
  const [state, setState] = useState<SetupState>();

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.adminConfig(),
      api.adminCourts(),
      api.adminOpeningHours(),
      api.membershipTypes(),
      hasCurrentMember(() => active),
      api.importSources()
    ]).then(([configuration, courts, openingHours, membershipTypes, roster, importSources]) => {
      if (!active) return;
      setState({
        configuration: configurationChanged(configuration),
        facility: courts.some((court) => court.active)
          && openingHours.some((day) => day.opensAt !== null && day.closesAt !== null),
        membershipTypes: membershipTypes.some((type) => type.active),
        roster,
        importSource: importSources.length > 0
      });
    }).catch((failure: unknown) => {
      if (active) report(failure);
    });
    return () => {
      active = false;
    };
  }, [report]);

  const steps: SetupStep[] = state ? [
    { id: "configuration", to: "/admin/configuration", complete: state.configuration },
    { id: "facility", to: "/admin/facility/courts", complete: state.facility },
    { id: "membershipTypes", to: "/admin/membership-types", complete: state.membershipTypes },
    { id: "roster", to: "/admin/roster", complete: state.roster },
    { id: "import", to: "/admin/import", complete: state.importSource, optional: true }
  ] : [];
  const completed = steps.filter((step) => !step.optional && step.complete).length;

  return <section data-testid="admin-setup-view" className="surface-panel grid gap-6 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="grid gap-2">
      <h1 className="text-3xl font-bold">{t("admin.setup.title")}</h1>
      <p className="text-muted">{t("admin.setup.description")}</p>
    </div>
    {!state
      ? error ? <Alert>{error}</Alert> : <p role="status">{t("status.loading")}</p>
      : <>
        <div className="grid gap-2">
          <p data-testid="setup-progress" className="font-semibold" aria-live="polite">
            {t("admin.setup.progress", { completed, total: 4 })}
          </p>
          <progress className="h-2 w-full" value={completed} max={4} aria-label={t("admin.setup.progressLabel")} />
        </div>
        <ol className="grid gap-4">
          {steps.map((step) => <SetupStepCard key={step.id} step={step} />)}
        </ol>
      </>}
  </section>;
}

function SetupStepCard({ step }: { step: SetupStep }) {
  const { t } = useTranslation();
  const state = step.optional ? step.complete ? "available" : "optional" : step.complete ? "complete" : "next";
  return <li data-testid={`setup-step-${step.id === "membershipTypes" ? "membership-types" : step.id}`} data-state={state}
    className="surface-subtle grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_auto] sm:items-center">
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold">{t(`admin.setup.${step.id}.title`)}</h2>
        <span className="rounded-full border px-2 py-1 text-xs font-semibold">
          {t(`admin.setup.state.${state}`)}
        </span>
      </div>
      <p className="text-muted">{t(`admin.setup.${step.id}.description`)}</p>
    </div>
    <Link className="font-semibold underline" to={step.to}>{t(`admin.setup.${step.id}.action`)}</Link>
  </li>;
}
