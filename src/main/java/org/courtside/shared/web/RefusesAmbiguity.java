package org.courtside.shared.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.util.regex.Pattern;

@Component
@RequiredArgsConstructor
class RefusesAmbiguity {

    // A name is echoed only when it could not itself be the payload, because the answer to an
    // ambiguous request must not become a way to write arbitrary text back to its sender.
    private static final Pattern QUOTABLE = Pattern.compile("[A-Za-z0-9_.-]{1,64}");

    private final ObjectMapper objectMapper;
    private final ProblemTraceReference traceReference;

    void write(HttpServletRequest request, HttpServletResponse response, String what, String name)
            throws IOException {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
                QUOTABLE.matcher(name).matches()
                        ? "The request names the %s %s more than once".formatted(what, name)
                        : "The request names a %s more than once".formatted(what));
        problem.setType(URI.create("urn:courtside:error:ambiguous-parameter"));
        problem.setTitle("Ambiguous parameter");
        problem.setInstance(URI.create(request.getRequestURI()));
        traceReference.addTo(problem);
        response.setStatus(HttpStatus.BAD_REQUEST.value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), problem);
    }
}
