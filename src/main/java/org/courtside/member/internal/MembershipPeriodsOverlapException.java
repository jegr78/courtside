package org.courtside.member.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class MembershipPeriodsOverlapException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "membership-periods-overlap", HttpStatus.CONFLICT,
            "Membership periods overlap", "A person holds one membership on any given day");

    public MembershipPeriodsOverlapException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
