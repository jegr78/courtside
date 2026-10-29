CREATE TABLE access_grant (
    id                   uuid        PRIMARY KEY,
    booking_id           uuid        NOT NULL,
    first_accepted_at    timestamptz,
    wanted               boolean     NOT NULL DEFAULT false,
    want_from            timestamptz,
    want_until           timestamptz,
    want_points          uuid[],
    want_mapping         text,
    remote               text        NOT NULL DEFAULT 'NONE',
    remote_from          timestamptz,
    remote_until         timestamptz,
    remote_points        uuid[],
    remote_mapping       text,
    exposed_until        timestamptz,
    last_install_sent_at timestamptz,
    external_reference   text,
    attempts             integer     NOT NULL DEFAULT 0,
    rejections           integer     NOT NULL DEFAULT 0,
    next_attempt_at      timestamptz,
    last_failure         text,
    refused              boolean     NOT NULL DEFAULT false,
    retry_requested_at   timestamptz,
    CONSTRAINT access_grant_one_per_booking UNIQUE (booking_id),
    CONSTRAINT access_grant_remote_known CHECK (remote IN ('NONE', 'MAYBE', 'INSTALLED')),
    CONSTRAINT access_grant_attempts_not_negative CHECK (attempts >= 0),
    CONSTRAINT access_grant_rejections_not_negative CHECK (rejections >= 0),
    CONSTRAINT access_grant_want_window_order CHECK (want_until > want_from),
    CONSTRAINT access_grant_remote_window_order CHECK (remote_until > remote_from),
    CONSTRAINT access_grant_last_failure_length CHECK (length(last_failure) <= 500),
    CONSTRAINT access_grant_external_reference_length CHECK (length(external_reference) <= 200)
);

CREATE INDEX access_grant_open ON access_grant (id)
    WHERE wanted OR remote <> 'NONE' OR retry_requested_at IS NOT NULL;
CREATE INDEX access_grant_due ON access_grant (next_attempt_at);

CREATE TABLE access_code (
    code     text        PRIMARY KEY,
    grant_id uuid        REFERENCES access_grant,
    until    timestamptz,
    CONSTRAINT access_code_digits CHECK (code ~ '^[0-9]{4,8}$'),
    CONSTRAINT access_code_one_per_grant UNIQUE (grant_id),
    CONSTRAINT access_code_held_only_when_detached CHECK (grant_id IS NULL OR until IS NULL)
);

CREATE INDEX access_code_detached ON access_code (until) WHERE grant_id IS NULL;
