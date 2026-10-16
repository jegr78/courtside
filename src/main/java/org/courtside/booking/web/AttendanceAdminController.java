package org.courtside.booking.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminAttendanceApi;
import org.courtside.api.ApiAttendancePolicy;
import org.courtside.api.ApiAttendanceRequest;
import org.courtside.api.ApiNoShow;
import org.courtside.api.ApiNoShowsLifted;
import org.courtside.booking.attendance.AttendanceOutcome;
import org.courtside.booking.attendance.AttendancePolicy;
import org.courtside.booking.attendance.AttendanceService;
import org.courtside.identity.CurrentUser;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class AttendanceAdminController implements AdminAttendanceApi {

    private final AttendanceService attendance;
    private final CurrentUser currentUser;

    @Override
    public ResponseEntity<ApiAttendancePolicy> getAttendancePolicy() {
        return ResponseEntity.ok(toResponse(attendance.policy()));
    }

    @Override
    public ResponseEntity<ApiAttendancePolicy> changeAttendancePolicy(ApiAttendancePolicy request) {
        return ResponseEntity.ok(toResponse(attendance.changePolicy(
                new AttendancePolicy(request.getEnabled(), request.getReleaseAfterMinutes()))));
    }

    @Override
    public ResponseEntity<Void> recordAttendance(UUID bookingId, ApiAttendanceRequest request) {
        attendance.record(bookingId, AttendanceOutcome.valueOf(request.getOutcome().getValue()),
                currentUser.requireAccount().getId());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> clearAttendance(UUID bookingId) {
        attendance.clear(bookingId);
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<List<ApiNoShow>> listNoShows(UUID personId) {
        return ResponseEntity.ok(attendance.noShowsOf(personId).stream()
                .map(noShow -> new ApiNoShow(noShow.bookingId(), WireTypes.toOffsetDateTime(noShow.startsAt()),
                        WireTypes.toOffsetDateTime(noShow.endsAt())))
                .toList());
    }

    @Override
    public ResponseEntity<ApiNoShowsLifted> liftNoShows(UUID personId) {
        return ResponseEntity.ok(new ApiNoShowsLifted(
                attendance.liftNoShows(personId, currentUser.requireAccount().getId())));
    }

    private static ApiAttendancePolicy toResponse(AttendancePolicy policy) {
        return new ApiAttendancePolicy(policy.enabled()).releaseAfterMinutes(policy.releaseAfterMinutes());
    }
}
