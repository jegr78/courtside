-- False for every existing row on purpose: switching this on mails a credential to everybody the
-- next import touches, and no instance should start doing that because it was upgraded.
ALTER TABLE membership_type
    ADD COLUMN grants_account boolean NOT NULL DEFAULT false;

ALTER TABLE import_run
    ADD COLUMN accounts_created_count integer NOT NULL DEFAULT 0;
