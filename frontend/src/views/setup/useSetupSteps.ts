import { useEffect, useState } from "react";
import { api, type AdminClubConfig } from "../../api/client";
import { useRetry } from "../../failures/useRetry";
import { useReportedFailure } from "../../failures/useReportedFailure";

interface SetupState {
  configuration: boolean;
  facility: boolean;
  membershipTypes: boolean;
  roster: boolean;
  importSource: boolean;
}

export interface SetupStep {
  id: keyof Omit<SetupState, "importSource"> | "import";
  to: string;
  complete: boolean;
  optional?: boolean;
}

export const REQUIRED_STEPS = 4;

const factoryConfiguration = {
  clubName: "Courtside",
  shortName: null,
  primaryColor: "#AF5030",
  accentColor: "#D7E24B",
  logoUrl: null,
  imprintUrl: null,
  privacyUrl: null,
  documentationUrl: null,
  defaultLocale: "de",
  slotMinutes: 30,
  timeZone: "Europe/Berlin",
  newAccountCredentialHours: 168,
  passwordResetCredentialHours: 24,
  passwordResetTokenMinutes: 60,
  bookingReminderHours: 24,
  logoUploaded: false,
  noMembershipTypeRuleSetId: null
} as const;

function configurationChanged(configuration: AdminClubConfig): boolean {
  return Object.entries(factoryConfiguration)
    .some(([key, value]) => configuration[key as keyof AdminClubConfig] !== value);
}

async function hasCurrentMember(): Promise<boolean> {
  return (await api.roster({ limit: 1, currentMembers: true })).matching > 0;
}

export function useSetupSteps() {
  const { message: error, report, clear } = useReportedFailure();
  const [state, setState] = useState<SetupState>();
  const [loadAttempt, retryLoad] = useRetry();

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.adminConfig(),
      api.adminCourts(),
      api.adminOpeningHours(),
      api.membershipTypes(),
      hasCurrentMember(),
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
  }, [loadAttempt, report]);

  const steps: SetupStep[] | undefined = state && [
    { id: "configuration", to: "/admin/configuration", complete: state.configuration },
    { id: "facility", to: "/admin/facility/courts", complete: state.facility },
    { id: "membershipTypes", to: "/admin/membership-types", complete: state.membershipTypes },
    { id: "roster", to: "/admin/roster", complete: state.roster },
    { id: "import", to: "/admin/import", complete: state.importSource, optional: true }
  ];
  const completed = steps?.filter((step) => !step.optional && step.complete).length ?? 0;
  return { steps, completed, error, retry: () => { clear(); retryLoad(); } };
}
