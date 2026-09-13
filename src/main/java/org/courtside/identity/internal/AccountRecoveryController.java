package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.courtside.api.AccountRecoveryApi;
import org.courtside.api.ApiPasswordResetRedemptionRequest;
import org.courtside.api.ApiPasswordResetRequest;
import org.courtside.api.ApiUsernameReminderRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
class AccountRecoveryController implements AccountRecoveryApi {

    private final AccountRecoveryService recovery;
    private final HttpServletRequest request;

    @Override
    public ResponseEntity<Void> requestPasswordReset(ApiPasswordResetRequest body) {
        recovery.sendNewPassword(body.getUsername(), request.getRemoteAddr());
        return ResponseEntity.accepted().build();
    }

    @Override
    public ResponseEntity<Void> redeemPasswordReset(ApiPasswordResetRedemptionRequest body) {
        recovery.redeemPasswordReset(body.getCode(), body.getPassword());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> requestUsernameReminder(ApiUsernameReminderRequest body) {
        recovery.remindOfUsernames(body.getEmail(), request.getRemoteAddr());
        return ResponseEntity.accepted().build();
    }
}
