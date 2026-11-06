package org.courtside.card.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class ExternalManagesNoCardException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "external-manages-no-card", HttpStatus.BAD_REQUEST,
            "External role manages no card", "A person outside the club never manages bookings of others");

    public ExternalManagesNoCardException() {
        super("card.managingRoles.external", Map.of("field", "managingRoles"));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
