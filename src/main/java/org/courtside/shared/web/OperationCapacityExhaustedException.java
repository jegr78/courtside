package org.courtside.shared.web;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;

import java.util.Map;

class OperationCapacityExhaustedException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "operation-capacity-exhausted", HttpStatus.TOO_MANY_REQUESTS,
            "Operation busy", "This operation is already running as often as the instance allows; try again shortly");

    OperationCapacityExhaustedException() {
        super("admission.capacityExhausted", Map.of());
    }

    @Override
    public HttpHeaders getHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.RETRY_AFTER, "1");
        return headers;
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
