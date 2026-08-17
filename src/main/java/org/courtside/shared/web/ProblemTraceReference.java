package org.courtside.shared.web;

import io.micrometer.tracing.Span;
import io.micrometer.tracing.Tracer;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
class ProblemTraceReference {

    private final Tracer tracer;

    void addTo(ProblemDetail problem) {
        Span span = tracer.currentSpan();
        if (span != null) {
            problem.setProperty("traceId", span.context().traceId());
            problem.setProperty("spanId", span.context().spanId());
        }
    }
}
