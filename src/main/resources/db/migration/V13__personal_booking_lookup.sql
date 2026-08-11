CREATE INDEX booking_by_account
    ON booking (booked_by);

CREATE INDEX court_allocation_by_booking_and_start
    ON court_allocation (booking_id, starts_at);
