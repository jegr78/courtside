package org.courtside.booking.series;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface BookingSeriesRepository extends JpaRepository<BookingSeries, UUID> {
}
