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
import org.springframework.web.util.UriUtils;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpCookie;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

// A header is the one place a stored or received text leaves the body and becomes structure, so
// every one this application writes has to say where its value came from.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(IdentityTestFixture.class)
class ResponseHeaderSurfaceTest extends AbstractIntegrationTest {

    private static final String USERNAME = "richard.miles";
    private static final String PASSWORD = "correct-horse-battery-staple";
    private static final String INJECTED = "X-Injected";

    private static final Pattern SERVLET_WRITE = Pattern.compile(
            "\\bresponse\\.(?:set|add)(?:Header|IntHeader|DateHeader)\\(\\s*\"([^\"]+)\"");
    private static final Pattern BUILDER_WRITE = Pattern.compile(
            "\\.header\\(\\s*(?:HttpHeaders\\.([A-Z_]+)|\"([^\"]+)\")");
    private static final Pattern CREATED = Pattern.compile("ResponseEntity\\.created\\(");
    private static final Pattern DISPOSITION = Pattern.compile(
            "attachment; filename=\"bookings-\\d{4}-\\d{2}-\\d{2}-\\d{4}-\\d{2}-\\d{2}\\.csv\"");

    // The outbound lookup builds a java.net.http request, so the two names it sets travel away from
    // this application rather than back to a caller.
    private static final String OUTBOUND =
            "org/courtside/identity/internal/HaveIBeenPwnedPasswordLookup.java";

    private static final Map<String, String> REVIEWED_SOURCES = Map.of(
            "org/courtside/booking/web/BookingController.java Location",
            "an identifier this application generated",
            "org/courtside/booking/web/SeriesController.java Location",
            "an identifier this application generated",
            "org/courtside/dataexchange/web/ExternalReferenceAdminController.java Location",
            "a stored identifier, escaped into one path segment",
            "org/courtside/dataexchange/web/ExportAdminController.java CONTENT_DISPOSITION",
            "a name built here from dates the request states",
            "org/courtside/identity/internal/LoginRateLimitHandler.java Retry-After",
            "a count of seconds this application formatted",
            "org/courtside/identity/internal/SecurityConfiguration.java "
                    + "X-Courtside-Password-Change-Required",
            "a constant",
            "org/courtside/identity/internal/SecurityRequestObservationFilter.java "
                    + "X-Courtside-Observed-Host",
            "the host the request named",
            "org/courtside/identity/internal/SecurityRequestObservationFilter.java "
                    + "X-Courtside-Observed-Scheme",
            "the scheme the request arrived on");

    @LocalServerPort
    private int port;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();

    @BeforeEach
    void createTheAdministrator() {
        identity.createEnabledAccount(identity.createPerson("Richard", "Miles"), USERNAME,
                passwordEncoder.encode(PASSWORD), Set.of(Role.values()));
    }

    @Test
    void whenEveryResponseHeaderThisApplicationWritesIsRead_thenTheInventoryNamesItsSource()
            throws IOException {
        // when
        Set<String> written = writtenHeaders();

        // then
        assertThat(written).containsExactlyInAnyOrderElementsOf(
                new TreeSet<>(REVIEWED_SOURCES.keySet()));
    }

    // The one file the derivation leaves out has to keep the shape that earned the exemption.
    @Test
    void givenTheOutboundLookupSetsHeadersToo_whenItIsLeftOut_thenItStillWritesNoAnswer()
            throws IOException {
        // given
        String source = Files.readString(Path.of("src/main/java", OUTBOUND));

        // when / then
        assertThat(source).contains("HttpRequest.newBuilder");
        assertThat(source).doesNotContain("ResponseEntity").doesNotContain("HttpServletResponse");
    }

    @Test
    void givenALineBreakInTheHostARequestNames_whenItWouldBecomeAHeader_thenTheConnectorRefusesIt()
            throws IOException {
        // when
        String answer = raw("GET /api/public/config HTTP/1.1\r\nHost: localhost\rX-Injected: yes\r\n\r\n");

        // then
        assertThat(answer).startsWith("HTTP/1.1 400")
                .contains("urn:courtside:error:request-rejected")
                .doesNotContain(INJECTED);
        assertThat(responses(answer)).isEqualTo(1);
    }

