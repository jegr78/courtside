CREATE TABLE login_attempt_limit (
    scope varchar(16) NOT NULL,
    subject_hash char(64) NOT NULL,
    attempt_count integer NOT NULL CHECK (attempt_count > 0),
    window_started_at timestamptz NOT NULL,
    blocked_until timestamptz,
    PRIMARY KEY (scope, subject_hash),
    CHECK (scope IN ('ADDRESS', 'GLOBAL'))
);

CREATE INDEX login_attempt_limit_expiry_idx
    ON login_attempt_limit (window_started_at);
