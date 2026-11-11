import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, type CreditEntry, type CreditEntryRequest, type CreditEntryRequestKind, type CreditHolder, type CreditPageOptions, type PayPalRefundOption, type PayPalRefundStatus } from "../api/client";
import { idempotencyKey } from "../api/idempotency";
import { problemMessage } from "../api/problem-message";
import { useClubConfiguration } from "../club/registry";
import { Alert } from "../components/Alert";
import type { AlertTone } from "../components/noticeTones";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { ReauthenticationCode } from "../components/ReauthenticationCode";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { TextField } from "../components/TextField";
import { useReportedFailure } from "../failures/useReportedFailure";
import { formString } from "../forms/formString";
import { formatMinor, parseMinor } from "../money";
import { PERSON_SEARCH_DEBOUNCE_MS, PERSON_SEARCH_MIN_LENGTH } from "../person-search";
import { reauthenticateForm } from "../security/reauthentication";
import { useProofContinuation } from "../security/useProofContinuation";
import { securityKeyFailure } from "../security/webauthn";
import { useUnsavedForm } from "../unsaved/useUnsavedForm";
import { CreditLedger, type PayPalRefunds } from "./CreditLedger";
import { useCreditLedger } from "./useCreditLedger";

const RECENT_AUTH = "urn:courtside:error:recent-authentication-required";
const KINDS: CreditEntryRequestKind[] = ["CREDIT", "PAYOUT"];
const LARGEST_ENTRY_MINOR = 1_000_000;
const NOTE_LENGTH = 200;

function searchTerm(query: string): string | undefined {
  const trimmed = query.trim();
  return trimmed.length >= PERSON_SEARCH_MIN_LENGTH ? trimmed : undefined;
}

