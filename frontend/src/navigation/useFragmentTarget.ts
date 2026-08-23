import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export function useFragmentTarget(targetId: string, ready: boolean) {
  const { hash } = useLocation();

  useEffect(() => {
    if (!ready || hash !== `#${targetId}`) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView?.({ block: "start" });
    target.focus({ preventScroll: true });
  }, [hash, ready, targetId]);
}
