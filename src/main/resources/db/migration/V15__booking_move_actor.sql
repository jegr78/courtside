ALTER TABLE booking
    ADD COLUMN moved_at timestamptz,
    ADD COLUMN moved_by uuid;

ALTER TABLE booking
    ADD CONSTRAINT booking_move_actor_complete
        CHECK ((moved_at IS NULL) = (moved_by IS NULL));
