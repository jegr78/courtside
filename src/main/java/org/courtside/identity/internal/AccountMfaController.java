package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.courtside.api.AccountMfaApi;
import org.courtside.api.ApiMfaCodeProof;
import org.courtside.api.ApiMfaRecoveryCodeSet;
import org.courtside.api.ApiMfaStatus;
import org.courtside.api.ApiTotpEnrollment;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
class AccountMfaController implements AccountMfaApi {
    private final MfaManagement management;
    private final HttpServletRequest request;

    @Override
    public ResponseEntity<ApiMfaStatus> getOwnMfaStatus() {
        return ResponseEntity.ok(management.status());
    }

    @Override
    public ResponseEntity<ApiTotpEnrollment> beginTotpEnrollment() {
        return ResponseEntity.ok(management.beginTotp());
    }

    @Override
    public ResponseEntity<ApiMfaRecoveryCodeSet> confirmTotpEnrollment(ApiMfaCodeProof proof) {
        var result = management.confirmTotp(proof.getCode(), request.getRemoteAddr());
        if (result.limited()) throw new PasswordVerificationRateLimitedException();
        if (!result.accepted()) throw new MfaProofFailedException();
        return ResponseEntity.ok(new ApiMfaRecoveryCodeSet(result.codes()));
    }

    @Override
    public ResponseEntity<ApiMfaRecoveryCodeSet> replaceOwnRecoveryCodes() {
        return ResponseEntity.ok(new ApiMfaRecoveryCodeSet(management.replaceRecoveryCodes()));
    }

    @Override
    public ResponseEntity<Void> removeOwnTotp() {
        management.removeTotp();
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> disableOwnMfa() {
        management.disable();
        return ResponseEntity.noContent().build();
    }
}
