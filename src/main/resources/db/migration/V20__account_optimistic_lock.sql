ALTER TABLE user_account
    ADD COLUMN version bigint NOT NULL DEFAULT 0;
