import { useLayoutEffect, useRef } from "react";
import { NavigationType, useLocation, useNavigationType } from "react-router-dom";

export function PageScroll() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const shown = useRef(pathname);

  useLayoutEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    if (navigationType !== NavigationType.Pop) window.scrollTo(0, 0);
  }, [pathname, navigationType]);

  return null;
}
