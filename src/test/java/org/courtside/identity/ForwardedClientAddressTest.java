package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ForwardedClientAddressTest extends AbstractIntegrationTest {

    private static final String FIRST_CLIENT = "198.51.100.7";
    private static final String SECOND_CLIENT = "198.51.100.8";

    @LocalServerPort
    private int port;

    @Autowired
    private JdbcClient jdbc;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @Test
    void givenTwoForwardedClientAddresses_whenEachFailsALogin_thenEachKeepsItsOwnAttemptBudget() throws Exception {
        // given
        String csrfToken = UUID.randomUUID().toString();

        // when
        assertThat(attemptLogin(csrfToken, FIRST_CLIENT).statusCode()).isEqualTo(401);
        assertThat(attemptLogin(csrfToken, SECOND_CLIENT).statusCode()).isEqualTo(401);

        // then
        assertThat(addressSubjects()).containsExactlyInAnyOrder(
                loginSubject(FIRST_CLIENT), loginSubject(SECOND_CLIENT));
    }

    private List<String> addressSubjects() {
        return jdbc.sql("SELECT subject_hash FROM login_attempt_limit WHERE scope = 'ADDRESS'")
                .query(String.class).list();
    }

    private static String loginSubject(String address) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(("login:" + address).getBytes(StandardCharsets.UTF_8)));
    }

    private HttpResponse<String> attemptLogin(String csrfToken, String forwardedFor) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/session"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Cookie", "XSRF-TOKEN=" + csrfToken)
                .header("X-XSRF-TOKEN", csrfToken)
                .header("X-Forwarded-For", forwardedFor)
                .POST(HttpRequest.BodyPublishers.ofString("username=doe.jane&password=wrong-password"))
                .build();
        return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
