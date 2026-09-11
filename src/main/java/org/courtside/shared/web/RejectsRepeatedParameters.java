package org.courtside.shared.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.security.autoconfigure.web.servlet.SecurityFilterProperties;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Map;

// A name the request states twice has two readings, and getParameterMap joins the query string and
// the form body into the single map every reading below this filter takes its value from.
@Component
@Order(SecurityFilterProperties.DEFAULT_FILTER_ORDER - 1)
@RequiredArgsConstructor
class RejectsRepeatedParameters extends OncePerRequestFilter {

    private final RefusesAmbiguity refusal;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String repeated = firstRepeatedName(request);
        if (repeated == null) {
            filterChain.doFilter(request, response);
            return;
        }
        refusal.write(request, response, "parameter", repeated);
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
