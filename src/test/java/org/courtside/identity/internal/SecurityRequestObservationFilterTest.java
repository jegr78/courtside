package org.courtside.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class SecurityRequestObservationFilterTest {

    private final SecurityRequestObservationFilter filter = new SecurityRequestObservationFilter();

    @Test
    void givenHealthRequest_whenObserved_thenNormalizedHostAndSchemeAreReturned() throws Exception {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/actuator/health");
        request.setServerName("localhost");
        request.setScheme("https");
        MockHttpServletResponse response = new MockHttpServletResponse();

        // when
        filter.doFilter(request, response, new MockFilterChain());

        // then
        assertThat(response.getHeader("X-Courtside-Observed-Host")).isEqualTo("localhost");
        assertThat(response.getHeader("X-Courtside-Observed-Scheme")).isEqualTo("https");
    }

    @Test
    void givenNonHealthRequest_whenObserved_thenNoDiagnosticHeadersAreReturned() throws Exception {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/source");
        MockHttpServletResponse response = new MockHttpServletResponse();

        // when
        filter.doFilter(request, response, new MockFilterChain());

        // then
        assertThat(response.getHeaderNames()).isEmpty();
    }
}
