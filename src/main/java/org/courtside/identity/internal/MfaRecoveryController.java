package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.courtside.api.MfaRecoveryApi;
import org.courtside.api.ApiMfaAdministrativeStatus;
import org.courtside.api.ApiMfaRecoveryInitiation;
import org.courtside.api.ApiMfaRecoveryRedemption;
import org.courtside.identity.UserAccountRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
class MfaRecoveryController implements MfaRecoveryApi {
    private final ControlledAccountRecovery recovery;
    private final MfaFactors factors;
    private final UserAccountRepository accounts;
    private final LoginProtectionProperties limits;
    private final HttpServletRequest request;

    @Override
    public ResponseEntity<ApiMfaAdministrativeStatus> getAdministrativeMfaStatus(UUID id) {
        if (!accounts.existsById(id)) throw new MfaResourceNotFoundException();
        return ResponseEntity.ok(new ApiMfaAdministrativeStatus(factors.enabled(id), factors.recoveryPending(id)));
    }

    @Override
    public ResponseEntity<Void> initiateMfaRecovery(UUID id, ApiMfaRecoveryInitiation body) {
        if (!accounts.existsById(id)) throw new MfaResourceNotFoundException();
        recovery.initiate(id, Boolean.TRUE.equals(body.getIdentityChecked()));
        return ResponseEntity.accepted().build();
    }

    @Override
    public ResponseEntity<Void> redeemMfaRecovery(ApiMfaRecoveryRedemption body) {
        switch (recovery.redeem(body.getUsername(), body.getCode(), body.getPassword(), request.getRemoteAddr())) {
            case INVALID -> throw new ResetCodeInvalidException();
            case EXPIRED -> throw new ResetCodeExpiredException();
            case LIMITED -> throw new AccountRecoveryRateLimitedException(new LoginBlock("address", limits.address().block()));
            case ACCEPTED -> { return ResponseEntity.noContent().build(); }
        }
        throw new IllegalStateException("Unhandled controlled recovery result");
    }
}
