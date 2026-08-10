package org.courtside.booking;

import org.courtside.card.CardService;
import org.courtside.facility.FacilityService;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;

@Service
@Profile("perf")
@RequiredArgsConstructor
public class HistoricalBookingImporter {

    private final BookingRepository bookings;
    private final FacilityService facility;
    private final CardService cards;
    private final Clock clock;

    @Transactional
    public void importBooking(CreateBookingCommand command) {
        if (!command.slot().end().isBefore(clock.instant())) {
            throw new IllegalStateException("A historical booking must end before the current time");
        }
        facility.requireBookableCourts(command.courtIds());
        if (cards.findCard(command.cardId()).filter(card -> card.isActive()).isEmpty()) {
            throw new IllegalStateException("A historical booking requires an active booking card");
        }
        Booking booking = new Booking(command.cardId(), command.bookedBy(), command.note(), command.slot().end());
        command.courtIds().forEach(courtId -> booking.allocate(courtId, command.slot()));
        booking.addParticipant(ParticipantSpec.member(command.bookedByPersonId()));
        command.participants().forEach(booking::addParticipant);
        bookings.saveAndFlush(booking);
    }
}
