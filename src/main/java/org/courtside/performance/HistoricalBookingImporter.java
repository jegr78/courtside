package org.courtside.performance;

import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.GuestFee;
import org.courtside.booking.ParticipantSpec;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.config.ClubCurrency;
import org.courtside.facility.FacilityService;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;

@Service
@Profile("perf")
@RequiredArgsConstructor
class HistoricalBookingImporter {

    private final BookingRepository bookings;
    private final FacilityService facility;
    private final CardService cards;
    private final ClubCurrency currency;
    private final Clock clock;

    @Transactional
    public void importBooking(CreateBookingCommand command) {
        if (!command.slot().end().isBefore(clock.instant())) {
            throw new IllegalStateException("A historical booking must end before the current time");
        }
        facility.requireBookableCourts(command.courtIds());
        BookingCard card = cards.findCard(command.cardId()).filter(BookingCard::isActive)
                .orElseThrow(() -> new IllegalStateException("A historical booking requires an active booking card"));
        GuestFee guestFee = new GuestFee(card.getGuestFeeMinor(), currency.currency());
        Booking booking = new Booking(command.cardId(), command.bookedBy(), command.note(), command.slot().end());
        command.courtIds().forEach(courtId -> booking.allocate(courtId, command.slot()));
        booking.addParticipant(ParticipantSpec.member(command.bookedByPersonId()));
        command.participants().forEach(participant -> booking.addParticipant(participant, guestFee));
        bookings.saveAndFlush(booking);
    }
}
