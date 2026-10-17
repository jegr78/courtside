package org.courtside.member.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class MembershipPeriodNotFoundException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "membership-period-not-found", HttpStatus.NOT_FOUND,
            "Membership period not found", "This person holds no such membership period");

    public MembershipPeriodNotFoundException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
