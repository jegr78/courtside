CREATE TABLE mfa_instance_key (
    id integer PRIMARY KEY CHECK (id = 1),
    installation_id uuid NOT NULL UNIQUE,
    key_check text
);

CREATE TABLE account_mfa (
    account_id uuid PRIMARY KEY REFERENCES user_account (id) ON DELETE CASCADE,
    totp_secret text,
    totp_last_step bigint NOT NULL DEFAULT -1 CHECK (totp_last_step >= -1),
    pending_totp_secret text,
    pending_totp_expires_at timestamptz,
    recovery_pending boolean NOT NULL DEFAULT false,
    CHECK ((pending_totp_secret IS NULL) = (pending_totp_expires_at IS NULL))
);

CREATE TABLE mfa_recovery_code (
    account_id uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
    code_hash varchar(64) NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (account_id, code_hash)
);

CREATE TABLE mfa_challenge (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
    security_epoch bigint NOT NULL CHECK (security_epoch >= 0),
    purpose varchar(32) NOT NULL CHECK (purpose IN ('LOGIN', 'REAUTHENTICATION', 'WEBAUTHN_REGISTRATION')),
    session_hash varchar(64) NOT NULL CHECK (session_hash ~ '^[0-9a-f]{64}$'),
    expires_at timestamptz NOT NULL,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
    payload text NOT NULL CHECK (length(payload) <= 65536)
);

CREATE INDEX mfa_challenge_by_account ON mfa_challenge (account_id);
CREATE INDEX mfa_challenge_expiry ON mfa_challenge (expires_at);
