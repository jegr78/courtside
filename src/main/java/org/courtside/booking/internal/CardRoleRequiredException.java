package org.courtside.booking.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class CardRoleRequiredException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "card-role-required", HttpStatus.FORBIDDEN,
            "Booking card not allowed", "This booking card is not open to you");

    public CardRoleRequiredException(String message) {
        super(message);
    }


    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
