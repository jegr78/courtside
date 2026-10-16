CREATE TABLE booking_rule_rejection (
    id          uuid        PRIMARY KEY,
    attempt_id  uuid        NOT NULL,
    rule_code   text        NOT NULL,
    rejected_at timestamptz NOT NULL,
    card_id     uuid        NOT NULL,

    CONSTRAINT booking_rule_rejection_rule_code_present CHECK (length(rule_code) BETWEEN 1 AND 200),
    CONSTRAINT booking_rule_rejection_once_per_attempt UNIQUE (attempt_id, rule_code)
);

CREATE INDEX booking_rule_rejection_by_time ON booking_rule_rejection (rejected_at);
