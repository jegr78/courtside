import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type MessageChoice, type MessageKind } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { SuccessFeedback } from "../components/SuccessFeedback";

function MessageChoiceGroup({ heading, note, choices, pending, receive }: {
  heading: string;
  note?: string;
  choices: MessageChoice[];
  pending: boolean;
  receive: (kind: MessageKind, enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  return <section className="grid gap-2">
    <h2 className="text-lg font-semibold">{heading}</h2>
    {note && <p className="text-muted text-sm">{note}</p>}
    <ul className="grid gap-2">
      {choices.map((choice) => <li key={choice.kind}>
        <label className="flex items-center gap-3 font-medium">
          <input
            type="checkbox"
            className="size-5"
            data-testid={`message-choice-${choice.kind}`}
            disabled={!choice.declinable || pending}
            checked={choice.enabled}
            onChange={(event) => receive(choice.kind, event.target.checked)}
          />
          {t(`messages.kind.${choice.kind}`)}
        </label>
      </li>)}
    </ul>
  </section>;
}

export function MyMessagesView() {
  const { t } = useTranslation();
  const [choices, setChoices] = useState<MessageChoice[]>();
  const [failure, setFailure] = useState<{ cause: unknown }>();
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const error = failure && problemMessage(failure.cause, t);

  // The failure is held as it arrived rather than as a sentence, so switching language re-reads it
  // instead of re-reading the choices and dropping whatever is ticked but not yet saved.
  useEffect(() => {
    api.ownMessageChoices()
      .then((current) => {
        setChoices(current);
        setFailure(undefined);
      })
      .catch((cause: unknown) => setFailure({ cause }));
  }, []);

  function receive(kind: MessageKind, enabled: boolean) {
    setSaved(false);
    setChoices((current) => current?.map((choice) => choice.kind === kind ? { ...choice, enabled } : choice));
  }

  async function save() {
    if (!choices) return;
    setPending(true);
    try {
      await api.chooseOwnMessages(choices.filter((choice) => !choice.enabled).map((choice) => choice.kind));
      setFailure(undefined);
      setSaved(true);
    } catch (cause) {
      setSaved(false);
      setFailure({ cause });
    } finally {
      setPending(false);
    }
  }

  return <section data-testid="my-messages-view" className="surface-panel grid w-full max-w-3xl gap-6 self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-3xl font-bold">{t("myMessages.title")}</h1>
    <p className="text-muted">{t("myMessages.description")}</p>
    {error && <Alert>{error}</Alert>}
    {saved && <SuccessFeedback testId="my-messages-saved">{t("myMessages.saved")}</SuccessFeedback>}
    {choices && <>
      <MessageChoiceGroup
        heading={t("myMessages.declinable")}
        choices={choices.filter((choice) => choice.declinable)}
        pending={pending}
        receive={receive}
      />
      <MessageChoiceGroup
        heading={t("myMessages.mandatory")}
        note={t("myMessages.mandatoryReason")}
        choices={choices.filter((choice) => !choice.declinable)}
        pending={pending}
        receive={receive}
      />
      <div><Button variant="primary" type="button" data-testid="my-messages-save" disabled={pending} onClick={() => void save()}>{t("myMessages.save")}</Button></div>
    </>}
  </section>;
}
