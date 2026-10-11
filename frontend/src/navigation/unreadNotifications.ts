import { useEffect, useReducer, useState } from "react";
import { api } from "../api/client";
import { warnAbout } from "../api/failureWarning";

const NOTIFICATIONS_READ = "courtside:notifications-read";

export function announceNotificationsRead() {
  window.dispatchEvent(new Event(NOTIFICATIONS_READ));
}

// Read again on every page change and every mark, so the count never trails what the centre shows.
export function useUnreadNotifications(authenticated: boolean, pathname: string): number {
  const [unread, setUnread] = useState(0);
  const [marks, marked] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_READ, marked);
    return () => window.removeEventListener(NOTIFICATIONS_READ, marked);
  }, []);

  useEffect(() => {
    if (!authenticated) {
      setUnread(0);
      return;
    }
    let current = true;
    api.ownNotifications(undefined, 1)
      .then((page) => { if (current) setUnread(page.unread); })
      .catch((failure: unknown) => {
        if (current) setUnread(0);
        warnAbout("Unread notifications unavailable", failure);
      });
    return () => { current = false; };
  }, [authenticated, pathname, marks]);

  return authenticated ? unread : 0;
}
