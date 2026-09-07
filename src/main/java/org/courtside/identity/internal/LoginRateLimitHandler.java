package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.time.Duration;

@Component
@RequiredArgsConstructor
class LoginRateLimitHandler {

    private final ObjectMapper objectMapper;

    void handle(HttpServletResponse response, Duration retryAfter, boolean login) throws IOException {
        long retryAfterSeconds = retryAfter.getSeconds() + (retryAfter.getNano() == 0 ? 0 : 1);
        ProblemDetail problem = login
                ? new LoginRateLimitedException().getBody()
                : new PasswordVerificationRateLimitedException().getBody();

        response.setStatus(problem.getStatus());
        response.setHeader("Retry-After", Long.toString(retryAfterSeconds));
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), problem);
    }
}
