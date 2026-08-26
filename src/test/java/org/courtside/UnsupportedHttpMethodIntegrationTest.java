package org.courtside;

import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpCookie;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class UnsupportedHttpMethodIntegrationTest extends AbstractIntegrationTest {

    private static final String USERNAME = "jane.doe";
    private static final String PASSWORD = "correct-horse-battery-staple";

    @LocalServerPort
    private int port;

    @Autowired
    private PersonRepository people;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
    private final HttpClient httpClient = HttpClient.newBuilder().cookieHandler(cookies).build();

    @BeforeEach
    void setUp() throws Exception {
        Person person = people.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount account = new UserAccount(
                person, USERNAME, passwordEncoder.encode(PASSWORD), Set.of(Role.MEMBER), "en");
        account.enable();
        accounts.save(account);
        signIn();
    }

    @Test
    void givenAnUnknownHttpMethod_whenRequestingTheApplicationDirectly_thenTheContainerRejectsItWithoutA5xx()
            throws Exception {
        // given
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port
                        + "/api/public/participant-members"))
                .header("X-XSRF-TOKEN", csrfToken())
                .method("QUERY", HttpRequest.BodyPublishers.noBody())
                .build();

        // when
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        // then
        assertThat(response.statusCode()).as(response.body()).isEqualTo(400);
    }

    private void signIn() throws Exception {
        URI sessionUri = URI.create("http://127.0.0.1:" + port + "/api/session");
        httpClient.send(HttpRequest.newBuilder(sessionUri).GET().build(), HttpResponse.BodyHandlers.discarding());
        String csrf = csrfToken();
        String form = "username=" + URLEncoder.encode(USERNAME, StandardCharsets.UTF_8)
                + "&password=" + URLEncoder.encode(PASSWORD, StandardCharsets.UTF_8);
        HttpResponse<Void> response = httpClient.send(HttpRequest.newBuilder(sessionUri)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("X-XSRF-TOKEN", csrf)
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build(), HttpResponse.BodyHandlers.discarding());
        assertThat(response.statusCode()).isEqualTo(200);
    }

    private String csrfToken() {
        return cookies.getCookieStore().getCookies().stream()
                .filter(cookie -> cookie.getName().equals("XSRF-TOKEN"))
                .map(HttpCookie::getValue)
                .map(value -> URLDecoder.decode(value, StandardCharsets.UTF_8))
                .reduce((first, second) -> second)
                .orElseThrow();
    }
}
