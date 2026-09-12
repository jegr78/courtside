package org.courtside.shared.web;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.shared.DomainFailure;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

// Ahead of SharedExceptionHandler and its cause-chain fallback.
@Slf4j
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE + 500)
@RequiredArgsConstructor
class DomainFailureHandler {

    private final ProblemTraceReference traceReference;

    @ExceptionHandler(DomainFailure.class)
    ResponseEntity<ProblemDetail> handleDomainFailure(DomainFailure failure) {
        ProblemDetail body = failure.getBody();
        traceReference.addTo(body);
        logAnswered(failure, body);
        return ResponseEntity.status(failure.getStatusCode())
                .headers(failure.getHeaders())
                .body(body);
    }

    // Never the exception's message and never a violation's params: both are built from the
    // submitted value, and a member number is somebody's.
    private static void logAnswered(DomainFailure failure, ProblemDetail body) {
        if (failure.getStatusCode().is5xxServerError()) {
            log.warn("Answering {} for {}", failure.getStatusCode(), body.getType(), failure);
        } else if (log.isDebugEnabled()) {
            log.debug("Answering {} for {}: {}", failure.getStatusCode(), body.getType(),
                    failure.violationCodes());
        }
    }
}
