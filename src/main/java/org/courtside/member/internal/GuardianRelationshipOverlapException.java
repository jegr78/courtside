package org.courtside.member.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class GuardianRelationshipOverlapException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "guardian-relationship-overlap", HttpStatus.CONFLICT,
            "Guardian relationships overlap", "A guardian holds one relationship to a dependant on any given day");

    public GuardianRelationshipOverlapException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
