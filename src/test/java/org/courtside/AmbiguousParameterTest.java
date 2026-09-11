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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(IdentityTestFixture.class)
class AmbiguousParameterTest extends AbstractIntegrationTest {

    private static final String USERNAME = "richard.miles";
    private static final String ANOTHER_USERNAME = "john.roe";
    private static final String PASSWORD = "correct-horse-battery-staple";
    private static final String AMBIGUOUS = "urn:courtside:error:ambiguous-parameter";

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
    void createTheAccounts() {
        identity.createEnabledAccount(identity.createPerson("Richard", "Miles"), USERNAME,
                passwordEncoder.encode(PASSWORD), Set.of(Role.values()));
        identity.createEnabledAccount(identity.createPerson("John", "Roe"), ANOTHER_USERNAME,
                passwordEncoder.encode(PASSWORD), Set.of(Role.MEMBER));
    }

    @Test
    void givenAQueryParameterNamedTwice_whenBookingsAreRead_thenTheNamesAreNotJoinedIntoOneValue()
            throws Exception {
        // given
        signIn(USERNAME);

        // when
        HttpResponse<String> answer = send("GET", "/api/bookings?date=2026-05-12&date=2026-05-13");

        // then
        assertThat(answer.statusCode()).isEqualTo(400);
        assertThat(type(answer)).isEqualTo(AMBIGUOUS);
        assertThat(detail(answer)).contains("date");
    }

    // A refusal that arrives after the handler has run is a report, not a guard, so the answer has
    // to be the one the handler could not have produced.
    @Test
    void givenAQueryParameterNamedTwice_whenASeriesIsCancelled_thenNoHandlerEverSawTheRequest()
            throws Exception {
        // given
        signIn(USERNAME);
        String series = "/api/booking-series/" + UUID.randomUUID();
        String scope = "&scope=THIS_AND_FOLLOWING";

        // when
        HttpResponse<String> ambiguous = send("DELETE",
                series + "?fromBookingId=" + UUID.randomUUID() + scope + scope);
        HttpResponse<String> unambiguous = send("DELETE",
                series + "?fromBookingId=" + UUID.randomUUID() + scope);

        // then
        assertThat(ambiguous.statusCode()).isEqualTo(400);
        assertThat(type(ambiguous)).isEqualTo(AMBIGUOUS);
        assertThat(unambiguous.statusCode()).isEqualTo(404);
    }

    @Test
    void givenAFormParameterNamedTwice_whenSigningIn_thenNoSessionIsEstablished() throws Exception {
        // given
        primeTheCsrfToken();

        // when
        HttpResponse<String> answer = postForm("username=" + USERNAME + "&username="
                + ANOTHER_USERNAME + "&password=" + PASSWORD);

        // then
        assertThat(answer.statusCode()).isEqualTo(400);
        assertThat(type(answer)).isEqualTo(AMBIGUOUS);
        assertThat(send("GET", "/api/my/bookings").statusCode()).isEqualTo(401);
    }

    // getParameterMap reads the query string and the form body as one map, so a name that appears
    // once in each is named twice in the only reading the application ever performs.
    @Test
    void givenANameInBothTheQueryAndTheForm_whenSigningIn_thenNoSessionIsEstablished()
            throws Exception {
        // given
        primeTheCsrfToken();

        // when
        HttpResponse<String> answer = postForm("/api/session?username=" + ANOTHER_USERNAME,
                "username=" + USERNAME + "&password=" + PASSWORD);

        // then
        assertThat(answer.statusCode()).isEqualTo(400);
        assertThat(type(answer)).isEqualTo(AMBIGUOUS);
        assertThat(send("GET", "/api/my/bookings").statusCode()).isEqualTo(401);
    }

    @Test
    void givenEveryParameterNamedOnce_whenSigningIn_thenTheGuardLetsTheRequestThrough()
            throws Exception {
        // given
        primeTheCsrfToken();

        // when
        HttpResponse<String> answer =
                postForm("username=" + USERNAME + "&password=" + PASSWORD);

        // then
        assertThat(answer.statusCode()).isEqualTo(200);
        assertThat(send("GET", "/api/my/bookings").statusCode()).isEqualTo(200);
    }

    @Test
    void givenARepeatedNameOutsideTheContract_whenAPublicAddressIsRead_thenItIsRefusedAsWell()
            throws Exception {
        // when
        HttpResponse<String> answer = send("GET", "/api/public/config?unknown=a&unknown=b");

        // then
        assertThat(answer.statusCode()).isEqualTo(400);
        assertThat(type(answer)).isEqualTo(AMBIGUOUS);
    }

    // The parameter map holds nothing of a multipart body, so the part that repeats a name is read
    // behind the authorization decision rather than in front of it.
    @Test
    void givenAMultipartPartNamedTwice_whenALogoIsUploaded_thenNoHandlerChoosesBetweenThem()
            throws Exception {
        // given
        signIn(USERNAME);
        String boundary = "courtsideboundary";
        String body = part(boundary, "file", "one.png") + part(boundary, "file", "two.png")
                + "--" + boundary + "--\r\n";

        // when
        HttpResponse<String> answer = httpClient.send(HttpRequest.newBuilder(
                        URI.create(baseUrl() + "/api/admin/config/logo"))
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .header("X-XSRF-TOKEN", csrfToken())
                .PUT(HttpRequest.BodyPublishers.ofString(body))
                .build(), HttpResponse.BodyHandlers.ofString());

        // then
        assertThat(answer.statusCode()).isEqualTo(400);
        assertThat(type(answer)).isEqualTo(AMBIGUOUS);
        assertThat(detail(answer)).contains("file");
    }

    private static String part(String boundary, String name, String filename) {
        return "--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name
                + "\"; filename=\"" + filename + "\"\r\nContent-Type: image/png\r\n\r\nPNG\r\n";
    }

    private void signIn(String username) throws Exception {
        primeTheCsrfToken();
        assertThat(postForm("username=" + username + "&password=" + PASSWORD).statusCode())
                .isEqualTo(200);
    }

    private void primeTheCsrfToken() throws Exception {
        httpClient.send(HttpRequest.newBuilder(URI.create(baseUrl() + "/api/session")).GET().build(),
                HttpResponse.BodyHandlers.discarding());
    }

    private HttpResponse<String> postForm(String form) throws Exception {
        return postForm("/api/session", form);
    }

    private HttpResponse<String> postForm(String address, String form) throws Exception {
        return httpClient.send(HttpRequest.newBuilder(URI.create(baseUrl() + address))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("X-XSRF-TOKEN", csrfToken())
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> send(String method, String address) throws Exception {
        return httpClient.send(HttpRequest.newBuilder(URI.create(baseUrl() + address))
                .method(method, HttpRequest.BodyPublishers.noBody())
                .header("X-XSRF-TOKEN", csrfToken())
                .build(), HttpResponse.BodyHandlers.ofString());
    }

    private String csrfToken() {
        return ((CookieManager) httpClient.cookieHandler().orElseThrow()).getCookieStore()
                .getCookies().stream()
                .filter(cookie -> cookie.getName().equals("XSRF-TOKEN"))
                .map(java.net.HttpCookie::getValue)
                .findFirst()
                .orElse("");
    }

    private String type(HttpResponse<String> answer) {
        return node(answer).at("/type").asString();
    }

    private String detail(HttpResponse<String> answer) {
        return node(answer).at("/detail").asString();
    }

    private JsonNode node(HttpResponse<String> answer) {
        return mapper.readTree(answer.body());
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + port;
    }
}
