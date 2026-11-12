import { LoadFailure } from "../components/LoadFailure";
import { LoadingGroup, LoadingStatus } from "../components/LoadingGroup";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type MessageChannel, type MessageChannelChoice, type MessageChoice, type MessageKind, type Notification, type NotificationPage } from "../api/client";
import { warnAbout } from "../api/failureWarning";
import { problemMessage } from "../api/problem-message";
import { useClubConfiguration } from "../club/registry";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { announceNotificationsRead } from "../navigation/unreadNotifications";
import { formatBookingPeriod, formatDateTime } from "../time/clubZone";

type Translate = ReturnType<typeof useTranslation>["t"];

const routes: Record<Notification["link"]["target"], (link: Notification["link"]) => string> = {
  BOOKINGS: ({ bookingId }) => bookingId ? `/my-bookings#booking-${bookingId}` : "/my-bookings",
  ACCOUNT_SECURITY: () => "/account/security",
  WAITLIST: ({ waitlistEntryId }) => waitlistEntryId ? `/my-bookings#waitlist-${waitlistEntryId}` : "/my-bookings#waitlist"
};

function summaryOf(notification: Notification, t: Translate) {
  return notification.kind === "BOOKING_DISPLACED" && notification.closure
    ? t(`notifications.closure.${notification.closure}`)
    : t(`notifications.summary.${notification.kind}`);
}