    // The forwarded host replaces the one the filter reflects, so it is the second way a caller
    // reaches that header's value and it is refused on the same ground.
    @Test
    void givenALineBreakInAForwardedHost_whenItWouldBecomeAHeader_thenTheConnectorRefusesIt()
            throws IOException {
        // when
        String answer = raw("GET /api/public/config HTTP/1.1\r\nHost: localhost\r\n"
                + "X-Forwarded-Host: other.example\rX-Injected: yes\r\n\r\n");

        // then
        assertThat(answer).startsWith("HTTP/1.1 400")
                .contains("urn:courtside:error:request-rejected");
        assertThat(headerNames(answer)).doesNotContain(INJECTED.toLowerCase());
        assertThat(responses(answer)).isEqualTo(1);
    }

    // The part guard reads the upload, so it has to sit behind the decision that says who may.
    @Test
    void givenNoSession_whenAMultipartPartIsNamedTwice_thenAuthorizationAnswersBeforeTheGuard()
            throws Exception {
        // given
        String boundary = "courtsideboundary";
        String body = filePart(boundary) + filePart(boundary) + "--" + boundary + "--\r\n";

        // when
        HttpResponse<String> answer = httpClient.send(HttpRequest.newBuilder(
                        URI.create(baseUrl() + "/api/admin/config/logo"))
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .PUT(HttpRequest.BodyPublishers.ofString(body))
                .build(), HttpResponse.BodyHandlers.ofString());

        // then
        assertThat(answer.statusCode()).isIn(401, 403);
        assertThat(answer.body()).doesNotContain("urn:courtside:error:ambiguous-parameter");
    }

    private static String filePart(String boundary) {
        return "--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\";"
                + " filename=\"logo.png\"\r\nContent-Type: image/png\r\n\r\nPNG\r\n";
    }

    @Test
    void givenALineBreakInAStoredIdentifier_whenItWouldBecomeALocation_thenTheContractRefusesIt()
            throws Exception {
        // given
        signIn();

        // when
        HttpResponse<String> answer = httpClient.send(HttpRequest.newBuilder(
                        URI.create(baseUrl() + "/api/admin/import/sources/" + UUID.randomUUID()
                                + "/references"))
                .header("Content-Type", "application/json")
                .header("X-XSRF-TOKEN", csrfToken())
                .POST(HttpRequest.BodyPublishers.ofString(
                        "{\"externalId\":\"A1\\r\\nX-Injected: yes\",\"personId\":\""
                                + UUID.randomUUID() + "\"}"))
                .build(), HttpResponse.BodyHandlers.ofString());

        // then
        assertThat(answer.statusCode()).isEqualTo(400);
        assertThat(answer.body()).contains("urn:courtside:error:validation-failed");
        assertThat(answer.headers().map()).doesNotContainKey(INJECTED.toLowerCase());
    }

    // The contract refuses the value above, and the escape the controller applies is the reason a
    // stored identifier could not open a header even if it ever did carry a line break.
    @Test
    void whenAStoredIdentifierIsPlacedInAPathSegment_thenALineBreakCannotLeaveIt() {
        // when
        String encoded =
                UriUtils.encodePathSegment("A1\r\nX-Injected: yes", StandardCharsets.UTF_8);

        // then
        assertThat(encoded).doesNotContain("\r").doesNotContain("\n").doesNotContain(" ");
    }