export function AdminCreditView() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "de";
  const [query, setQuery] = useState("");
  const [holders, setHolders] = useState<CreditHolder[]>();
  const [listed, setListed] = useState(0);
  const [chosen, setChosen] = useState<CreditHolder>();
  const { message: listError, report: reportList, clear: clearList } = useReportedFailure();
  const term = searchTerm(query);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      void api.creditHolders(term).then((read) => {
        if (!active) return;
        clearList();
        setHolders(read);
      }).catch((failure: unknown) => { if (active) reportList(failure); });
    }, term === undefined ? 0 : PERSON_SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [term, listed, clearList, reportList]);

  return <section data-testid="admin-credit-view" className="surface-panel grid min-w-0 gap-8 rounded-2xl border p-4 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:max-w-5xl sm:p-8">
    <div className="grid gap-3">
      <h1 className="text-3xl font-bold">{t("admin.credit.title")}</h1>
      <p className="text-muted">{t("admin.credit.explain")}</p>
    </div>
    <div className="grid gap-2">
      <TextField data-testid="credit-search" type="search" maxLength={100} label={t("admin.credit.search")}
        value={query} onChange={(event) => setQuery(event.target.value)} aria-describedby="credit-search-help" />
      <p id="credit-search-help" className="text-muted text-sm">{t("admin.credit.searchHelp")}</p>
    </div>
    {listError && <Alert testId="credit-holders-error">{listError}</Alert>}
    {holders && <section aria-labelledby="credit-holders-title" className="grid min-w-0 gap-3">
      <h2 id="credit-holders-title" className="text-2xl font-bold">{t(term ? "admin.credit.results" : "admin.credit.holders")}</h2>
      {holders.length === 0
        ? <p data-testid="credit-holders-empty">{t(term ? "admin.credit.noResults" : "admin.credit.noHolders")}</p>
        : <div className="min-w-0 overflow-x-auto">
          <table data-testid="credit-holders" className="w-full text-left">
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4">{t("admin.credit.holder")}</th>
                <th scope="col" className="py-2 pr-4">{t("admin.credit.email")}</th>
                <th scope="col" className="py-2 text-right">{t("admin.credit.balance")}</th>
              </tr>
            </thead>
            <tbody>
              {holders.map((holder) => <tr key={holder.accountId} data-testid="credit-holder" className="border-b">
                <td className="py-2 pr-4">
                  <button type="button" data-testid="credit-holder-open" aria-pressed={chosen?.accountId === holder.accountId}
                    className="focus-ring rounded font-semibold underline underline-offset-4" onClick={() => setChosen(holder)}>
                    {`${holder.lastName}, ${holder.firstName}`}
                  </button>
                </td>
                <td className="py-2 pr-4 [overflow-wrap:anywhere]">{holder.email}</td>
                <td data-testid="credit-holder-balance" className="py-2 text-right whitespace-nowrap">
                  {formatMinor(holder.balanceMinor, language, holder.currency)}
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>}
    </section>}
    {chosen && <CreditAccount key={chosen.accountId} holder={chosen} recorded={() => setListed((count) => count + 1)} />}
  </section>;
}

// Only an application refusal proves nothing was recorded; any other failure may follow a recorded entry.
function refusedByTheLedger(failure: unknown): boolean {
  return failure instanceof ApiError && failure.status >= 400 && failure.status < 500 && failure.status !== 408
    && failure.status !== 429 && (failure.problem?.type.startsWith("urn:courtside:error:") ?? false);
}

const OUTCOME_TONES: Record<PayPalRefundStatus, AlertTone> = { COMPLETED: "success", PENDING: "warning", FAILED: "error" };

function CreditAccount({ holder, recorded }: { holder: CreditHolder; recorded: () => void }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "de";
  const { club } = useClubConfiguration();
  const { accountId } = holder;
  const load = useCallback((options: CreditPageOptions) => api.creditEntries(accountId, options), [accountId]);
  const ledger = useCreditLedger(load);
  const entryForm = useUnsavedForm(`credit:${accountId}`);
  const proofContinuation = useProofContinuation(accountId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [retry, setRetry] = useState<{ send: () => Promise<void> }>();
  const unanswered = useRef<{ entry: CreditEntryRequest; key: string }>(undefined);
  const [refundOptions, setRefundOptions] = useState<ReadonlyMap<string, PayPalRefundOption>>(new Map());
  const [refundOptionsFailure, setRefundOptionsFailure] = useState<string>();
  const [refunding, setRefunding] = useState<CreditEntry>();
  const [refundError, setRefundError] = useState<string>();
  const [refundOutcome, setRefundOutcome] = useState<{ tone: AlertTone; text: string }>();
  const [reauthenticationFailure, setReauthenticationFailure] = useState<string>();
  const currency = ledger.page?.currency ?? club?.currency ?? holder.currency;
  const name = `${holder.firstName} ${holder.lastName}`;

  const loadRefundOptions = useCallback(async () => {
    try {
      const read = await api.payPalRefundOptions(accountId);
      setRefundOptions(new Map(read.items.map((option) => [option.orderId, option])));
      setRefundOptionsFailure(undefined);
    } catch (failure) {
      setRefundOptionsFailure(problemMessage(failure, t));
    }
  }, [accountId, t]);

  useEffect(() => { void loadRefundOptions(); }, [loadRefundOptions]);

  async function refund(orderId: string) {
    setPending(true);
    setRefundError(undefined);
    setRefundOutcome(undefined);
    try {
      const refunded = await api.refundPayPalPayment(orderId);
      setRefunding(undefined);
      setRefundOutcome({ tone: OUTCOME_TONES[refunded.status],
        text: t(`paypalRefund.state.${refunded.status}`, { reason: refunded.failureReason ?? "" }) });
      recorded();
      await Promise.all([ledger.reload(), loadRefundOptions()]);
    } catch (failure) {
      if (failure instanceof ApiError && failure.problem?.type === RECENT_AUTH) {
        setRetry({ send: () => refund(orderId) });
      } else {
        setRefundError(problemMessage(failure, t));
        await Promise.all([ledger.reload(), loadRefundOptions()]);
      }
    } finally {
      setPending(false);
    }
  }

  async function send(entry: CreditEntryRequest, key: string) {
    setPending(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      await api.recordCreditEntry(accountId, entry, key);
      unanswered.current = undefined;
      entryForm.form.ref.current?.reset();
      entryForm.saved();
      setSuccess(t("admin.credit.recorded"));
      recorded();
      await ledger.reload();
    } catch (failure) {
      if (failure instanceof ApiError && failure.problem?.type === RECENT_AUTH) {
        setRetry({ send: () => send(entry, key) });
      } else {
        if (refusedByTheLedger(failure)) unanswered.current = undefined;
        setError(problemMessage(failure, t));
      }
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const kind = formString(data, "kind") === "PAYOUT" ? "PAYOUT" : "CREDIT";
    const amountMinor = parseMinor(formString(data, "amount"), currency);
    const note = formString(data, "note").trim();
    setSuccess(undefined);
    if (amountMinor === undefined || amountMinor < 1 || amountMinor > LARGEST_ENTRY_MINOR) {
      setError(t("admin.credit.amountInvalid"));
      return;
    }
    if (!note) {
      setError(t("admin.credit.noteRequired"));
      return;
    }
    const entry: CreditEntryRequest = { kind, amountMinor, note };
    const previous = unanswered.current;
    const repeated = previous && previous.entry.kind === kind && previous.entry.amountMinor === amountMinor
      && previous.entry.note === note;
    const key = repeated ? previous.key : idempotencyKey();
    unanswered.current = { entry, key };
    void send(entry, key);
  }

  async function reauthenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("admin-reauthentication-password");
    const requested = retry;
    if (typeof password !== "string" || !requested || pending) return;
    const ownsProof = proofContinuation.begin();
    setPending(true);
    setReauthenticationFailure(undefined);
    try {
      await reauthenticateForm(event.currentTarget, password);
    } catch (failure) {
      if (!ownsProof()) return;
      setReauthenticationFailure(securityKeyFailure(failure, t) ?? problemMessage(failure, t));
      setPending(false);
      return;
    }
    if (!ownsProof()) return;
    setRetry(undefined);
    await requested.send();
  }

  const refunds: PayPalRefunds = {
    options: refundOptions,
    busy: pending,
    request: (entry) => {
      setRefundError(undefined);
      setRefundOutcome(undefined);
      setRefunding(entry);
    }
  };

  return <section data-testid="credit-account" aria-labelledby="credit-account-title" className="grid min-w-0 gap-6 rounded-xl border p-4 sm:p-6">
    <h2 id="credit-account-title" className="text-2xl font-bold [overflow-wrap:anywhere]">{t("admin.credit.ledgerOf", { name })}</h2>
    {refundOptionsFailure && <Alert testId="paypal-refund-options-error">{refundOptionsFailure}</Alert>}
    {refundOutcome && <Alert tone={refundOutcome.tone} testId="paypal-refund-outcome">{refundOutcome.text}</Alert>}
    <CreditLedger ledger={ledger} refunds={refunds} />
    <form noValidate {...entryForm.form} onSubmit={submit} data-testid="credit-form" aria-labelledby="credit-entry-title"
      className="grid gap-3 rounded-xl border p-4">
      <h3 id="credit-entry-title" className="text-xl font-bold">{t("admin.credit.entryTitle")}</h3>
      {error && <Alert testId="credit-form-error">{error}</Alert>}
      {success && <SuccessFeedback testId="credit-form-success">{success}</SuccessFeedback>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-2 font-medium">
          {t("admin.credit.kind")}
          <select data-testid="credit-form-kind" name="kind" disabled={pending} className="form-control min-w-0 rounded-lg border px-3 py-3">
            {KINDS.map((kind) => <option key={kind} value={kind}>{t(`creditLedger.kind.${kind}`)}</option>)}
          </select>
        </label>
        <TextField data-testid="credit-form-amount" name="amount" inputMode="decimal" autoComplete="off" required disabled={pending}
          label={t("admin.credit.amount", { currency })} />
      </div>
      <TextField data-testid="credit-form-note" name="note" required maxLength={NOTE_LENGTH} disabled={pending}
        label={t("admin.credit.note")} aria-describedby="credit-form-note-help" />
      <p id="credit-form-note-help" className="text-muted text-sm">{t("admin.credit.noteHelp")}</p>
      <Button variant="primary" data-testid="credit-form-submit" type="submit" disabled={pending} className="justify-self-start">
        {t("admin.credit.record")}
      </Button>
    </form>
    {refunding?.paypalOrderId && !retry && <Modal labelledBy="paypal-refund-title" closed={() => setRefunding(undefined)}>
      <div className="grid gap-4">
        <h2 id="paypal-refund-title" className="text-2xl font-bold">{t("paypalRefund.action")}</h2>
        <p>{t("paypalRefund.confirm", { amount: formatMinor(refunding.amountMinor, language, refunding.currency) })}</p>
        {refundError && <Alert testId="paypal-refund-error">{refundError}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" data-testid="paypal-refund-confirm" type="button" disabled={pending}
            onClick={() => void refund(refunding.paypalOrderId ?? "")}>{t("paypalRefund.confirmAction")}</Button>
          <Button variant="secondary" data-testid="paypal-refund-cancel" type="button" onClick={() => setRefunding(undefined)}>
            {t("paypalRefund.cancel")}
          </Button>
        </div>
      </div>
    </Modal>}
    {retry && <Modal labelledBy="admin-reauthentication-title" closed={() => {
      proofContinuation.cancel();
      setPending(false);
      setRetry(undefined);
      setReauthenticationFailure(undefined);
    }}>
      <form className="grid gap-4" onSubmit={(event) => void reauthenticate(event)}>
        <h2 id="admin-reauthentication-title" className="text-2xl font-bold">{t("accountSecurity.reauthenticateTitle")}</h2>
        <p>{t("accountSecurity.reauthenticate")}</p>
        {reauthenticationFailure && <Alert testId="admin-reauthentication-failure">{reauthenticationFailure}</Alert>}
        <TextField data-testid="admin-reauthentication-password" id="admin-reauthentication-password" name="admin-reauthentication-password"
          type="password" autoComplete="current-password" required label={t("auth.password")} />
        <ReauthenticationCode />
        <Button data-testid="admin-reauthentication-submit" variant="primary" disabled={pending} type="submit">{t("accountSecurity.continue")}</Button>
      </form>
    </Modal>}
  </section>;
}
