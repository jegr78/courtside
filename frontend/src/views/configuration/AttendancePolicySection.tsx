import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type AttendancePolicy } from "../../api/client";
import { Alert } from "../../components/Alert";
import { SuccessFeedback } from "../../components/SuccessFeedback";
import { TextField } from "../../components/TextField";
import { useReportedFailure } from "../../failures/useReportedFailure";
import { SaveBar } from "../../unsaved/SaveBar";
import { differs } from "../../unsaved/differs";

// The response leaves an unset release time out, which would otherwise read as a change against null.
function normalised(policy: AttendancePolicy): AttendancePolicy {
  return { enabled: policy.enabled, releaseAfterMinutes: policy.releaseAfterMinutes ?? null };
}

export function AttendancePolicySection() {
  const { t } = useTranslation();
  const { message: error, report, clear } = useReportedFailure();
  const [policy, setPolicy] = useState<AttendancePolicy>();
  const [saved, setSaved] = useState<AttendancePolicy>();
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState<string>();
  const [unreadable, setUnreadable] = useState(false);

  useEffect(() => {
    let active = true;
    void api.attendancePolicy()
      .then((read) => {
        if (!active) return;
        setPolicy(normalised(read));
        setSaved(normalised(read));
      })
      .catch(() => {
        if (active) setUnreadable(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!policy || pending) return;
    setPending(true);
    clear();
    setSuccess(undefined);
    try {
      const written = await api.changeAttendancePolicy(policy);
      setPolicy(normalised(written));
      setSaved(normalised(written));
      setSuccess(t("admin.attendance.saved"));
    } catch (failure) {
      report(failure);
    } finally {
      setPending(false);
    }
  }

  return <section data-testid="attendance-policy" aria-labelledby="attendance-policy-title" className="grid gap-4">
    <h2 id="attendance-policy-title" className="text-xl font-semibold">{t("admin.attendance.title")}</h2>
    {unreadable && <p data-testid="attendance-policy-unreadable" className="text-muted text-sm">{t("admin.attendance.unreadable")}</p>}
    {error && <Alert testId="attendance-policy-error">{error}</Alert>}
    {success && <SuccessFeedback testId="attendance-policy-saved">{success}</SuccessFeedback>}
    {policy && <form id="attendance-policy-form" noValidate onSubmit={(event) => void save(event)} className="grid gap-4">
      <label className="flex items-start gap-3">
        <input data-testid="attendance-enabled" type="checkbox" className="mt-1 size-4" checked={policy.enabled}
               onChange={(event) => setPolicy({ enabled: event.target.checked, releaseAfterMinutes: event.target.checked ? policy.releaseAfterMinutes : null })} />
        <span className="grid gap-1"><span className="font-medium">{t("admin.attendance.enabled")}</span>
          <span className="text-muted text-sm">{t("admin.attendance.enabledHelp")}</span></span>
      </label>
      <div className="grid gap-1">
        <TextField data-testid="attendance-release-minutes" type="number" min={5} max={120} className="max-w-32"
                   disabled={!policy.enabled} label={t("admin.attendance.releaseAfterMinutes")}
                   value={policy.releaseAfterMinutes ?? ""}
                   onChange={(event) => setPolicy({ ...policy, releaseAfterMinutes: event.target.value === "" ? null : Number(event.target.value) })} />
        <p className="text-muted text-sm">{t("admin.attendance.releaseAfterMinutesHelp")}</p>
      </div>
      <SaveBar id="attendance-policy" subject={t("admin.attendance.title")} saveTestId="save-attendance-policy" form="attendance-policy-form"
               unsaved={differs(policy, saved)} pending={pending} discard={() => setPolicy(saved)} />
    </form>}
  </section>;
}
