package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.TestPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = {
        "courtside.login-protection.address.max-failures=20",
        "courtside.login-protection.global.max-failures=3"
})
class LoginAttemptEncodedPathTest extends AbstractIntegrationTest {

    @LocalServerPort
    private int port;

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void givenAnEncodedLoginPath_whenFailingRepeatedly_thenAttemptsAreStillCounted() throws Exception {
        // given
        String csrfToken = UUID.randomUUID().toString();

        // when
        for (int attempt = 0; attempt < 3; attempt++) {
            HttpResponse<String> response = attemptLogin("/api/sessio%6E", csrfToken);
            assertThat(response.statusCode()).isEqualTo(401);
        }

        // then
        HttpResponse<String> response = attemptLogin("/api/session", csrfToken);
        assertThat(response.statusCode()).isEqualTo(429);
        JsonNode body = objectMapper.readTree(response.body());
        assertThat(body.at("/type").asText()).isEqualTo("urn:courtside:error:login-rate-limited");
        assertThat(body.at("/violations/0/code").asText()).isEqualTo("identity.login.rateLimited");
    }

    private HttpResponse<String> attemptLogin(String path, String csrfToken) throws Exception {
        String form = "username=jane.doe&password=wrong-password";
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Cookie", "XSRF-TOKEN=" + csrfToken)
                .header("X-XSRF-TOKEN", csrfToken)
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build();
        return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
