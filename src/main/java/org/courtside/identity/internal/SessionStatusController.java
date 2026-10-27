package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiRole;
import org.courtside.api.ApiSessionStatus;
import org.courtside.api.SessionStatusApi;
import org.courtside.identity.AppointmentAccess;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
class SessionStatusController implements SessionStatusApi {

    private final CurrentUser currentUser;
    private final AppointmentAccess appointmentAccess;

    @Override
    public ResponseEntity<ApiSessionStatus> getSessionStatus() {
        return ResponseEntity.ok(currentUser.account()
                .map(this::authenticated)
                .orElseGet(SessionStatusController::anonymous));
    }

    private ApiSessionStatus authenticated(UserAccount account) {
        AppointmentAccess.Reach reach = appointmentAccess.reachOf(account.getRoles());
        List<ApiRole> roles = account.getRoles().stream()
                .map(role -> ApiRole.valueOf(role.name()))
                .toList();
        return new ApiSessionStatus(true, roles, account.isPasswordChangeRequired())
                .username(account.getUsername())
                .displayName(account.getPerson().getDisplayName())
                .firstName(account.getPerson().getFirstName())
                .lastName(account.getPerson().getLastName())
                .locale(account.getLocale())
                .managesAppointments(reach.managesAppointments())
                .createsSeries(reach.createsSeries());
    }

    private static ApiSessionStatus anonymous() {
        return new ApiSessionStatus(false, List.of(), false)
                .managesAppointments(false)
                .createsSeries(false);
    }
}
