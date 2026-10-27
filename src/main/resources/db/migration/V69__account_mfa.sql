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
