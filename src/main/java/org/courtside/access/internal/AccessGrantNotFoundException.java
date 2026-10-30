package org.courtside.access.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class AccessGrantNotFoundException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "access-grant-not-found", HttpStatus.NOT_FOUND, "Access grant not found", "No such access grant");

    AccessGrantNotFoundException() {
        super("access.grant.notFound", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
