package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiRole;
import org.courtside.api.ApiSessionStatus;
import org.courtside.api.SessionStatusApi;
import org.courtside.identity.AppointmentAccess;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
class SessionStatusController implements SessionStatusApi {

    private final CurrentUser currentUser;
    private final AppointmentAccess appointmentAccess;
    private final MfaTotpRepository totp;
    private final MfaFactors factors;
    private final MfaWebAuthn webAuthn;
    private final MfaWebAuthnCredentials credentials;

    @Override
    public ResponseEntity<ApiSessionStatus> getSessionStatus() {
        return ResponseEntity.ok(currentUser.account()
                .map(this::authenticated)
                .orElseGet(this::anonymous));
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
                .mfaEnabled(factors.enabled(account.getId()))
                .totpAvailable(totp.enabled(account.getId()))
                .webauthnAvailable(webAuthn.available() && credentials.enabled(account.getId()))
                .managesAppointments(reach.managesAppointments())
                .createsSeries(reach.createsSeries());
    }

    private ApiSessionStatus anonymous() {
        ApiSessionStatus status = new ApiSessionStatus(false, List.of(), false)
                .managesAppointments(false)
                .createsSeries(false);
        if (SecurityContextHolder.getContext().getAuthentication() instanceof MfaPendingAuthentication pending) {
            status.mfaRequired(true).totpAvailable(totp.enabled(pending.getPrincipal().account()))
                    .webauthnAvailable(webAuthn.available() && credentials.enabled(pending.getPrincipal().account()));
        }
        return status;
    }
}
