ALTER TABLE user_account
    ADD COLUMN password_change_required boolean NOT NULL DEFAULT false;
