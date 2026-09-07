ALTER TABLE login_attempt_limit
    DROP CONSTRAINT login_attempt_limit_scope_check;

ALTER TABLE login_attempt_limit
    ADD CONSTRAINT login_attempt_limit_scope_check
        CHECK (scope IN ('ACCOUNT', 'ADDRESS', 'GLOBAL'));
