package org.courtside.booking.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.regex.Pattern;

// Request logging prints the query string, so the occupancy key is masked there; parameters stay as sent.
@Component
class OccupancyKeyQueryMask extends OncePerRequestFilter {

    private static final String OCCUPANCY = "/api/public/occupancy";
    private static final Pattern KEY = Pattern.compile("(^|&)key=[^&]*");

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !OCCUPANCY.equals(request.getRequestURI());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        chain.doFilter(new HttpServletRequestWrapper(request) {
            @Override
            public String getQueryString() {
                String query = super.getQueryString();
                return query == null ? null : KEY.matcher(query).replaceAll("$1key=[REDACTED]");
            }
        }, response);
    }
}
