package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class WebAuthnCredentialLimitException extends CodedDomainFailure {
    static final ProblemType PROBLEM_TYPE = new ProblemType("webauthn-credential-limit-reached", HttpStatus.CONFLICT,
            "WebAuthn credential limit reached", "This account already holds the most WebAuthn credentials it may");

    WebAuthnCredentialLimitException(int limit) {
        super("identity.mfa.webauthnLimitReached", Map.of("limit", limit));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
