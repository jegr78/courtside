import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type MessageChannel, type MessageChannelChoice, type MessageChoice, type MessageKind, type Notification } from "../api/client";
import { warnAbout } from "../api/failureWarning";
import { problemMessage } from "../api/problem-message";
import { useClubConfiguration } from "../club/registry";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { announceNotificationsRead } from "../navigation/unreadNotifications";
import { formatBookingPeriod, formatDateTime } from "../time/clubZone";

type Translate = ReturnType<typeof useTranslation>["t"];

const routes: Record<Notification["link"]["target"], (bookingId?: string) => string> = {
  BOOKINGS: (bookingId) => bookingId ? `/my-bookings#booking-${bookingId}` : "/my-bookings",
  ACCOUNT_SECURITY: () => "/account/security"
};

function summaryOf(notification: Notification, t: Translate) {
  return notification.kind === "BOOKING_DISPLACED" && notification.closure
    ? t(`notifications.closure.${notification.closure}`)
    : t(`notifications.summary.${notification.kind}`);
}

function NotificationEntry({ notification, timeZone, marking, justRead, markRead, t, language }: {
  notification: Notification; timeZone: string; marking: boolean; justRead: boolean;
  markRead: (id: string, quietly?: boolean) => void; t: Translate; language: string;
}) {
  const summaryId = useId();
  const item = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (justRead) item.current?.focus();
  }, [justRead]);
  const read = Boolean(notification.readAt);
  const route = routes[notification.link.target];
  const booking = notification.booking;
  return <li ref={item} tabIndex={-1} data-testid={`notification-${notification.id}`} data-read={String(read)}
    className={`focus-ring border-structural grid gap-1 rounded-xl border p-4 ${read ? "" : "surface-raised border-l-4"}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="font-semibold">{t(`messages.kind.${notification.kind}`)}</span>
      <span data-testid="notification-state" className={read ? "text-muted text-sm" : "rounded-full border px-2 text-sm font-semibold"}>
        {t(read ? "notifications.read" : "notifications.unread")}
      </span>
    </div>
    <p id={summaryId} data-testid="notification-summary">{summaryOf(notification, t)}</p>
    {booking && <p data-testid="notification-booking" className="text-muted text-sm">
      {formatBookingPeriod(booking.startsAt, booking.endsAt, language, timeZone)}
      {" · "}
      {booking.courts.map((court) => court.name ?? t("court.number", { number: court.number })).join(", ")}
      {booking.cancelled && <>{" · "}{t("myBookings.cancelled")}</>}
    </p>}
    <time data-testid="notification-time" dateTime={notification.createdAt} className="text-muted text-sm">
      {formatDateTime(notification.createdAt, language, timeZone)}
    </time>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
      {route && <Link to={route(notification.link.bookingId)} aria-describedby={summaryId}
        className="focus-ring inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
        onClick={() => { if (!read) markRead(notification.id, true); }}>
        {t(`notifications.open.${notification.link.target}`)}
      </Link>}
      {!read && <Button variant="secondary" data-testid="notification-mark-read" aria-describedby={summaryId}
        className="min-h-11 px-3" disabled={marking} onClick={() => markRead(notification.id)}>
        {t("notifications.markRead")}
      </Button>}
    </div>
  </li>;
}

function NotificationCentre() {
  const { t, i18n } = useTranslation();
  const { club } = useClubConfiguration();
  const [entries, setEntries] = useState<Notification[]>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [marking, setMarking] = useState<string>();
  const [justRead, setJustRead] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<{ cause: unknown }>();
  const error = failure && problemMessage(failure.cause, t);

  const load = useCallback(async (cursor?: string) => {
    const page = await api.ownNotifications(cursor);
    setEntries((current) => cursor ? [...(current ?? []), ...page.items] : page.items);
    setNextCursor(page.nextCursor ?? undefined);
  }, []);

  useEffect(() => {
    load().catch((cause: unknown) => setFailure({ cause }));
  }, [load]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      await load(nextCursor);
      setFailure(undefined);
    } catch (cause) {
      setFailure({ cause });
    } finally {
      setLoadingMore(false);
    }
  }

  // Following a link leaves the page, so a refusal there is only logged rather than shown.
  async function markRead(id: string, quietly = false) {
    setMarking(id);
    if (!quietly) setJustRead(undefined);
    try {
      await api.markNotificationRead(id);
      const readAt = new Date().toISOString();
      setEntries((current) => current?.map((entry) => entry.id === id ? { ...entry, readAt } : entry));
      if (!quietly) setJustRead(id);
      setFailure(undefined);
      announceNotificationsRead();
    } catch (cause) {
      if (quietly) warnAbout("Notification not marked read", cause);
      else setFailure({ cause });
    } finally {
      setMarking(undefined);
    }
  }

  return <section className="grid gap-3" aria-labelledby="notifications-title">
    <h2 id="notifications-title" className="text-2xl font-bold">{t("notifications.title")}</h2>
    {error && <Alert>{error}</Alert>}
    <p role="status" data-testid="notifications-status" className="sr-only">{justRead && t("notifications.markedRead")}</p>
    {entries && club && (entries.length === 0
      ? <p data-testid="notifications-empty" className="text-muted">{t("notifications.empty")}</p>
      : <ul data-testid="notifications" className="grid gap-3">
        {entries.map((notification) => <NotificationEntry key={notification.id} notification={notification}
          timeZone={club.timeZone} marking={marking === notification.id} justRead={justRead === notification.id} markRead={(id, quietly) => void markRead(id, quietly)}
          t={t} language={i18n.language} />)}
      </ul>)}
    {nextCursor && <Button variant="secondary" data-testid="notifications-load-more" className="justify-self-start"
      disabled={loadingMore} onClick={() => void loadMore()}>{t("notifications.loadMore")}</Button>}
  </section>;
}

function MessageChoiceGroup({ heading, note, choices, pending, receive }: {
  heading: string;
  note?: string;
  choices: MessageChoice[];
  pending: boolean;
  receive: (kind: MessageKind, enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  return <section className="grid gap-2">
    <h3 className="text-lg font-semibold">{heading}</h3>
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

function MessageSettings() {
  const { t } = useTranslation();
  const [choices, setChoices] = useState<MessageChoice[]>();
  const [channels, setChannels] = useState<MessageChannelChoice[]>();
  const [failure, setFailure] = useState<{ cause: unknown; reloaded?: boolean }>();
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const error = failure && problemMessage(failure.cause, t);

  // The failure is held as it arrived rather than as a sentence, so switching language re-reads it
  // instead of re-reading the choices and dropping whatever is ticked but not yet saved.
  useEffect(() => {
    Promise.all([api.ownMessageChoices(), api.ownMessageChannels()])
      .then(([kinds, ways]) => {
        setChoices(kinds);
        setChannels(ways);
        setFailure(undefined);
      })
      .catch((cause: unknown) => setFailure({ cause }));
  }, []);

  function receive(kind: MessageKind, enabled: boolean) {
    setSaved(false);
    setChoices((current) => current?.map((choice) => choice.kind === kind ? { ...choice, enabled } : choice));
  }

  function use(channel: MessageChannel, enabled: boolean) {
    setSaved(false);
    setChannels((current) => current?.map((choice) => choice.channel === channel ? { ...choice, enabled } : choice));
  }

  async function save() {
    if (!choices || !channels) return;
    setPending(true);
    try {
      await api.chooseOwnMessages(choices.filter((choice) => !choice.enabled).map((choice) => choice.kind));
      await api.chooseOwnMessageChannels(channels.filter((choice) => !choice.enabled).map((choice) => choice.channel));
      setFailure(undefined);
      setSaved(true);
    } catch (cause) {
      setSaved(false);
      setFailure({ cause, reloaded: await reloadSaved() });
    } finally {
      setPending(false);
    }
  }

  // The two choices are stored one after the other, so after a failure only the instance knows which one took.
  async function reloadSaved() {
    try {
      const [kinds, ways] = await Promise.all([api.ownMessageChoices(), api.ownMessageChannels()]);
      setChoices(kinds);
      setChannels(ways);
      return true;
    } catch (failure) {
      warnAbout("Saved message choices unavailable", failure);
      return false;
    }
  }

  return <section className="border-structural grid gap-6 border-t pt-6" aria-labelledby="message-settings-title">
    <h2 id="message-settings-title" className="text-2xl font-bold">{t("myMessages.settings")}</h2>
    <p className="text-muted">{t("myMessages.description")}</p>
    {error && <Alert>{error}{failure?.reloaded && <> {t("myMessages.savedStateShown")}</>}</Alert>}
    {saved && <SuccessFeedback testId="my-messages-saved">{t("myMessages.saved")}</SuccessFeedback>}
    {choices && channels && <>
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
      <section className="grid gap-2">
        <h3 className="text-lg font-semibold">{t("myMessages.channels")}</h3>
        <p data-testid="message-channels-reason" className="text-muted text-sm">{t("myMessages.channelsReason")}</p>
        <ul className="grid gap-2">
          {channels.map((choice) => <li key={choice.channel}>
            <label className="flex items-center gap-3 font-medium">
              <input type="checkbox" className="size-5" data-testid={`message-channel-${choice.channel}`}
                disabled={pending} checked={choice.enabled}
                onChange={(event) => use(choice.channel, event.target.checked)} />
              {t(`myMessages.channel.${choice.channel}`)}
            </label>
          </li>)}
        </ul>
      </section>
      <div><Button variant="primary" type="button" data-testid="my-messages-save" disabled={pending} onClick={() => void save()}>{t("myMessages.save")}</Button></div>
    </>}
  </section>;
}

export function MyMessagesView() {
  const { t } = useTranslation();
  return <section data-testid="my-messages-view" className="surface-panel grid w-full max-w-3xl gap-6 self-start rounded-2xl border p-4 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-3xl font-bold">{t("myMessages.title")}</h1>
    <NotificationCentre />
    <MessageSettings />
  </section>;
}
