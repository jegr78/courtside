package org.courtside.booking.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class IdempotencyKeyReusedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "idempotency-key-reused", HttpStatus.CONFLICT,
            "Idempotency key reused", "The idempotency key already belongs to another request");

    public IdempotencyKeyReusedException() {
        super("booking.idempotencyKey.reused", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
