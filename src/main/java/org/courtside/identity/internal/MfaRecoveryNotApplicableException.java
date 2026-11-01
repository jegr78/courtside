package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class MfaRecoveryNotApplicableException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "mfa-recovery-not-applicable", HttpStatus.CONFLICT,
            "Controlled recovery not applicable",
            "This account has no second factor, so ordinary password recovery applies");

    MfaRecoveryNotApplicableException() {
        super("identity.mfa.recoveryNotApplicable", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
