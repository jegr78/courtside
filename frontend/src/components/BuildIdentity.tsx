import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SourceOffer } from "../api/client";
import { Button } from "./Button";

interface BuildIdentityProps {
  source?: SourceOffer;
}

interface EnvironmentMarkerProps extends BuildIdentityProps {
  identityStatus?: "loading" | "available" | "unavailable";
}

function shortIdentity(source?: SourceOffer): string | undefined {
  if (!source) {
    return undefined;
  }
  return `v${source.version}${source.commit ? ` · ${source.commit.slice(0, 7)}` : ""}`;
}

function diagnosticText(source: SourceOffer): string {
  return [
    `Courtside ${source.version}`,
    ...(source.commit ? [`Commit: ${source.commit}`] : []),
    `Environment: ${source.environment}`,
    `Source: ${source.sourceUrl}`
  ].join("\n");
}

export function BuildIdentity({ source }: BuildIdentityProps) {
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(false);
  const [isCopied, setCopied] = useState(false);
  const [isCopying, setCopying] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      dialog.current?.showModal();
    }
  }, [isOpen]);

  async function copyDiagnostics() {
    if (!source) {
      return;
    }
    setCopied(false);
    setCopyFailed(false);
    setCopying(true);
    try {
      await navigator.clipboard.writeText(diagnosticText(source));
      setCopied(true);
    } catch {
      setCopyFailed(true);
    } finally {
      setCopying(false);
    }
  }

  return <>
    <Button
      variant="secondary"
      type="button"
      ref={opener}
      data-testid="build-identity"
      className="px-3 py-2"
      disabled={!source}
      onClick={() => source && setOpen(true)}
    >{shortIdentity(source) ?? t("build.unavailable")}</Button>
    {isOpen && source && <dialog
      ref={dialog}
      aria-labelledby="build-dialog-title"
      className="surface-panel m-auto w-full max-w-md rounded-xl border p-6 text-left shadow-xl backdrop:bg-(--cs-overlay)"
      onClose={() => {
        setOpen(false);
        opener.current?.focus();
      }}
    >
      <h2 id="build-dialog-title" className="text-xl font-bold">{t("build.about")}</h2>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 break-all">
        <dt>{t("build.version")}</dt><dd>{source.version}</dd>
        {source.commit && <><dt>{t("build.commit")}</dt><dd>{source.commit}</dd></>}
        <dt>{t("build.environment")}</dt><dd>{source.environment}</dd>
      </dl>
      <a className="mt-4 inline-block underline hover:no-underline" href={source.sourceUrl}>{t("footer.source")}</a>
      {copyFailed && <p role="alert" className="mt-4 text-sm text-red-800 dark:text-red-200">{t("build.copyFailed")}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="primary" type="button" autoFocus data-testid="copy-build-identity" className="px-4 py-2" disabled={isCopying} onClick={() => void copyDiagnostics()}>
          {isCopied ? t("build.copied") : t("build.copy")}
        </Button>
        <Button variant="secondary" type="button" data-testid="close-build-identity" className="px-4 py-2" onClick={() => dialog.current?.close()}>{t("build.close")}</Button>
      </div>
    </dialog>}
  </>;
}

export function EnvironmentMarker({ source, identityStatus = "available" }: EnvironmentMarkerProps) {
  const { t } = useTranslation();
  if (identityStatus !== "available") {
    return <div data-testid="environment-warning" role="alert" className="bg-red-200 px-5 py-2 text-center font-semibold text-red-950">
      {t(identityStatus === "loading" ? "environment.loading" : "environment.unavailable")}
    </div>;
  }
  return source?.environment === "UAT" || source?.environment === "PERFORMANCE"
    ? <div data-testid="environment-marker" role="status" className="bg-amber-200 px-5 py-2 text-center font-semibold text-amber-950">
      {t(source.environment === "UAT" ? "environment.uat" : "environment.performance")}
    </div>
    : null;
}
