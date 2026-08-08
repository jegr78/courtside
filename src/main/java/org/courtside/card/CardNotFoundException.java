package org.courtside.card;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class CardNotFoundException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "card-not-found", HttpStatus.NOT_FOUND, "Card not found", "No such card");

    public CardNotFoundException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
