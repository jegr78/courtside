package org.courtside.booking;

import org.courtside.card.ParticipantCard;
import org.courtside.shared.TimeSlot;
import org.courtside.shared.CancellationReason;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.springframework.data.domain.Persistable;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Currency;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Entity
@Table(name = "booking")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Booking implements Persistable<UUID> {

    @Id
    private UUID id;

    @Transient
    @Getter(AccessLevel.NONE)
    private boolean newEntity = true;

    @Column(name = "card_id", nullable = false)
    private UUID cardId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private BookingStatus status;

    @Column(name = "booked_by")
    private UUID bookedBy;

    @Column(name = "acted_by")
    private UUID actedBy;

    private String note;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "reminded_at")
    private Instant remindedAt;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    @Column(name = "cancelled_by")
    private UUID cancelledBy;

    @Enumerated(EnumType.STRING)
    @Column(name = "cancellation_reason")
    private CancellationReason cancellationReason;

    @Column(name = "payment_expires_at")
    private Instant paymentExpiresAt;

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

    @Column(name = "amount_minor")
    private Integer amountMinor;

    @Column(name = "amount_currency")
    private String amountCurrency;

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

    public void charge(BookingAmount amount) {
        this.amountMinor = amount.minor();
        this.amountCurrency = amount.currency().getCurrencyCode();
    }

    public Optional<BookingAmount> amount() {
        return amountMinor == null ? Optional.empty()
                : Optional.of(new BookingAmount(amountMinor, Currency.getInstance(amountCurrency)));
    }

    public void awaitPayment(Instant expiresAt) {
        this.status = BookingStatus.PENDING_PAYMENT;
        this.paymentExpiresAt = expiresAt;
        allocations.forEach(CourtAllocation::awaitPayment);
    }

    public boolean confirmPayment() {
        if (status != BookingStatus.PENDING_PAYMENT) {
            return false;
        }
        this.status = BookingStatus.CONFIRMED;
        allocations.forEach(CourtAllocation::confirm);
        return true;
    }

    public boolean expirePayment(Instant at, UUID by) {
        return status == BookingStatus.PENDING_PAYMENT && cancel(by, at, CancellationReason.PAYMENT_EXPIRED);
    }

    public Optional<Instant> paymentExpiresAt() {
        return Optional.ofNullable(paymentExpiresAt);
    }

    public void actedOnBehalfBy(UUID guardianAccountId) {
        this.actedBy = guardianAccountId;
    }

    public void allocate(UUID courtId, TimeSlot slot) {
        allocations.add(new CourtAllocation(this, courtId, slot));
    }

    @Override
    public boolean isNew() {
        return newEntity;
    }

    @PostLoad
    @PostPersist
    private void markPersisted() {
        newEntity = false;
    }

    public void clearAllocations() {
        allocations.clear();
    }

    public void recordMove(UUID movedBy, Instant at) {
        this.movedBy = movedBy;
        this.movedAt = at;
        this.remindedAt = null;
    }

    public boolean cancel(UUID cancelledBy, Instant at, CancellationReason reason) {
        if (status == BookingStatus.CANCELLED) {
            return false;
        }
        this.status = BookingStatus.CANCELLED;
        this.cancelledBy = cancelledBy;
        this.cancelledAt = at;
        this.cancellationReason = reason;
        allocations.forEach(CourtAllocation::cancel);
        return true;
    }

    public List<CourtAllocation> getAllocations() {
        return List.copyOf(allocations);
    }

    public boolean withdrawParticipant(UUID personId) {
        // A null would match every guest, whose person_id is null by design.
        return personId != null
                && participants.removeIf(participant -> personId.equals(participant.getPersonId()));
    }

    // The member takes the slot the marker held, so the booking keeps its player count and positions.
    public boolean fillOpenPlace(UUID participantId, UUID personId) {
        return personId != null && participants.stream()
                .filter(participant -> participant.getId().equals(participantId)
                        && ParticipantCard.LOOKING_FOR_A_PARTNER.equals(participant.getCardId()))
                .findFirst()
                .map(participant -> {
                    participant.becomeMember(personId);
                    return true;
                })
                .orElse(false);
    }

    public void addParticipant(ParticipantSpec spec) {
        addParticipant(spec, null);
    }

    public void addParticipant(ParticipantSpec spec, GuestFee guestFee) {
        participants.add(new BookingParticipant(this, spec, nextPosition(), guestFee));
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
