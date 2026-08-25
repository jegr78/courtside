package org.courtside.booking;

import org.courtside.shared.TimeSlot;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "booking")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Booking {

    @Id
    private UUID id;

    @Column(name = "card_id", nullable = false)
    private UUID cardId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private BookingStatus status;

    @Column(name = "booked_by")
    private UUID bookedBy;

    private String note;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "reminded_at")
    private Instant remindedAt;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    @Column(name = "cancelled_by")
    private UUID cancelledBy;

    @Column(name = "moved_at")
    private Instant movedAt;

    @Column(name = "moved_by")
    private UUID movedBy;

    @Column(name = "series_id")
    private UUID seriesId;

    @Column(name = "idempotency_key")
    private String idempotencyKey;

    @Column(name = "request_fingerprint", length = 64)
    private String requestFingerprint;

    @OneToMany(mappedBy = "booking", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<CourtAllocation> allocations = new ArrayList<>();

    @OneToMany(mappedBy = "booking", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("position")
    private List<BookingParticipant> participants = new ArrayList<>();

    public Booking(UUID cardId, UUID bookedBy, String note, Instant createdAt) {
        this.id = UUID.randomUUID();
        this.cardId = cardId;
        this.bookedBy = bookedBy;
        this.note = note;
        this.status = BookingStatus.CONFIRMED;
        this.createdAt = createdAt;
    }

    public void allocate(UUID courtId, TimeSlot slot) {
        allocations.add(new CourtAllocation(this, courtId, slot));
    }

    public void clearAllocations() {
        allocations.clear();
    }

    public void recordMove(UUID movedBy, Instant at) {
        this.movedBy = movedBy;
        this.movedAt = at;
        this.remindedAt = null;
    }

    public void cancel(UUID cancelledBy, Instant at) {
        this.status = BookingStatus.CANCELLED;
        this.cancelledBy = cancelledBy;
        this.cancelledAt = at;
        allocations.forEach(CourtAllocation::cancel);
    }

    public List<CourtAllocation> getAllocations() {
        return List.copyOf(allocations);
    }

    public boolean withdrawParticipant(UUID personId) {
        // A null would match every guest, whose person_id is null by design.
        return personId != null
                && participants.removeIf(participant -> personId.equals(participant.getPersonId()));
    }

    public void addParticipant(ParticipantSpec spec) {
        participants.add(new BookingParticipant(this, spec, nextPosition()));
    }

    private int nextPosition() {
        // A withdrawal leaves a hole, and (booking_id, position) is unique.
        return participants.stream().mapToInt(BookingParticipant::getPosition).max().orElse(0) + 1;
    }

    public List<BookingParticipant> getParticipants() {
        return List.copyOf(participants);
    }

    void joinSeries(UUID seriesId) {
        this.seriesId = seriesId;
    }

    void identifyRequest(String idempotencyKey, String requestFingerprint) {
        this.idempotencyKey = idempotencyKey;
        this.requestFingerprint = requestFingerprint;
    }
}
