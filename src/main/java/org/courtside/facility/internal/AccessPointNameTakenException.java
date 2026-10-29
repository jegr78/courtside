package org.courtside.facility.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class AccessPointNameTakenException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "access-point-name-taken", HttpStatus.CONFLICT,
            "Access point name taken", "This access point name is already in use");

    public AccessPointNameTakenException(Throwable cause) {
        super("An access point already carries that name", cause);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
