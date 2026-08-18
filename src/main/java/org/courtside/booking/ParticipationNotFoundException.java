package org.courtside.booking;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class ParticipationNotFoundException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "participation-not-found", HttpStatus.NOT_FOUND,
            "Participation not found", "This booking does not record you as a participant");

    public ParticipationNotFoundException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
