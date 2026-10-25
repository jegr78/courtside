export function ScrollContinuation({ continues, testId, above = false }: { continues: boolean; testId: string; above?: boolean }) {
  return <div className="dialog-end">
    {continues && <div data-testid={testId} aria-hidden="true" className="dialog-continues">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={above ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
      </svg>
    </div>}
  </div>;
}
