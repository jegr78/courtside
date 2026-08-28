package org.courtside.booking.series;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface BookingSeriesRepository extends JpaRepository<BookingSeries, UUID> {

    List<BookingSeries> findByCreatedByOrderByCreatedAtAscIdAsc(UUID createdBy);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT series FROM BookingSeries series WHERE series.id = :id")
    Optional<BookingSeries> findForUpdateById(@Param("id") UUID id);
}
