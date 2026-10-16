package org.courtside.booking.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AttendanceApi;
import org.courtside.booking.attendance.AttendanceService;
import org.courtside.identity.CurrentUser;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
class CheckInController implements AttendanceApi {

    private final AttendanceService attendance;
    private final CurrentUser currentUser;

    @Override
    public ResponseEntity<Void> checkIn(UUID bookingId) {
        attendance.checkIn(bookingId, currentUser.requireAccount().getId());
        return ResponseEntity.noContent().build();
    }
}
