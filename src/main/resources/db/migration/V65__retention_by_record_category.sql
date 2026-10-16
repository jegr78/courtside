ALTER TABLE booking ADD COLUMN pseudonymised_at timestamptz;

ALTER TABLE booking DROP CONSTRAINT booking_move_actor_complete;

ALTER TABLE booking
    ADD CONSTRAINT booking_move_actor_complete
        CHECK (moved_by IS NULL OR moved_at IS NOT NULL),
    ADD CONSTRAINT booking_move_actor_kept_until_pseudonymised
        CHECK (moved_at IS NULL OR moved_by IS NOT NULL OR pseudonymised_at IS NOT NULL),
    ADD CONSTRAINT booking_pseudonymised_names_nobody
        CHECK (pseudonymised_at IS NULL
            OR (booked_by IS NULL AND cancelled_by IS NULL AND moved_by IS NULL AND note IS NULL));

ALTER TABLE booking_series ADD COLUMN pseudonymised_at timestamptz;

ALTER TABLE booking_series
    ADD CONSTRAINT booking_series_pseudonymised_names_nobody
        CHECK (pseudonymised_at IS NULL OR (created_by IS NULL AND note IS NULL));

CREATE TABLE retention_policy (
    category      text    PRIMARY KEY,
    retain_months integer NOT NULL,

    CONSTRAINT retention_policy_category_known CHECK (category IN ('BOOKINGS', 'FORMER_MEMBERS')),
    CONSTRAINT retention_policy_retain_months_range CHECK (retain_months BETWEEN 1 AND 1200)
);

CREATE TABLE retention_preview (
    id                       uuid        PRIMARY KEY,
    created_by               uuid        NOT NULL REFERENCES user_account ON DELETE CASCADE,
    created_at               timestamptz NOT NULL,
    expires_at               timestamptz NOT NULL,
    bookings_ended_before    timestamptz,
    memberships_ended_before date,
    former_member_ids        uuid[]      NOT NULL,

    CONSTRAINT retention_preview_expires_after_creation CHECK (expires_at > created_at),
    CONSTRAINT retention_preview_covers_a_category
        CHECK (bookings_ended_before IS NOT NULL OR memberships_ended_before IS NOT NULL),
    CONSTRAINT retention_preview_members_need_a_cutoff
        CHECK (memberships_ended_before IS NOT NULL OR cardinality(former_member_ids) = 0)
);
