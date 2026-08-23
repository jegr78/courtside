CREATE TABLE message_record (
    id            uuid        PRIMARY KEY,
    account_id    uuid        NOT NULL REFERENCES user_account ON DELETE CASCADE,
    kind          text        NOT NULL,
    state         text        NOT NULL,
    message_id    text        NOT NULL,
    reason        text,
    status_code   text,
    queued_at     timestamptz NOT NULL,
    settled_at    timestamptz
);

-- The account is what erases a member from this log, so the reference is real and cascades.
CREATE INDEX message_record_page_idx ON message_record (queued_at DESC, id DESC);
CREATE INDEX message_record_account_idx ON message_record (account_id, queued_at DESC);
CREATE INDEX message_record_state_idx ON message_record (state, queued_at DESC);
