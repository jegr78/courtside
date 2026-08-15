ALTER TABLE user_account
    ADD COLUMN security_epoch bigint NOT NULL DEFAULT 0;
