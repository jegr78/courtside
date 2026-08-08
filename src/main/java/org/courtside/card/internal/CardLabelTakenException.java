package org.courtside.card.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class CardLabelTakenException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "card-label-taken", HttpStatus.CONFLICT,
            "Label already in use", "This card label is already in use");

    public CardLabelTakenException(String message, Throwable cause) {
        super(message, cause);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