export function NotificationEntry({ notification, timeZone, marking = false, justRead = false, markRead, t, language }: {
  notification: Notification; timeZone: string; marking?: boolean; justRead?: boolean;
  markRead?: (id: string, quietly?: boolean) => void; t: Translate; language: string;
}) {
  const summaryId = useId();
  const item = useRef<HTMLLIElement>(null);
  // The commit that removes the pressed button must already move the focus, or it falls to the page.
  useLayoutEffect(() => {
    if (justRead) item.current?.focus();
  }, [justRead]);
  const read = Boolean(notification.readAt);
  const route = markRead && routes[notification.link.target];
  const booking = notification.booking ?? notification.waitlistOffer?.slot;
  const offer = notification.waitlistOffer;
  return <li ref={item} tabIndex={-1} data-testid={`notification-${notification.id}`} data-read={String(read)}
    data-closure={notification.closure}
    className={`focus-ring border-structural grid gap-1 rounded-xl border p-4 ${read ? "" : "surface-raised border-l-4"}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="font-semibold">{t(`messages.kind.${notification.kind}`)}</span>
      <span data-testid="notification-state" className={read ? "text-muted text-sm" : "rounded-full border px-2 text-sm font-semibold"}>
        {t(read ? "notifications.read" : "notifications.unread")}
      </span>
    </div>
    <p id={summaryId} data-testid="notification-summary">{summaryOf(notification, t)}</p>
    {notification.cancellationReason && <p data-testid="notification-reason">
      {t("notifications.reason", { reason: t(`cancellationReason.${notification.cancellationReason}`) })}
    </p>}
    {booking && <p data-testid="notification-booking" className="text-muted text-sm">
      {formatBookingPeriod(booking.startsAt, booking.endsAt, language, timeZone)}
      {" · "}
      {booking.courts.map((court) => court.name ?? t("court.number", { number: court.number })).join(", ")}
      {booking.cancelled && <>{" · "}{t("myBookings.cancelled")}</>}
    </p>}
    {offer && <p data-testid="notification-offer" data-open={String(offer.open)} className="font-semibold">
      {offer.open
        ? t("notifications.offerOpen", { time: formatDateTime(offer.expiresAt, language, timeZone) })
        : t("notifications.offerClosed")}
    </p>}
    <time data-testid="notification-time" dateTime={notification.createdAt} className="text-muted text-sm">
      {formatDateTime(notification.createdAt, language, timeZone)}
    </time>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
      {route && <Link to={route(notification.link)} aria-describedby={summaryId}
        className="focus-ring inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
        onClick={() => { if (!read) markRead(notification.id, true); }}>
        {t(`notifications.open.${notification.link.target}`)}
      </Link>}
      {!read && markRead && <Button variant="secondary" data-testid="notification-mark-read" aria-describedby={summaryId}
        className="min-h-11 px-3" aria-disabled={marking || undefined}
        onClick={() => { if (!marking) markRead(notification.id); }}>
        {t("notifications.markRead")}
      </Button>}
    </div>
  </li>;
}

type Listing = { items: Notification[]; next?: string };
type Shown = "unread" | "read";

export function NotificationLists({ testId, revision = 0, timeZone, fetchPage, markOne, markAll, failed, read: readAlong, emptyUnread, emptyRead }: {
  testId: string;
  revision?: number;
  timeZone: string;
  fetchPage: (read: boolean, cursor?: string) => Promise<NotificationPage>;
  markOne?: (id: string) => Promise<void>;
  markAll?: () => Promise<void>;
  failed: (cause: unknown) => void;
  read?: () => void;
  emptyUnread: string;
  emptyRead: string;
}) {
  const { t, i18n } = useTranslation();
  const [shown, setShown] = useState<Shown>();
  const shownNow = useRef<Shown>(undefined);
  useLayoutEffect(() => { shownNow.current = shown; }, [shown]);
  const [unread, setUnread] = useState<Listing>();
  const [unreadCount, setUnreadCount] = useState<number>();
  const [read, setRead] = useState<Listing>();
  const [loading, setLoading] = useState<Shown | undefined>("unread");
  const [marking, setMarking] = useState<string>();
  const inFlight = useRef(new Set<string>());
  const [justRead, setJustRead] = useState<string>();
  const [allRead, setAllRead] = useState(false);
  const unreadTab = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const ids = useId();

  const load = useCallback(async (state: Shown, cursor?: string) => {
    const requested = generation.current;
    setLoading(state);
    try {
      const page = await fetchPage(state === "read", cursor);
      if (requested !== generation.current) return;
      const store = state === "read" ? setRead : setUnread;
      store((current) => ({ items: cursor ? [...(current?.items ?? []), ...page.items] : page.items, next: page.nextCursor ?? undefined }));
      setUnreadCount(page.unread);
    } catch (cause) {
      if (requested === generation.current) failed(cause);
    } finally {
      if (requested === generation.current) setLoading(undefined);
    }
  }, [fetchPage, failed]);

  // A new revision reads both lists afresh and keeps the open one open.
  useEffect(() => {
    generation.current += 1;
    setUnread(undefined); setRead(undefined);
    void load("unread");
    if (shownNow.current === "read") void load("read");
    return () => { generation.current += 1; };
  }, [load, revision]);

  function toggle(state: Shown) {
    const opening = shown !== state;
    setShown(opening ? state : undefined);
    setJustRead(undefined); setAllRead(false);
    if (!opening) return;
    // Reopening the unread list drops what was marked read meanwhile; it stayed in place to keep the focus.
    if (state === "unread" && (!unread || unread.items.some((entry) => entry.readAt))) void load("unread");
    if (state === "read" && !read) void load("read");
  }

  // Following a link leaves the page, so a refusal there is only logged rather than shown.
  // A page still in flight was read before the mark, so it must not overwrite what the mark changed.
  function dropPendingLoads() {
    generation.current += 1;
    setLoading(undefined);
  }

  async function markRead(id: string, quietly = false) {
    if (!markOne || inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setMarking(id);
    if (!quietly) { setJustRead(undefined); setAllRead(false); }
    try {
      await markOne(id);
      dropPendingLoads();
      const readAt = new Date().toISOString();
      setUnread((current) => current && { ...current, items: current.items.map((entry) => entry.id === id ? { ...entry, readAt } : entry) });
      setUnreadCount((count) => count === undefined ? count : Math.max(0, count - 1));
      setRead(undefined);
      if (!quietly) setJustRead(id);
      readAlong?.();
    } catch (cause) {
      if (quietly) warnAbout("Notification not marked read", cause);
      else failed(cause);
    } finally {
      inFlight.current.delete(id);
      setMarking(undefined);
    }
  }

  async function markEveryRead() {
    if (!markAll || inFlight.current.has("*")) return;
    inFlight.current.add("*");
    setMarking("*");
    setJustRead(undefined);
    try {
      await markAll();
      dropPendingLoads();
      setUnread({ items: [] });
      setUnreadCount(0);
      setRead(undefined);
      setAllRead(true);
      unreadTab.current?.focus();
      readAlong?.();
    } catch (cause) {
      failed(cause);
    } finally {
      inFlight.current.delete("*");
      setMarking(undefined);
    }
  }

  const listing = shown === "read" ? read : shown === "unread" ? unread : undefined;
  return <div className="grid gap-3">
    <p role="status" data-testid={`${testId}-status`} className="sr-only">
      {justRead ? t("notifications.markedRead") : allRead ? t("notifications.markedAllRead") : ""}
    </p>
    {unreadCount === undefined && loading === "unread" && <LoadingStatus />}
    <div role="group" aria-label={t("notifications.lists")} data-testid={`${testId}-lists`} className="flex flex-wrap gap-2">
      {(["unread", "read"] as const).map((state) => <Button key={state} ref={state === "unread" ? unreadTab : undefined} type="button"
        data-testid={`${testId}-show-${state}`} variant={shown === state ? "primary" : "secondary"}
        aria-expanded={shown === state} aria-controls={`${ids}-${state}`} onClick={() => toggle(state)}>
        {state === "read" ? t("notifications.readList")
          : unreadCount === undefined ? t("notifications.unreadListUncounted") : t("notifications.unreadList", { count: unreadCount })}
      </Button>)}
    </div>
    {shown && <div id={`${ids}-${shown}`} data-testid={`${testId}-${shown}`} className="grid gap-3">
      {!listing && loading === shown && <LoadingStatus />}
      {shown === "unread" && markAll && (unreadCount ?? 0) > 0 && <Button variant="secondary" data-testid={`${testId}-mark-all-read`}
        className="justify-self-start" aria-disabled={marking === "*"} onClick={() => void markEveryRead()}>
        {t("notifications.markAllRead")}
      </Button>}
      {listing && (listing.items.length === 0
        ? <p data-testid={`${testId}-empty`} className="text-muted">{shown === "unread" ? emptyUnread : emptyRead}</p>
        : <ul data-testid={testId} className="grid gap-3">
          {listing.items.map((notification) => <NotificationEntry key={notification.id} notification={notification}
            timeZone={timeZone} marking={marking === notification.id} justRead={justRead === notification.id}
            markRead={markOne && ((id, quietly) => void markRead(id, quietly))} t={t} language={i18n.language} />)}
        </ul>)}
      {listing?.next && <Button variant="secondary" data-testid={`${testId}-load-more`} className="justify-self-start"
        disabled={loading === shown} onClick={() => void load(shown, listing.next)}>{t("notifications.loadMore")}</Button>}
    </div>}
  </div>;
}

function NotificationCentre() {
  const { t } = useTranslation();
  const { club, error: clubError, load: loadClub } = useClubConfiguration();
  const [failure, setFailure] = useState<{ cause: unknown }>();
  const error = failure && problemMessage(failure.cause, t);
  const fetchPage = useCallback(async (read: boolean, cursor?: string) => {
    const page = await api.ownNotifications(cursor, 50, read);
    setFailure(undefined);
    return page;
  }, []);
  const failed = useCallback((cause: unknown) => setFailure({ cause }), []);

  return <section className="grid gap-3" aria-labelledby="notifications-title">
    <h2 id="notifications-title" className="text-2xl font-bold">{t("notifications.title")}</h2>
    {error && <Alert>{error}</Alert>}
    {clubError && <LoadFailure message={clubError} retry={loadClub} />}
    {!clubError && !club && <LoadingStatus />}
    {club && <NotificationLists testId="notifications" timeZone={club.timeZone} fetchPage={fetchPage}
      markOne={api.markNotificationRead} markAll={api.markAllNotificationsRead} failed={failed}
      read={announceNotificationsRead} emptyUnread={t("notifications.noUnread")} emptyRead={t("notifications.noRead")} />}
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
    {error && !(choices && channels) && <Alert>{error}</Alert>}
    {!error && !(choices && channels) && <LoadingStatus />}
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
      <div data-testid="my-messages-actions" className="grid gap-3">
        {error && <Alert>{error}{failure?.reloaded && <> {t("myMessages.savedStateShown")}</>}</Alert>}
        {saved && <SuccessFeedback testId="my-messages-saved">{t("myMessages.saved")}</SuccessFeedback>}
        <div><Button variant="primary" type="button" data-testid="my-messages-save" disabled={pending} onClick={() => void save()}>{t("myMessages.save")}</Button></div>
      </div>
    </>}
  </section>;
}

export function MyMessagesView() {
  const { t } = useTranslation();
  return <section data-testid="my-messages-view" className="surface-panel grid w-full max-w-3xl gap-6 self-start rounded-2xl border p-4 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-3xl font-bold">{t("myMessages.title")}</h1>
    <LoadingGroup testId="my-messages" className="grid gap-6">
      <NotificationCentre />
      <MessageSettings />
    </LoadingGroup>
  </section>;
}
