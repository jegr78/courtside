package org.courtside.identity.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.courtside.identity.UserAccountRepository;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.session.web.http.CookieSerializer;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class SecurityConfigurationTest {

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void givenAStaleSecurityEpochWithoutASession_whenTheRequestIsFiltered_thenAuthenticationFailsClosed()
            throws Exception {
        // given
        UUID accountId = UUID.randomUUID();
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        FilterChain chain = mock(FilterChain.class);
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();
        CourtsideUserDetails user = new CourtsideUserDetails(
                accountId, "doe.jane", "password", true, true, List.of("ROLE_MEMBER"), 1L);
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(user, user.getPassword(), user.getAuthorities()));
        when(accounts.findSecurityEpochById(accountId)).thenReturn(Optional.of(2L));

        // when
        new SecurityEpochFilter(accounts).doFilter(request, response, chain);

        // then
        assertThat(request.getSession(false)).isNull();
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        // The request carries on without authority: what needs it is refused by the layer that
        // refuses every unauthenticated request, and the sign-in that replaces the session is not.
        verify(chain).doFilter(request, response);
    }

    @Test
    void givenSecureCookiesAreEnabled_whenTheCsrfTokenIsIssued_thenTheCookieIsHostBound() {
        // when
        Cookie cookie = issueCsrfCookie(true, false);

        // then
        assertThat(cookie.getName()).isEqualTo("__Host-XSRF-TOKEN");
        assertThat(cookie.getSecure()).isTrue();
        assertThat(cookie.getDomain()).isNull();
    }

    @Test
    void givenSecureCookiesAreDisabled_whenTheCsrfTokenIsIssued_thenTheCookieIsNotSecure() {
        // when
        Cookie cookie = issueCsrfCookie(false, false);

        // then
        assertThat(cookie.getName()).isEqualTo("XSRF-TOKEN");
        assertThat(cookie.getSecure()).isFalse();
    }

    @Test
    void givenAnHttpsRequestInLocalMode_whenTheCsrfTokenIsIssued_thenTheCookieIsHostBound() {
        assertThat(issueCsrfCookie(false, true).getName()).isEqualTo("__Host-XSRF-TOKEN");
    }

    @Test
    void whenTheCsrfTokenIsIssued_thenTheCookieUsesExplicitLaxIsolation() {
        // when
        Cookie cookie = issueCsrfCookie(true, false);

        // then
        assertThat(cookie.getAttribute("SameSite")).isEqualTo("Lax");
        assertThat(cookie.isHttpOnly()).isFalse();
        assertThat(cookie.getPath()).isEqualTo("/");
    }

    @Test
    void givenSecureCookiesAreEnabled_whenTheSessionCookieIsIssued_thenItIsHostBound() {
        assertThat(issueSessionCookie(true, false))
                .startsWith("__Host-SESSION=")
                .contains("; Path=/", "; Secure", "; HttpOnly", "; SameSite=Lax")
                .doesNotContain("Domain=");
    }

    @Test
    void givenAnHttpsRequestInLocalMode_whenTheSessionCookieIsIssued_thenItIsHostBound() {
        assertThat(issueSessionCookie(false, true)).startsWith("__Host-SESSION=").contains("; Secure");
    }

    @Test
    void givenSecureAndLegacySessionCookies_whenTheSecureRequestIsRead_thenOnlyTheHostCookieIsAccepted() {
        String issuedCookie = issueSessionCookie(true, false);
        String encodedHostSession = issuedCookie.substring(issuedCookie.indexOf('=') + 1, issuedCookie.indexOf(';'));
        MockHttpServletRequest request = requestWithCookies(
                new Cookie("SESSION", "planted-legacy-session"),
                new Cookie("__Host-SESSION", encodedHostSession));

        assertThat(SecurityConfiguration.sessionCookieSerializer(true).readCookieValues(request))
                .containsExactly("opaque-session");
    }

    @Test
    void givenSecureAndLegacyCsrfCookies_whenTheSecureRequestIsRead_thenOnlyTheHostCookieIsAccepted() {
        MockHttpServletRequest request = requestWithCookies(
                new Cookie("XSRF-TOKEN", "planted-legacy-token"),
                new Cookie("__Host-XSRF-TOKEN", "host-token"));

        assertThat(SecurityConfiguration.csrfTokenRepository(true).loadToken(request).getToken())
                .isEqualTo("host-token");
    }

    @Test
    void givenPlainHttpLocalMode_whenTheSessionCookieIsIssued_thenItUsesTheDevelopmentPolicy() {
        assertThat(issueSessionCookie(false, false))
                .startsWith("SESSION=")
                .contains("; Path=/", "; HttpOnly", "; SameSite=Lax")
                .doesNotContain("; Secure", "Domain=");
    }

    @Test
    void givenProductionIsConfiguredWithoutSecureCookies_whenThePolicyIsValidated_thenStartupIsRefused() {
        assertThatThrownBy(() -> SecurityConfiguration.validateCookiePolicy(false, "production"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_COOKIE_SECURE=false")
                .hasMessageContaining("non-production");
    }

    @Test
    void givenAControlledUatIsConfiguredWithoutSecureCookies_whenThePolicyIsValidated_thenItIsAccepted() {
        SecurityConfiguration.validateCookiePolicy(false, "UAT");
    }

    private Cookie issueCsrfCookie(boolean secureCookies, boolean requestSecure) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setSecure(requestSecure);
        MockHttpServletResponse response = new MockHttpServletResponse();
        CsrfTokenRepository repository = SecurityConfiguration.csrfTokenRepository(secureCookies);

        repository.saveToken(repository.generateToken(request), request, response);

        return response.getCookies()[0];
    }

    private String issueSessionCookie(boolean secureCookies, boolean requestSecure) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setSecure(requestSecure);
        MockHttpServletResponse response = new MockHttpServletResponse();
        CookieSerializer serializer = SecurityConfiguration.sessionCookieSerializer(secureCookies);
        serializer.writeCookieValue(new CookieSerializer.CookieValue(request, response, "opaque-session"));
        return response.getHeader("Set-Cookie");
    }

    private MockHttpServletRequest requestWithCookies(Cookie... cookies) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(cookies);
        return request;
    }
}
