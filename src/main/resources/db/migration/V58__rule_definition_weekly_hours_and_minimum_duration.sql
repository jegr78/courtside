ALTER TABLE rule_definition DROP CONSTRAINT rule_definition_rule_type_known;

ALTER TABLE rule_definition ADD CONSTRAINT rule_definition_rule_type_known
    CHECK (rule_type IN ('OPENING_HOURS', 'SLOT_GRID', 'ADVANCE_WINDOW', 'MAX_OPEN_BOOKINGS',
                         'MAX_BOOKING_DURATION', 'CANCELLATION_DEADLINE', 'NO_COURT_BOOKING',
                         'BOOKING_HOURS', 'WEEKLY_BOOKED_HOURS', 'MIN_BOOKING_DURATION'));
