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

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
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
        ProblemDetailAuthenticationEntryPoint entryPoint = mock(ProblemDetailAuthenticationEntryPoint.class);
        FilterChain chain = mock(FilterChain.class);
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();
        CourtsideUserDetails user = new CourtsideUserDetails(
                accountId, "doe.jane", "password", true, true, List.of("ROLE_MEMBER"), 1L);
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(user, user.getPassword(), user.getAuthorities()));
        when(accounts.findSecurityEpochById(accountId)).thenReturn(Optional.of(2L));

        // when
        new SecurityEpochFilter(accounts, entryPoint).doFilter(request, response, chain);

        // then
        assertThat(request.getSession(false)).isNull();
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verify(entryPoint).commence(request, response, null);
        verifyNoInteractions(chain);
    }

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
