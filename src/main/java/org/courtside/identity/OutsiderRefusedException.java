package org.courtside.identity;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class OutsiderRefusedException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "access-denied", HttpStatus.FORBIDDEN,
            "Not allowed", "You are not allowed to perform this request");

    public OutsiderRefusedException() {
        super("This operation requires a running membership");
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }

    @Override
    public boolean refusesAuthorization() {
        return true;
    }
}
