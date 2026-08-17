CREATE TABLE import_preview (
    id                    uuid        PRIMARY KEY,
    source_id             uuid        NOT NULL REFERENCES import_source ON DELETE CASCADE,
    mode                  text        NOT NULL,
    file_name             text        NOT NULL,
    file_hash             text        NOT NULL,
    row_count             integer     NOT NULL,
    change_set            jsonb,
    fingerprints          jsonb,
    raw_content           bytea,
    removal_count         integer     NOT NULL,
    removal_percent       integer     NOT NULL,
    created_at            timestamptz NOT NULL,
    created_by_account_id uuid        NOT NULL REFERENCES user_account,
    expires_at            timestamptz NOT NULL,
    superseded_at         timestamptz,
    CONSTRAINT import_preview_mode_known CHECK (mode IN ('FULL_SNAPSHOT', 'UPDATE_ONLY')),
    CONSTRAINT import_preview_file_hash_shape CHECK (file_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT import_preview_file_name_not_blank CHECK (length(btrim(file_name)) > 0),
    CONSTRAINT import_preview_counts_not_negative CHECK (row_count >= 0 AND removal_count >= 0),
    CONSTRAINT import_preview_removal_percent_scale CHECK (removal_percent BETWEEN 0 AND 100),
    CONSTRAINT import_preview_expires_after_it_was_taken CHECK (expires_at > created_at)
);

CREATE INDEX import_preview_by_source ON import_preview (source_id, created_at DESC);
