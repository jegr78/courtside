package org.courtside.shared.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.security.autoconfigure.web.servlet.SecurityFilterProperties;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.util.Map;
import java.util.regex.Pattern;

// A name the request states twice has two readings, and getParameterMap joins the query string and
// the form body into the single map every reading below this filter takes its value from.
@Component
@Order(SecurityFilterProperties.DEFAULT_FILTER_ORDER - 1)
@RequiredArgsConstructor
class RejectsRepeatedParameters extends OncePerRequestFilter {

    private static final Pattern QUOTABLE = Pattern.compile("[A-Za-z0-9_.-]{1,64}");

    private final ObjectMapper objectMapper;
    private final ProblemTraceReference traceReference;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String repeated = firstRepeatedName(request);
        if (repeated == null) {
            filterChain.doFilter(request, response);
            return;
        }
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
                QUOTABLE.matcher(repeated).matches()
                        ? "The request names the parameter " + repeated + " more than once"
                        : "The request names a parameter more than once");
        problem.setType(URI.create("urn:courtside:error:ambiguous-parameter"));
        problem.setTitle("Ambiguous parameter");
        problem.setInstance(URI.create(request.getRequestURI()));
        traceReference.addTo(problem);
        response.setStatus(HttpStatus.BAD_REQUEST.value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), problem);
    }

    private static String firstRepeatedName(HttpServletRequest request) {
        for (Map.Entry<String, String[]> parameter : request.getParameterMap().entrySet()) {
            if (parameter.getValue().length > 1) {
                return parameter.getKey();
            }
        }
        return null;
    }
}
