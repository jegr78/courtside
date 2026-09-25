import { lazy, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { LoadFailure } from "../components/LoadFailure";

export function lazySurface<P extends object>(load: () => Promise<{ default: ComponentType<P> }>,
  reload: () => void = () => window.location.reload()) {
  function SurfaceUnavailable() {
    const { t } = useTranslation();
    return <div className="w-full max-w-7xl">
      <LoadFailure message={t("error.surfaceUnavailable")} retry={reload} />
    </div>;
  }
  return lazy(() => load().catch(() => ({ default: SurfaceUnavailable as ComponentType<P> })));
}
