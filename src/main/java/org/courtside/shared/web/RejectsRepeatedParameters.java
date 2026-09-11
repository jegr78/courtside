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
        // Reading the parameter map of a multipart request parses the upload and spools every part
        // to disk, so that body is left to the filter behind the authorization decision.
        String repeated = Multipart.carriedBy(request)
                ? null
                : Multipart.firstRepeatedParameter(request);
        if (repeated == null) {
            filterChain.doFilter(request, response);
            return;
        }
        refusal.report(request, response, "parameter", repeated);
    }
}
