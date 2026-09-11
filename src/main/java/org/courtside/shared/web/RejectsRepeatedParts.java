package org.courtside.shared.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.Part;
import lombok.RequiredArgsConstructor;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.HashSet;
import java.util.Set;

// A multipart body's parts reach no parameter map, so the repeated name a form can still carry is
// read behind the authorization decision, because reading it parses an upload nobody parsed before.
@Component
@Order(Ordered.LOWEST_PRECEDENCE - 1)
@RequiredArgsConstructor
class RejectsRepeatedParts extends OncePerRequestFilter {

    private final RefusesAmbiguity refusal;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String repeated = carriesMultipart(request) ? firstRepeatedName(request) : null;
        if (repeated == null) {
            filterChain.doFilter(request, response);
            return;
        }
        refusal.write(request, response, "part", repeated);
    }

    private static boolean carriesMultipart(HttpServletRequest request) {
        return StringUtils.startsWithIgnoreCase(request.getContentType(), "multipart/");
    }

    // A body this filter cannot read is a body the resolver below reports on, and its answer says
    // what is wrong with more than a repeated name would.
    private static String firstRepeatedName(HttpServletRequest request) {
        Set<String> seen = new HashSet<>();
        try {
            for (Part part : request.getParts()) {
                if (!seen.add(part.getName())) {
                    return part.getName();
                }
            }
        } catch (ServletException | IOException | IllegalStateException unreadable) {
            return null;
        }
        return null;
    }
}
