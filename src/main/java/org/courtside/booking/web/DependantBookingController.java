package org.courtside.booking.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiBookingCreated;
import org.courtside.api.ApiCreateBookingRequest;
import org.courtside.api.ApiPersonalBookingPage;
import org.courtside.api.ApiPersonalBookingView;
import org.courtside.api.DependantBookingsApi;
import org.courtside.booking.DependantBookings;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.PersonalBookingView;
import org.courtside.shared.TimeSlot;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.WebDataBinder;
import org.springframework.web.bind.annotation.InitBinder;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class DependantBookingController implements DependantBookingsApi {

    private final DependantBookings dependantBookings;
    private final PersonalBookingPages personalBookingPages;
    private final BookingRequestValidator crossFieldRules;

    @InitBinder
    void registerCrossFieldRules(WebDataBinder binder) {
        binder.addValidators(crossFieldRules);
    }

    @Override
    public ResponseEntity<ApiPersonalBookingPage> listDependantBookings(UUID personId, ApiPersonalBookingView view,
                                                                        UUID cursor, Integer limit) {
        return ResponseEntity.ok(personalBookingPages.render(dependantBookings.bookingsOf(personId,
                PersonalBookingView.valueOf(view.getValue()), cursor, limit), view));
    }

    @Override
    public ResponseEntity<ApiBookingCreated> createDependantBooking(UUID personId, String idempotencyKey,
                                                                    ApiCreateBookingRequest request) {
        List<ParticipantSpec> participants = request.getParticipants() == null
                ? List.of()
                : request.getParticipants().stream()
                        .map(p -> ParticipantSpec.from(p.getPersonId(), p.getGuestName(), p.getCardId()))
                        .toList();
        UUID id = dependantBookings.bookFor(personId, List.copyOf(request.getCourtIds()), request.getCardId(),
                new TimeSlot(WireTypes.toInstant(request.getStartsAt()), WireTypes.toInstant(request.getEndsAt())),
                request.getNote(), participants, idempotencyKey);
        return ResponseEntity.created(URI.create("/api/my/dependants/" + personId + "/bookings/" + id))
                .body(new ApiBookingCreated(id));
    }

    @Override
    public ResponseEntity<Void> cancelDependantBooking(UUID personId, UUID bookingId) {
        dependantBookings.cancelFor(personId, bookingId);
        return ResponseEntity.noContent().build();
    }
}
