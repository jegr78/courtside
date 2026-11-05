package org.courtside.booking;

import org.courtside.booking.internal.ParticipantKind;
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

import java.util.UUID;

@Entity
@Table(name = "booking_participant")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class BookingParticipant {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "booking_id", nullable = false)
    private Booking booking;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ParticipantKind kind;

    @Column(name = "person_id")
    private UUID personId;

    @Column(name = "guest_name")
    private String guestName;

    @Column(name = "card_id")
    private UUID cardId;

    @Column(nullable = false)
    private int position;

    @Column(name = "guest_fee_minor")
    private Integer guestFeeMinor;

    @Column(name = "guest_fee_currency")
    private String guestFeeCurrency;

    BookingParticipant(Booking booking, ParticipantSpec spec, int position, GuestFee guestFee) {
        this.id = UUID.randomUUID();
        this.booking = booking;
        this.kind = spec.kind();
        this.personId = spec.personId();
        this.guestName = spec.guestName();
        this.cardId = spec.cardId();
        this.position = position;
        if (spec.kind() == ParticipantKind.GUEST) {
            if (guestFee == null) {
                throw new IllegalStateException("A guest is booked with the fee in force for the card");
            }
            this.guestFeeMinor = guestFee.minor();
            this.guestFeeCurrency = guestFee.currency().getCurrencyCode();
        }
    }

    void becomeMember(UUID personId) {
        this.kind = ParticipantKind.MEMBER;
        this.personId = personId;
        this.cardId = null;
    }
}
