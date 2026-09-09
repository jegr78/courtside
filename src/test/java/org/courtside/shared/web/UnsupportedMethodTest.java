package org.courtside.shared.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(IdentityTestFixture.class)
class UnsupportedMethodTest extends AbstractIntegrationTest {

    private static final String USERNAME = "doe.jane";
    private static final String PASSWORD = "correct-horse-battery-staple";
    private static final String CSRF_TOKEN = "11111111-2222-3333-4444-555555555555";
    private static final String PROBLEM_JSON = "application/problem+json";

    @LocalServerPort
    private int port;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private String sessionCookie;

    @BeforeEach
    void aMemberWhoIsSignedIn() throws Exception {
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createEnabledAccount(personId, USERNAME, passwordEncoder.encode(PASSWORD),
                Set.of(Role.MEMBER));
        sessionCookie = signIn();
    }

    @Test
    void givenASignedInMember_whenTheyUseAMethodTheRouteDoesNotDeclare_thenTheApplicationRefusesIt()
            throws Exception {
        // when
        HttpResponse<String> response = send("PATCH", "/api/public/config", sessionCookie);

        // then
        assertThat(response.statusCode()).isEqualTo(405);
        assertThat(response.headers().firstValue("Content-Type").orElseThrow())
                .startsWith(PROBLEM_JSON);
        assertThat(response.headers().firstValue("Allow")).contains("GET");
        JsonNode problem = objectMapper.readTree(response.body());
        assertThat(problem.at("/type").asString())
                .isEqualTo("urn:courtside:error:method-not-supported");
        assertThat(problem.at("/title").asString()).isEqualTo("Method not allowed");
    }

    @ParameterizedTest
    @ValueSource(strings = {"X-HTTP-Method", "X-HTTP-Method-Override", "X-Method-Override"})
    void givenAMethodOverrideHeader_whenPostingToAReadOnlyRoute_thenItCannotTurnTheRequestIntoAGet(
            String overrideHeader) throws Exception {
        // when
        HttpResponse<String> response = send("POST", "/api/public/config", sessionCookie,
                overrideHeader, "GET");

        // then
        assertThat(response.statusCode()).isEqualTo(405);
        assertThat(response.headers().firstValue("Content-Type").orElseThrow())
                .startsWith(PROBLEM_JSON);
        assertThat(objectMapper.readTree(response.body()).at("/type").asString())
                .isEqualTo("urn:courtside:error:method-not-supported");
    }

    @Test
    void givenASignedInMember_whenTheyUseAMethodTheContainerRefuses_thenTheRefusalIsATypedProblem()
            throws Exception {
        // when — Tomcat answers TRACE itself, so this never reaches a handler
        HttpResponse<String> response = send("TRACE", "/api/public/config", sessionCookie);

        // then
        assertThat(response.statusCode()).isEqualTo(405);
        assertThat(response.headers().firstValue("Content-Type").orElseThrow())
                .startsWith(PROBLEM_JSON);
        assertThat(response.headers().firstValue("Allow")).isPresent();
        JsonNode problem = objectMapper.readTree(response.body());
        assertThat(problem.at("/type").asString())
                .isEqualTo("urn:courtside:error:method-not-supported");
        assertThat(problem.at("/title").asString()).isEqualTo("Method not allowed");
    }

    @Test
    void whenAMethodNobodyRecognisesArrives_thenItIsRejectedAsATypedProblemRatherThanAServerError()
            throws Exception {
        // when — the request firewall answers before authentication
        HttpResponse<String> response = send("PROPFIND", "/api/public/config", null);

        // then
        assertThat(response.statusCode()).isEqualTo(400);
        assertThat(response.headers().firstValue("Content-Type").orElseThrow())
                .startsWith(PROBLEM_JSON);
        JsonNode problem = objectMapper.readTree(response.body());
        assertThat(problem.at("/type").asString())
                .isEqualTo("urn:courtside:error:request-rejected");
        assertThat(problem.at("/title").asString()).isEqualTo("Request rejected");
    }

