package org.courtside.booking;

import org.courtside.shared.TimeSlot;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "court_allocation")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CourtAllocation {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "booking_id", nullable = false)
    private Booking booking;

    @Column(name = "court_id", nullable = false)
    private UUID courtId;

    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    @Column(name = "ends_at", nullable = false)
    private Instant endsAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private BookingStatus status;

    CourtAllocation(Booking booking, UUID courtId, TimeSlot slot) {
        this.id = UUID.randomUUID();
        this.booking = booking;
        this.courtId = courtId;
        this.startsAt = slot.start();
        this.endsAt = slot.end();
        this.status = BookingStatus.CONFIRMED;
    }

    void cancel() {
        this.status = BookingStatus.CANCELLED;
    }
}
