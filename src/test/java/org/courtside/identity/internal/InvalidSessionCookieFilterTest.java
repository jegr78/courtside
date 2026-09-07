package org.courtside.identity.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.session.web.http.CookieSerializer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.same;
import static org.mockito.Mockito.verify;

class InvalidSessionCookieFilterTest {

    @Test
    void givenAnInvalidSecureSessionCookie_whenARequestArrives_thenTheBrowserCookieIsExpired() throws Exception {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setSecure(true);
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);
        var serializer = SecurityConfiguration.sessionCookieSerializer(true);
        addSessionCookie(request, serializer, "__Host-SESSION");

        // when
        new InvalidSessionCookieFilter(serializer).doFilter(request, response, chain);

        // then
        assertThat(response.getHeader("Set-Cookie"))
                .startsWith("__Host-SESSION=;")
                .contains("Max-Age=0", "Path=/", "Secure", "HttpOnly", "SameSite=Lax")
                .doesNotContain("Domain=");
        verify(chain).doFilter(same(request), any(HttpServletResponse.class));
    }

    @Test
    void givenAnInvalidCookie_whenTheResponseCommits_thenExpiryIsWrittenBeforeTheCommit() throws Exception {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setSecure(true);
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = (filteredRequest, filteredResponse) -> filteredResponse.flushBuffer();
        var serializer = SecurityConfiguration.sessionCookieSerializer(true);
        addSessionCookie(request, serializer, "__Host-SESSION");

        // when
        new InvalidSessionCookieFilter(serializer).doFilter(request, response, chain);

        // then
        assertThat(response.isCommitted()).isTrue();
        assertThat(response.getHeader("Set-Cookie"))
                .startsWith("__Host-SESSION=;")
                .contains("Max-Age=0", "Secure", "HttpOnly");
    }

    @Test
    void givenAValidSessionCookie_whenARequestArrives_thenItIsKept() throws Exception {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setSecure(true);
        request.setSession(new MockHttpSession());
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);
        var serializer = SecurityConfiguration.sessionCookieSerializer(true);
        addSessionCookie(request, serializer, "__Host-SESSION");

        // when
        new InvalidSessionCookieFilter(serializer).doFilter(request, response, chain);

        // then
        assertThat(response.getHeader("Set-Cookie")).isNull();
        verify(chain).doFilter(request, response);
    }

    @Test
    void givenAnInvalidCookie_whenTheRequestCreatesAValidSession_thenNoExpiryOverwritesIt() throws Exception {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setSecure(true);
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = (filteredRequest, filteredResponse) -> request.setSession(new MockHttpSession());
        var serializer = SecurityConfiguration.sessionCookieSerializer(true);
        addSessionCookie(request, serializer, "__Host-SESSION");

        // when
        new InvalidSessionCookieFilter(serializer).doFilter(request, response, chain);

        // then
        assertThat(response.getHeader("Set-Cookie")).isNull();
    }

    @Test
    void givenNoRequestedSession_whenARequestArrives_thenNoCookieIsWritten() throws Exception {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        // when
        new InvalidSessionCookieFilter(SecurityConfiguration.sessionCookieSerializer(false))
                .doFilter(request, response, chain);

        // then
        assertThat(response.getHeader("Set-Cookie")).isNull();
        verify(chain).doFilter(request, response);
    }

    private void addSessionCookie(MockHttpServletRequest request, CookieSerializer serializer, String name) {
        var issued = new MockHttpServletResponse();
        serializer.writeCookieValue(new CookieSerializer.CookieValue(request, issued, "expired-session"));
        String header = issued.getHeader("Set-Cookie");
        request.setCookies(new Cookie(name, header.substring(header.indexOf('=') + 1, header.indexOf(';'))));
    }
}
