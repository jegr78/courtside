package org.courtside.member.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class DependantAccountDisabledException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "dependant-account-disabled", HttpStatus.CONFLICT,
            "Dependant account disabled", "The dependant's account is disabled, so nothing can be booked for it");

    public DependantAccountDisabledException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
