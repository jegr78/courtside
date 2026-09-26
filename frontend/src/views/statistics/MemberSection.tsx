import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { useStatisticsFormat } from "./format";
import { BarList, KeyFigure, KeyFigures, Note, Section } from "./parts";
import { useStatisticsRead } from "./useStatisticsRead";

export function MemberSection({ from, to }: { from?: string; to?: string }) {
  const { t } = useTranslation();
  const format = useStatisticsFormat();
  const read = useStatisticsRead(api.memberStatistics, from, to);

  return <Section testId="statistics-members" heading={t("admin.statistics.members.heading")} read={read}>
    {(report) => {
      const { figures, accounts } = report;
      const previous = report.previous?.figures;
      const typed = report.membershipTypes.reduce((sum, type) => sum + type.members, 0);
      const accountFigures = [
        ["accounts", "accountsTotal", accounts.accounts],
        ["password-chosen", "passwordChosen", accounts.passwordChosen],
        ["without-chosen-password", "withoutChosenPassword", accounts.withoutChosenPassword],
        ["signed-in-30", "signedInWithin30Days", accounts.signedInWithin30Days],
        ["signed-in-90", "signedInWithin90Days", accounts.signedInWithin90Days],
        ["never-signed-in", "neverSignedIn", accounts.neverSignedIn]
      ] as const;
      return <>
        <KeyFigures>
          <KeyFigure testId="statistics-members-total" label={t("admin.statistics.members.members")} format={format}
            value={format.count(figures.members)} kind="count" current={figures.members} previous={previous?.members} />
          <KeyFigure testId="statistics-joins" label={t("admin.statistics.members.joins")} format={format}
            value={format.count(figures.joins)} kind="count" current={figures.joins} previous={previous?.joins} />
          <KeyFigure testId="statistics-leavings" label={t("admin.statistics.members.leavings")} format={format}
            value={format.count(figures.leavings)} kind="count" current={figures.leavings} previous={previous?.leavings} />
          <KeyFigure testId="statistics-active" label={t("admin.statistics.members.active")} format={format}
            value={format.count(figures.activeMembers)} kind="count" current={figures.activeMembers}
            previous={previous?.activeMembers} />
          <KeyFigure testId="statistics-active-share" label={t("admin.statistics.members.activeShare")} format={format}
            value={figures.activeShare === null ? "-" : format.percent(figures.activeShare)}
            kind="ratio" current={figures.activeShare} previous={previous?.activeShare} />
        </KeyFigures>
        <Note testId="statistics-active-note">{t("admin.statistics.members.activeNote")}</Note>
        {report.membershipTypes.length > 0 && <BarList testId="statistics-membership-types"
          heading={t("admin.statistics.members.types")}
          bars={report.membershipTypes.map((type) => ({
            key: type.membershipTypeId,
            testId: `statistics-membership-type-${type.membershipTypeId}`,
            label: type.name,
            ratio: typed > 0 ? type.members / typed : 0,
            value: format.count(type.members)
          }))} />}
        <section data-testid="statistics-accounts" aria-labelledby="statistics-accounts-heading" className="grid gap-3">
          <h3 id="statistics-accounts-heading" className="text-lg font-bold">{t("admin.statistics.members.accounts")}</h3>
          <KeyFigures>
            {accountFigures.map(([testId, label, value]) => <KeyFigure key={testId} testId={`statistics-${testId}`}
              label={t(`admin.statistics.members.${label}`)} value={format.count(value)} format={format} />)}
          </KeyFigures>
        </section>
      </>;
    }}
  </Section>;
}
