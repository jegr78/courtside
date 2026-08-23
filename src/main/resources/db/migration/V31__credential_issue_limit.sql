CREATE TABLE credential_issue_limit (
    account_id        uuid        PRIMARY KEY REFERENCES user_account ON DELETE CASCADE,
    issued_count      integer     NOT NULL CHECK (issued_count > 0),
    window_started_at timestamptz NOT NULL
);

CREATE INDEX credential_issue_limit_expiry_idx
    ON credential_issue_limit (window_started_at);
