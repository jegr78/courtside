package org.courtside.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class SecurityRequestObservationFilterTest {

    private final SecurityRequestObservationFilter filter = new SecurityRequestObservationFilter();
    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(SecurityRequestObservationFilter.class);

    @Test
    void givenAClubDeployment_whenCreatingContext_thenNoRequestIsObserved() {
        // when / then
        contextRunner.withPropertyValues("courtside.environment=PRODUCTION").run(context ->
                assertThat(context).doesNotHaveBean(SecurityRequestObservationFilter.class));
    }

    @Test
    void givenASecurityEnvironment_whenCreatingContext_thenEveryRequestIsObserved() {
        // when / then
        contextRunner.withPropertyValues("courtside.environment=SECURITY").run(context ->
                assertThat(context).hasSingleBean(SecurityRequestObservationFilter.class));
    }

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
    void givenApiRequest_whenObserved_thenNormalizedHostAndSchemeAreReturned() throws Exception {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/source");
        request.setServerName("localhost");
        request.setScheme("https");
        MockHttpServletResponse response = new MockHttpServletResponse();

        // when
        filter.doFilter(request, response, new MockFilterChain());

        // then
        assertThat(response.getHeader("X-Courtside-Observed-Host")).isEqualTo("localhost");
        assertThat(response.getHeader("X-Courtside-Observed-Scheme")).isEqualTo("https");
    }
}
