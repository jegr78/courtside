-- Without it a person holding no membership type is measured against no membership-scoped rule,
-- which makes the permissive state the most permissive one. NULL keeps that until a club decides.
ALTER TABLE club_config
    ADD COLUMN no_membership_type_rule_set_id uuid,
    ADD CONSTRAINT club_config_no_membership_type_rule_set
        FOREIGN KEY (no_membership_type_rule_set_id) REFERENCES rule_set;