    @Test
    void givenAStaticAssetDirectory_whenItIsRequested_thenNoDirectoryListingIsReturned()
            throws Exception {
        // when
        HttpResponse<String> response = send("GET", "/assets/", null);

        // then
        assertThat(response.statusCode()).isEqualTo(404);
        assertThat(response.headers().firstValue("Content-Type").orElseThrow())
                .startsWith(PROBLEM_JSON);
        JsonNode problem = objectMapper.readTree(response.body());
        assertThat(problem.at("/type").asString())
                .isEqualTo("urn:courtside:error:unmapped-path");
    }

    @ParameterizedTest
    @CsvSource({
            "/actuator/prometheus,403,urn:courtside:error:access-denied",
            "/swagger-ui/index.html,404,urn:courtside:error:unmapped-path",
            "/.git/config,404,urn:courtside:error:unmapped-path"
    })
    void givenAMember_whenAnInternalOrMetadataPathIsRequested_thenItIsNotPublished(
            String path, int expectedStatus, String expectedType) throws Exception {
        // when
        HttpResponse<String> response = send("GET", path, sessionCookie);

        // then
        assertThat(response.statusCode()).isEqualTo(expectedStatus);
        assertThat(response.headers().firstValue("Content-Type").orElseThrow())
                .startsWith(PROBLEM_JSON);
        assertThat(objectMapper.readTree(response.body()).at("/type").asString())
                .isEqualTo(expectedType);
    }

    @Test
    void givenNobodyIsSignedIn_whenTheyAskForAProtectedResource_thenTheyAreStillTurnedAway()
            throws Exception {
        // when - permitting the error dispatch decides nothing about the request itself
        HttpResponse<String> response = send("GET", "/api/my/bookings", null);

        // then
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(response.headers().firstValue("Content-Type").orElseThrow())
                .startsWith(PROBLEM_JSON);
        assertThat(objectMapper.readTree(response.body()).at("/type").asString())
                .isEqualTo("urn:courtside:error:unauthenticated");
    }

    @Test
    void givenNobodyIsSignedIn_whenAMethodTheContainerRefusesArrives_thenTheRefusalStillSurvives()
            throws Exception {
        // when
        HttpResponse<String> response = send("TRACE", "/api/my/bookings", null);

        // then
        assertThat(response.statusCode()).isEqualTo(405);
        assertThat(response.headers().firstValue("Content-Type").orElseThrow())
                .startsWith(PROBLEM_JSON);
        assertThat(objectMapper.readTree(response.body()).at("/type").asString())
                .isEqualTo("urn:courtside:error:method-not-supported");
    }

    private String signIn() throws Exception {
        HttpResponse<String> response = httpClient.send(HttpRequest.newBuilder(uri("/api/session"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Cookie", "XSRF-TOKEN=" + CSRF_TOKEN)
                .header("X-XSRF-TOKEN", CSRF_TOKEN)
                .POST(HttpRequest.BodyPublishers.ofString(
                        "username=" + USERNAME + "&password=" + PASSWORD))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        return response.headers().allValues("Set-Cookie").stream()
                .filter(cookie -> cookie.startsWith("SESSION=") || cookie.startsWith("JSESSIONID="))
                .map(cookie -> cookie.substring(0, cookie.indexOf(';')))
                .findFirst()
                .orElseThrow();
    }

    private HttpResponse<String> send(String method, String path, String session) throws Exception {
        return send(method, path, session, null, null);
    }

    private HttpResponse<String> send(String method, String path, String session,
                                      String headerName, String headerValue) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri(path))
                .header("X-XSRF-TOKEN", CSRF_TOKEN)
                .method(method, HttpRequest.BodyPublishers.noBody());
        if (headerName != null) {
            request.header(headerName, headerValue);
        }
        request.header("Cookie", session == null
                ? "XSRF-TOKEN=" + CSRF_TOKEN
                : session + "; XSRF-TOKEN=" + CSRF_TOKEN);
        return httpClient.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private URI uri(String path) {
        return URI.create("http://localhost:" + port + path);
    }
}
