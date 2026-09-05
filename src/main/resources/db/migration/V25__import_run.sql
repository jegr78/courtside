CREATE TABLE import_run (
    id                      uuid        PRIMARY KEY,
    source_id               uuid        NOT NULL REFERENCES import_source,
    preview_id              uuid        NOT NULL REFERENCES import_preview,
    mode                    text        NOT NULL,
    file_hash               text        NOT NULL,
    created_count           integer     NOT NULL,
    corrected_count         integer     NOT NULL,
    ended_count             integer     NOT NULL,
    accounts_disabled_count integer     NOT NULL,
    roles_removed_count     integer     NOT NULL,
    row_error_count         integer     NOT NULL,
    removals_confirmed      boolean     NOT NULL,
    executed_at             timestamptz NOT NULL,
    -- No foreign key: a run records who ran it, and section 11 lets that person go.
    executed_by_account_id  uuid        NOT NULL,
    CONSTRAINT import_run_mode_known CHECK (mode IN ('FULL_SNAPSHOT', 'UPDATE_ONLY')),
    CONSTRAINT import_run_file_hash_shape CHECK (file_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT import_run_counts_not_negative
        CHECK (created_count >= 0 AND corrected_count >= 0 AND ended_count >= 0
               AND accounts_disabled_count >= 0 AND roles_removed_count >= 0
               AND row_error_count >= 0),
    CONSTRAINT import_run_one_per_preview UNIQUE (preview_id)
);

CREATE INDEX import_run_by_source ON import_run (source_id, executed_at DESC);
