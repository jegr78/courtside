ALTER TABLE user_account ALTER COLUMN password_hash DROP NOT NULL;

COMMENT ON COLUMN user_account.password_hash IS
    'Null until the instance has issued a credential for this account. The sign-in path answers such a row exactly as it answers a wrong password.';
