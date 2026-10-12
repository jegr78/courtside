package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RefusedRequestSessionCookieTest extends AbstractIntegrationTest {

    private static final Pattern ISSUED_SESSION = Pattern.compile("^(__Host-)?SESSION=[^;]+");
    private static final Pattern EXPIRED_SESSION = Pattern.compile("^(__Host-)?SESSION=;.*Max-Age=0");

    @LocalServerPort
    private int port;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @Test
    void givenABrowserNavigation_whenAProtectedResourceIsRefused_thenNoSessionCookieIsIssued() throws Exception {
        // when
        HttpResponse<String> refused = send(HttpRequest.newBuilder(protectedResource())
                .header("Accept", "text/html,application/xhtml+xml,*/*;q=0.8"));

        // then
        assertThat(refused.statusCode()).isEqualTo(401);
        assertThat(sessionCookies(refused)).as("a refused navigation opens no session").noneMatch(this::issues);
    }

    @Test
    void givenAStaleSessionCookie_whenAProtectedResourceIsRefused_thenTheCookieIsExpiredRatherThanReplaced()
            throws Exception {
        // when
        HttpResponse<String> refused = send(HttpRequest.newBuilder(protectedResource())
                .header("Accept", "*/*")
                .header("Cookie", "SESSION=c3RhbGU"));

        // then
        assertThat(refused.statusCode()).isEqualTo(401);
        List<String> cookies = sessionCookies(refused);
        assertThat(cookies).as("a signed-out browser gets no fresh session").noneMatch(this::issues);
        assertThat(cookies).as("the stale cookie is cleared").anyMatch(cookie -> EXPIRED_SESSION.matcher(cookie).find());
    }

    private URI protectedResource() {
        return URI.create("http://127.0.0.1:" + port + "/api/my/waitlist");
    }

    private HttpResponse<String> send(HttpRequest.Builder request) throws Exception {
        return httpClient.send(request.GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private static List<String> sessionCookies(HttpResponse<String> response) {
        return response.headers().allValues("Set-Cookie").stream()
                .filter(cookie -> cookie.startsWith("SESSION=") || cookie.startsWith("__Host-SESSION="))
                .toList();
    }

    private boolean issues(String cookie) {
        return ISSUED_SESSION.matcher(cookie).find() && !EXPIRED_SESSION.matcher(cookie).find();
    }
}
