import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, type MessageKind, type MessageTemplate, type MessageTemplateLanguage, type MessageTemplateText } from "../api/client";
import { problemMessage, violationMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import { Modal } from "../components/Modal";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { TextField } from "../components/TextField";
import { useRetry } from "../failures/useRetry";

const RECENT_AUTH = "urn:courtside:error:recent-authentication-required";
const REFUSED = "urn:courtside:error:message-template-refused";
const LANGUAGES: MessageTemplateLanguage[] = ["de", "en"];

type Write = { action: "save" | "reset"; kind: MessageKind; language: MessageTemplateLanguage; text: MessageTemplateText };

export function AdminMessageWordingView() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<MessageTemplate[]>();
  const [kind, setKind] = useState<MessageKind>();
  const [language, setLanguage] = useState<MessageTemplateLanguage>("de");
  const [draft, setDraft] = useState<MessageTemplateText>({ subject: "", body: "" });
  const [preview, setPreview] = useState<MessageTemplateText>();
  const [refusals, setRefusals] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [retry, setRetry] = useState<Write>();
  const [pending, setPending] = useState(false);
  const [loadAttempt, retryLoad] = useRetry();

  useEffect(() => {
    let active = true;
    void api.messageTemplates()
      .then((read) => {
        if (!active) return;
        setTemplates(read);
        setKind((current) => current ?? read[0]?.kind);
      })
      .catch((failure: unknown) => {
        if (active) setError(problemMessage(failure, t));
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, t]);

  const template = templates?.find((candidate) => candidate.kind === kind);
  const wording = template?.languages.find((candidate) => candidate.language === language);

  const [editing, setEditing] = useState(wording);
  if (editing !== wording) {
    setEditing(wording);
    if (wording) setDraft(wording.own ?? wording.shipped);
    setPreview(undefined);
    setRefusals([]);
  }

  function failed(failure: unknown, write?: Write) {
    if (failure instanceof ApiError && failure.problem?.type === RECENT_AUTH && write) {
      setRetry(write);
    } else if (failure instanceof ApiError && failure.problem?.type === REFUSED) {
      setRefusals((failure.problem.violations ?? []).map((violation) => violationMessage(violation.code, violation.params, t)));
    } else {
      setError(problemMessage(failure, t));
    }
  }

  async function perform(write: Write) {
    if (write.action === "save") {
      await api.changeMessageTemplate(write.kind, write.language, write.text);
    } else {
      await api.resetMessageTemplate(write.kind, write.language);
    }
    setTemplates(await api.messageTemplates());
    setSuccess(t(write.action === "save" ? "admin.messageWording.saved" : "admin.messageWording.resetDone"));
  }

  async function run(action: () => Promise<void>, write?: Write) {
    if (pending) return;
    setPending(true);
    setError(undefined);
    setSuccess(undefined);
    setRefusals([]);
    try {
      await action();
    } catch (failure) {
      failed(failure, write);
    } finally {
      setPending(false);
    }
  }

  function write(action: Write["action"]) {
    if (!kind) return;
    const requested: Write = { action, kind, language, text: draft };
    void run(() => perform(requested), requested);
  }

  function showPreview() {
    if (!kind) return;
    void run(async () => setPreview(await api.previewMessageTemplate(kind, language, draft)));
  }

  async function reauthenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("wording-reauthentication-password");
    const requested = retry;
    if (typeof password !== "string" || !requested) return;
    setRetry(undefined);
    await run(async () => {
      await api.reauthenticate(password);
      await perform(requested);
    });
  }

  return <section data-testid="admin-message-wording-view" className="surface-panel min-w-0 grid gap-6 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:min-w-0 [&>*]:max-w-5xl sm:p-8">
    <h1 className="text-3xl font-bold">{t("admin.messageWording.title")}</h1>
    <p className="text-muted">{t("admin.messageWording.explain")}</p>
    {!templates || !template || !wording
      ? (error ? <LoadFailure message={error} retry={() => { setError(undefined); retryLoad(); }} /> : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert testId="wording-error">{error}</Alert>}
        {refusals.length > 0 && <Alert testId="wording-refusals"><ul className="grid gap-1">
          {refusals.map((refusal) => <li key={refusal}>{refusal}</li>)}
        </ul></Alert>}
        {success && <SuccessFeedback testId="wording-success">{success}</SuccessFeedback>}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 font-medium">{t("admin.messageWording.kind")}
            <select data-testid="wording-kind" className="form-control w-full min-w-0 rounded-lg border px-3 py-3" value={kind} onChange={(event) => setKind(event.target.value as MessageKind)}>
              {templates.map((candidate) => <option key={candidate.kind} value={candidate.kind}>{t(`messages.kind.${candidate.kind}`)}</option>)}
            </select>
          </label>
          <label className="grid gap-2 font-medium">{t("admin.messageWording.language")}
            <select data-testid="wording-language" className="form-control w-full min-w-0 rounded-lg border px-3 py-3" value={language} onChange={(event) => setLanguage(event.target.value as MessageTemplateLanguage)}>
              {LANGUAGES.map((candidate) => <option key={candidate} value={candidate}>{new Intl.DisplayNames([candidate], { type: "language" }).of(candidate) ?? candidate}</option>)}
            </select>
          </label>
        </div>
        <p data-testid="wording-state" data-own={wording.own ? "true" : "false"}>
          {t(wording.own ? "admin.messageWording.usesOwn" : "admin.messageWording.usesShipped")}
        </p>
        <div className="grid gap-1">
          <p className="font-medium">{t("admin.messageWording.placeholders")}</p>
          <ul data-testid="wording-placeholders" className="flex flex-wrap gap-2">
            {template.placeholders.map((placeholder) => <li key={placeholder} data-required={template.requiredPlaceholders.includes(placeholder) ? "true" : "false"} className="rounded border px-2 py-1 font-mono text-sm">
              {`{${placeholder}}`}{template.requiredPlaceholders.includes(placeholder) && ` ${t("admin.messageWording.required")}`}
            </li>)}
          </ul>
        </div>
        <TextField data-testid="wording-subject" maxLength={200} label={t("admin.messageWording.subject")} value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} />
        <label className="grid gap-2 font-medium">{t("admin.messageWording.body")}
          <textarea data-testid="wording-body" rows={10} maxLength={10000} className="form-control w-full min-w-0 rounded-lg border px-3 py-3 font-mono text-sm" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
        </label>
        <div className="flex flex-wrap gap-3">
          <Button data-testid="wording-preview" variant="secondary" disabled={pending} type="button" onClick={showPreview}>{t("admin.messageWording.preview")}</Button>
          <Button data-testid="wording-save" variant="primary" disabled={pending} type="button" onClick={() => write("save")}>{t("admin.messageWording.save")}</Button>
          <Button data-testid="wording-reset" variant="secondary" disabled={pending || !wording.own} type="button" onClick={() => write("reset")}>{t("admin.messageWording.reset")}</Button>
        </div>
        {preview && <div data-testid="wording-preview-result" className="grid gap-2 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">{t("admin.messageWording.previewTitle")}</h2>
          <p data-testid="wording-preview-subject" className="font-medium [overflow-wrap:anywhere]">{preview.subject}</p>
          <p data-testid="wording-preview-body" className="whitespace-pre-wrap [overflow-wrap:anywhere]">{preview.body}</p>
        </div>}
      </>}
    {retry && <Modal labelledBy="wording-reauthentication-title" closed={() => setRetry(undefined)}>
      <form className="grid gap-4" onSubmit={(event) => void reauthenticate(event)}>
        <h2 id="wording-reauthentication-title" className="text-2xl font-bold">{t("accountSecurity.reauthenticateTitle")}</h2>
        <p>{t("accountSecurity.reauthenticate")}</p>
        <TextField data-testid="wording-reauthentication-password" id="wording-reauthentication-password" name="wording-reauthentication-password" type="password" autoComplete="current-password" required label={t("auth.password")} />
        <Button data-testid="confirm-wording-reauthentication" variant="primary" disabled={pending} type="submit">{t("accountSecurity.continue")}</Button>
      </form>
    </Modal>}
  </section>;
}
