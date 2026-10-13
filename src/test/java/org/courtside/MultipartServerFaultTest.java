package org.courtside;

import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "spring.servlet.multipart.location=/nonexistent/courtside-uploads")
@Import(IdentityTestFixture.class)
class MultipartServerFaultTest extends AbstractIntegrationTest {

    private static final String USERNAME = "richard.miles";
    private static final String PASSWORD = "correct-horse-battery-staple";

    @LocalServerPort
    private int port;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private final ObjectMapper mapper = new ObjectMapper();

    private final HttpClient httpClient = HttpClient.newBuilder()
            .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();

    @BeforeEach
    void anAdministrator() {
        identity.createEnabledAccount(identity.createPerson("Richard", "Miles"), USERNAME,
                passwordEncoder.encode(PASSWORD), Set.of(Role.values()));
    }

    @Test
    void givenAnUploadDirectoryThatIsGone_whenAWellFormedLogoIsUploaded_thenTheServerOwnsTheFailure()
            throws Exception {
        // given
        signIn();
        String boundary = "courtsideboundary";
        String body = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"logo.png\""
                + "\r\nContent-Type: image/png\r\n\r\nPNG\r\n--" + boundary + "--\r\n";

        // when
        HttpResponse<String> answer = httpClient.send(HttpRequest.newBuilder(
                        URI.create(baseUrl() + "/api/admin/config/logo"))
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .header("X-XSRF-TOKEN", csrfToken())
                .PUT(HttpRequest.BodyPublishers.ofString(body))
                .build(), HttpResponse.BodyHandlers.ofString());

        // then
        JsonNode problem = mapper.readTree(answer.body());
        assertThat(answer.statusCode()).as(answer.body()).isEqualTo(500);
        assertThat(problem.at("/type").asString()).as("the board did nothing wrong")
                .isNotEqualTo("urn:courtside:error:malformed-request-body");
        assertThat(problem.at("/traceId").asString()).as("the operator can find the failure").isNotBlank();
    }

    private void signIn() throws Exception {
        httpClient.send(HttpRequest.newBuilder(URI.create(baseUrl() + "/api/session")).GET().build(),
                HttpResponse.BodyHandlers.discarding());
        HttpResponse<String> signedIn = httpClient.send(HttpRequest.newBuilder(URI.create(baseUrl() + "/api/session"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("X-XSRF-TOKEN", csrfToken())
                .POST(HttpRequest.BodyPublishers.ofString("username=" + USERNAME + "&password=" + PASSWORD))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(signedIn.statusCode()).isEqualTo(200);
    }

    private String csrfToken() {
        return ((CookieManager) httpClient.cookieHandler().orElseThrow()).getCookieStore()
                .getCookies().stream()
                .filter(cookie -> cookie.getName().equals("XSRF-TOKEN"))
                .map(java.net.HttpCookie::getValue)
                .findFirst()
                .orElse("");
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + port;
    }
}
