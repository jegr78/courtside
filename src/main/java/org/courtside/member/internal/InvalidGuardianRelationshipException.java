package org.courtside.member.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class InvalidGuardianRelationshipException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "invalid-guardian-relationship", HttpStatus.BAD_REQUEST,
            "Invalid guardian relationship", "The guardian relationship is not usable");

    public InvalidGuardianRelationshipException(String code) {
        super(code, Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
