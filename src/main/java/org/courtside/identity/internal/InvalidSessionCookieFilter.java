package org.courtside.identity.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.web.util.OnCommittedResponseWrapper;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

@RequiredArgsConstructor
class InvalidSessionCookieFilter extends OncePerRequestFilter {

    private final CookieSerializer cookieSerializer;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        boolean hasInvalidSessionCookie = !cookieSerializer.readCookieValues(request).isEmpty()
                && request.getSession(false) == null;
        if (!hasInvalidSessionCookie) {
            filterChain.doFilter(request, response);
            return;
        }
        InvalidSessionCookieResponse wrapped = new InvalidSessionCookieResponse(request, response);
        filterChain.doFilter(request, wrapped);
        wrapped.expireIfOrphaned();
    }

    private final class InvalidSessionCookieResponse extends OnCommittedResponseWrapper {

        private final HttpServletRequest request;
        private boolean handled;

        private InvalidSessionCookieResponse(HttpServletRequest request, HttpServletResponse response) {
            super(response);
            this.request = request;
        }

        @Override
        protected void onResponseCommitted() {
            expireIfOrphaned();
        }

        private void expireIfOrphaned() {
            if (handled) {
                return;
            }
            handled = true;
            if (request.getSession(false) == null) {
                CookieSerializer.CookieValue expired = new CookieSerializer.CookieValue(request, this, "");
                expired.setCookieMaxAge(0);
                cookieSerializer.writeCookieValue(expired);
            }
        }
    }
}
