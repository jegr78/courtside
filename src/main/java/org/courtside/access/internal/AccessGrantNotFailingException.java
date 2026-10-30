package org.courtside.access.internal;

import org.courtside.access.GrantStatus;
import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class AccessGrantNotFailingException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "access-grant-not-failing", HttpStatus.CONFLICT,
            "Access grant not failing", "Only a failing access grant can be retried");

    AccessGrantNotFailingException(GrantStatus status) {
        super("access.grant.notFailing", Map.of("status", status.name()));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
