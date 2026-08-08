package org.courtside.booking.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class CardNotBookableException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "card-not-bookable", HttpStatus.BAD_REQUEST,
            "Card not bookable", "The requested booking card cannot be used");

    public CardNotBookableException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
