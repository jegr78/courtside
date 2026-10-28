package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.courtside.api.AccountWebauthnApi;
import org.courtside.api.ApiMfaRecoveryCodeSet;
import org.courtside.api.ApiWebAuthnCreationOptions;
import org.courtside.api.ApiWebAuthnEnrollmentRequest;
import org.courtside.api.ApiWebAuthnLabelRequest;
import org.courtside.api.ApiWebAuthnRequestOptions;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
class AccountWebauthnController implements AccountWebauthnApi {
    private final MfaWebAuthnFlow flow;
    private final MfaWebAuthnCodec codec;
    private final HttpServletRequest request;

    @Override
    public ResponseEntity<ApiWebAuthnCreationOptions> beginWebauthnEnrollment() {
        var session = request.getSession();
        var result = flow.beginRegistration(session.getId());
        session.setAttribute(MfaWebAuthnFlow.REGISTRATION, result.id());
        return ResponseEntity.ok(codec.toApi(result.options(), ApiWebAuthnCreationOptions.class));
    }

    @Override
    public ResponseEntity<ApiWebAuthnRequestOptions> beginWebauthnReauthentication() {
        var session = request.getSession();
        var result = flow.beginReauthentication(session.getId());
        session.setAttribute(MfaWebAuthnFlow.REAUTHENTICATION, result.id());
        return ResponseEntity.ok(codec.toApi(result.options(), ApiWebAuthnRequestOptions.class));
    }

    @Override
    public ResponseEntity<ApiMfaRecoveryCodeSet> confirmWebauthnEnrollment(ApiWebAuthnEnrollmentRequest enrollment) {
        var session = request.getSession(false);
        if (session == null || !(session.getAttribute(MfaWebAuthnFlow.REGISTRATION) instanceof UUID id)) {
            throw new MfaProofFailedException();
        }
        var result = flow.register(id, session.getId(), codec.attestation(enrollment.getCredential()),
                enrollment.getLabel(), request.getRemoteAddr());
        if (result.limited()) throw new PasswordVerificationRateLimitedException();
        if (!result.accepted()) throw new MfaProofFailedException();
        return ResponseEntity.ok(new ApiMfaRecoveryCodeSet(result.codes()));
    }

    @Override
    public ResponseEntity<Void> removeOwnWebauthnCredential(String id) {
        flow.remove(id);
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> renameOwnWebauthnCredential(String id, ApiWebAuthnLabelRequest label) {
        flow.rename(id, label.getLabel());
        return ResponseEntity.noContent().build();
    }
}
