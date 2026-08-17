package org.courtside.member.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class MembershipTypeInactiveException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "membership-type-inactive", HttpStatus.CONFLICT,
            "Membership type inactive", "The membership type is no longer offered");

    public MembershipTypeInactiveException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
