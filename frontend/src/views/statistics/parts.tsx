import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LoadFailure } from "../../components/LoadFailure";
import { type Change, type ChangeKind, changeOf } from "./change";
import type { StatisticsFormat } from "./format";
import type { Read } from "./useStatisticsRead";

export function Section<T>({ testId, heading, read, children }: {
  testId: string;
  heading: string;
  read: Read<T>;
  children: (value: T) => ReactNode;
}) {
  const { t } = useTranslation();
  return <section data-testid={testId} aria-labelledby={`${testId}-heading`} className="grid min-w-0 gap-6">
    <h2 id={`${testId}-heading`} className="text-2xl font-bold">{heading}</h2>
    {read.value === undefined
      ? read.error ? <LoadFailure message={read.error} retry={read.retry} /> : <p role="status">{t("status.loading")}</p>
      : children(read.value)}
  </section>;
}

const ARROWS = { up: "▲", down: "▼", none: "=" };

function ChangeLine({ testId, kind, change }: { testId: string; kind: ChangeKind; change: Change }) {
  const { t } = useTranslation();
  const value = change.value && kind === "ratio" ? t("admin.statistics.points", { value: change.value }) : change.value;
  return <p data-testid={`${testId}-change`} data-direction={change.direction} className="text-muted flex gap-2 text-sm">
    <span aria-hidden="true">{ARROWS[change.direction]}</span>
    <span>{value === undefined ? t("admin.statistics.unchanged") : t("admin.statistics.change", { value })}</span>
  </p>;
}

export function KeyFigure({ testId, label, value, kind, current, previous, format }: {
  testId: string;
  label: string;
  value: string;
  kind?: ChangeKind;
  current?: number | null;
  previous?: number | null;
  format: StatisticsFormat;
}) {
  const change = kind && current !== undefined ? changeOf(kind, current, previous, format) : undefined;
  return <div data-testid={testId} className="surface-raised grid content-start gap-1 rounded-xl border p-4">
    <dt className="text-muted text-sm font-semibold">{label}</dt>
    <dd data-testid={`${testId}-value`} className="font-value text-2xl font-bold">{value}</dd>
    {change && kind && <dd><ChangeLine testId={testId} kind={kind} change={change} /></dd>}
  </div>;
}

export function KeyFigures({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</dl>;
}

export interface Bar {
  key: string;
  testId: string;
  label: ReactNode;
  ratio: number | null;
  value: string;
  detail?: string;
}

export function BarList({ testId, heading, bars }: { testId: string; heading: string; bars: Bar[] }) {
  return <section data-testid={testId} aria-labelledby={`${testId}-heading`} className="grid gap-3">
    <h3 id={`${testId}-heading`} className="text-lg font-bold">{heading}</h3>
    <ul className="grid gap-3">
      {bars.map((bar) => <li key={bar.key} data-testid={bar.testId}
        className="grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center">
        <span data-testid={`${bar.testId}-label`} className="min-w-0 break-words">{bar.label}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span aria-hidden="true" className="occupancy-bar h-2 w-32 shrink-0 overflow-hidden rounded-full border">
            {bar.ratio !== null
              && <span data-testid={`${bar.testId}-bar`} className="occupancy-bar-fill block h-full"
                style={{ width: `${Math.round(Math.min(1, Math.max(0, bar.ratio)) * 100)}%` }} />}
          </span>
          <span data-testid={`${bar.testId}-value`} className="font-value font-semibold">{bar.value}</span>
          {bar.detail && <span className="text-muted text-sm">{bar.detail}</span>}
        </span>
      </li>)}
    </ul>
  </section>;
}

export function Note({ testId, children }: { testId: string; children: ReactNode }) {
  return <p data-testid={testId} className="text-muted text-sm">{children}</p>;
}
