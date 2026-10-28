package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class MfaProofFailedException extends CodedDomainFailure {
    static final ProblemType PROBLEM_TYPE = new ProblemType("mfa-proof-failed", HttpStatus.FORBIDDEN,
            "MFA proof failed", "The second-factor proof was not accepted");

    MfaProofFailedException() {
        super("identity.mfa.proofFailed", Map.of());
    }

    @Override public ProblemType problemType() { return PROBLEM_TYPE; }
}
