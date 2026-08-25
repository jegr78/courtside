package org.courtside.identity.internal;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.web.csrf.CsrfTokenRepository;

import static org.assertj.core.api.Assertions.assertThat;

class SecurityConfigurationTest {

    @Test
    void givenSecureCookiesAreEnabled_whenTheCsrfTokenIsIssued_thenTheCookieIsSecure() {
        // when
        Cookie cookie = issueCsrfCookie(true);

        // then
        assertThat(cookie.getSecure()).isTrue();
    }

    @Test
    void givenSecureCookiesAreDisabled_whenTheCsrfTokenIsIssued_thenTheCookieIsNotSecure() {
        // when
        Cookie cookie = issueCsrfCookie(false);

        // then
        assertThat(cookie.getSecure()).isFalse();
    }

    @Test
    void whenTheCsrfTokenIsIssued_thenTheCookieUsesExplicitLaxIsolation() {
        // when
        Cookie cookie = issueCsrfCookie(true);

        // then
        assertThat(cookie.getAttribute("SameSite")).isEqualTo("Lax");
        assertThat(cookie.isHttpOnly()).isFalse();
        assertThat(cookie.getPath()).isEqualTo("/");
    }

    private Cookie issueCsrfCookie(boolean secureCookies) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();
        CsrfTokenRepository repository = SecurityConfiguration.csrfTokenRepository(secureCookies);

        repository.saveToken(repository.generateToken(request), request, response);

        return response.getCookie("XSRF-TOKEN");
    }
}