    @Test
    void whenAnExportIsOffered_thenItsDispositionNamesOnlyTheDatesTheRequestStated()
            throws Exception {
        // given
        signIn();

        // when
        HttpResponse<String> answer = httpClient.send(HttpRequest.newBuilder(URI.create(baseUrl()
                        + "/api/admin/export/bookings?from=2026-05-12&to=2026-05-13"))
                .header("X-XSRF-TOKEN", csrfToken())
                .POST(HttpRequest.BodyPublishers.noBody())
                .build(), HttpResponse.BodyHandlers.ofString());

        // then
        assertThat(answer.statusCode()).isEqualTo(200);
        assertThat(answer.headers().firstValue("Content-Disposition")).hasValueSatisfying(
                disposition -> assertThat(disposition).matches(DISPOSITION));
    }

    private static Set<String> writtenHeaders() throws IOException {
        try (Stream<Path> files = Files.walk(Path.of("src/main/java"))) {
            return files.filter(path -> path.toString().endsWith(".java"))
                    .filter(path -> !path.toString().contains("org/courtside/api/"))
                    .filter(path -> !path.toString().endsWith(OUTBOUND))
                    .flatMap(ResponseHeaderSurfaceTest::headersWrittenIn)
                    .collect(Collectors.toCollection(TreeSet::new));
        }
    }

    private static Stream<String> headersWrittenIn(Path file) {
        String source = read(file);
        String name = Path.of("src/main/java").relativize(file).toString();
        Stream<String> servlet = SERVLET_WRITE.matcher(source).results()
                .map(match -> name + " " + match.group(1));
        Stream<String> builder = BUILDER_WRITE.matcher(source).results()
                .map(match -> name + " " + (match.group(1) == null ? match.group(2) : match.group(1)));
        Stream<String> created = CREATED.matcher(source).results()
                .map(match -> name + " Location");
        return Stream.of(servlet, builder, created).flatMap(found -> found).distinct();
    }

    private static String read(Path file) {
        try {
            return Files.readString(file);
        } catch (IOException unreadable) {
            throw new java.io.UncheckedIOException(unreadable);
        }
    }

    private String raw(String request) throws IOException {
        try (Socket socket = new Socket("127.0.0.1", port)) {
            socket.setSoTimeout(3000);
            OutputStream out = socket.getOutputStream();
            out.write(request.getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
            StringBuilder answer = new StringBuilder();
            byte[] buffer = new byte[4096];
            InputStream in = socket.getInputStream();
            try {
                for (int count = in.read(buffer); count >= 0; count = in.read(buffer)) {
                    answer.append(new String(buffer, 0, count, StandardCharsets.ISO_8859_1));
                }
            } catch (SocketTimeoutException stillOpen) {
                // The connector keeps the connection open, and it has already said everything.
            }
            return answer.toString();
        }
    }

    private static int responses(String answer) {
        Matcher statusLines = Pattern.compile("(?m)^HTTP/1\\.[01] ").matcher(answer);
        int found = 0;
        while (statusLines.find()) {
            found++;
        }
        return found;
    }

    private static Set<String> headerNames(String answer) {
        return answer.lines().takeWhile(line -> !line.isBlank())
                .filter(line -> line.contains(":"))
                .map(line -> line.substring(0, line.indexOf(':')).toLowerCase())
                .collect(Collectors.toCollection(TreeSet::new));
    }

    private void signIn() throws Exception {
        httpClient.send(HttpRequest.newBuilder(URI.create(baseUrl() + "/api/session")).GET().build(),
                HttpResponse.BodyHandlers.discarding());
        HttpResponse<String> answer = httpClient.send(HttpRequest.newBuilder(
                        URI.create(baseUrl() + "/api/session"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("X-XSRF-TOKEN", csrfToken())
                .POST(HttpRequest.BodyPublishers.ofString(
                        "username=" + USERNAME + "&password=" + PASSWORD))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(answer.statusCode()).as(answer.body()).isEqualTo(200);
    }

    private String csrfToken() {
        return ((CookieManager) httpClient.cookieHandler().orElseThrow()).getCookieStore()
                .getCookies().stream()
                .filter(cookie -> cookie.getName().equals("XSRF-TOKEN"))
                .map(HttpCookie::getValue)
                .findFirst()
                .orElse("");
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + port;
    }
}
