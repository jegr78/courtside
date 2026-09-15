package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(IdentityTestFixture.class)
class CsrfTokenIssuanceTest extends AbstractIntegrationTest {

    private static final String USERNAME = "doe.jane";
    private static final String PASSWORD = "correct-horse-battery-staple";

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @LocalServerPort
    private int port;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Test
    void whenTheSessionIsReadWithoutCookies_thenATokenIsIssued() throws Exception {
        // when
        HttpResponse<Void> response = fetchWithoutCookies("/api/session");

        // then
        assertThat(csrfCookies(response)).singleElement().asString().isNotBlank();
    }

    @ParameterizedTest
    @ValueSource(strings = {"/", "/login", "/sw.js", "/workbox-98f7a950.js", "/manifest.webmanifest",
            "/assets/index.js", "/robots.txt", "/sitemap.xml", "/api/source", "/api/public/config/logo"})
    void whenAnythingElseIsFetchedWithoutCookies_thenNoTokenIsIssued(String path) throws Exception {
        // when
        HttpResponse<Void> response = fetchWithoutCookies(path);

        // then
        assertThat(csrfCookies(response)).isEmpty();
    }

    @Test
    void givenAnAnonymousToken_whenTheMemberSignsIn_thenTheSignInIssuesAFreshOne() throws Exception {
        // given
        identity.createEnabledAccount(identity.createPerson("Jane", "Doe"), USERNAME,
                passwordEncoder.encode(PASSWORD), Set.of(Role.MEMBER));
        String anonymous = csrfCookies(fetchWithoutCookies("/api/session")).getFirst();

        // when
        HttpResponse<Void> signIn = httpClient.send(HttpRequest.newBuilder(uri("/api/session"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Cookie", "XSRF-TOKEN=" + anonymous)
                .header("X-XSRF-TOKEN", anonymous)
                .POST(HttpRequest.BodyPublishers.ofString("username=" + USERNAME + "&password=" + PASSWORD))
                .build(), HttpResponse.BodyHandlers.discarding());

        // then
        assertThat(signIn.statusCode()).isEqualTo(200);
        assertThat(csrfCookies(signIn)).filteredOn(value -> !value.isEmpty())
                .singleElement().isNotEqualTo(anonymous);
    }

    private HttpResponse<Void> fetchWithoutCookies(String path) throws Exception {
        return httpClient.send(HttpRequest.newBuilder(uri(path)).GET().build(), HttpResponse.BodyHandlers.discarding());
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    private static List<String> csrfCookies(HttpResponse<Void> response) {
        return response.headers().allValues("Set-Cookie").stream()
                .filter(header -> header.startsWith("XSRF-TOKEN=") || header.startsWith("__Host-XSRF-TOKEN="))
                .map(header -> header.substring(header.indexOf('=') + 1).split(";", 2)[0])
                .toList();
    }
}
