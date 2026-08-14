package org.courtside.shared.web;

import lombok.extern.slf4j.Slf4j;
import org.courtside.shared.DomainFailure;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

// Ahead of SharedExceptionHandler, whose cause-chain fallback would downgrade a wrapped 409 to a
// 400. AdviceOrderingTest enforces the relation.
@Slf4j
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE + 500)
class DomainFailureHandler {

    @ExceptionHandler(DomainFailure.class)
    ResponseEntity<ProblemDetail> handleDomainFailure(DomainFailure failure) {
        logAnswered(failure);
        return ResponseEntity.status(failure.getStatusCode())
                .headers(failure.getHeaders())
                .body(failure.getBody());
    }

    private static void logAnswered(DomainFailure failure) {
        if (failure.getStatusCode().is5xxServerError()) {
            log.warn("Answering {} for {}", failure.getStatusCode(), failure.problemType().uri(), failure);
        } else {
            log.debug("Answering {} for {}: {}",
                    failure.getStatusCode(), failure.problemType().uri(), failure.getMessage());
        }
    }
}
