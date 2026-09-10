package org.courtside;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.dataexchange.CanonicalField;
import org.courtside.dataexchange.PreviewService;
import org.courtside.dataexchange.ImportSourceService;
import org.courtside.dataexchange.SnapshotMode;
import org.courtside.dataexchange.SnapshotUpload;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.yaml.snakeyaml.Yaml;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpCookie;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.stream.StreamSupport;

import static java.util.Map.entry;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import({IdentityTestFixture.class, FacilityTestFixture.class, BookingTestFixture.class})
class SafeMethodStateInvarianceTest extends AbstractIntegrationTest {

    private static final String DOCUMENT = "/api/openapi.yaml";

    private static final Set<String> SAFE_METHODS = Set.of("get", "head", "options");

    private static final Pattern TEMPLATED_SEGMENT = Pattern.compile("\\{([^}]+)}");

    private static final String USERNAME = "richard.miles";

    private static final String PASSWORD = "correct-horse-battery-staple";

    private static final String TODAY = "2026-05-12";

    // Columns and not the session table, so a safe method that revoked a session still fails.
    private static final Map<String, String> EXEMPT_COLUMNS = Map.of(
            "spring_session.last_access_time", "the container stamps it on every request, safe or not",
            "spring_session.expiry_time", "it is the last access above plus the inactive interval");

    private record Probe(String identifier, String query, int expectedStatus) {
    }

    private static Probe read() {
        return new Probe("", "", 200);
    }

    private static Probe read(String query) {
        return new Probe("", query, 200);
    }

    private static Probe read(String identifier, String query) {
        return new Probe(identifier, query, 200);
    }

    private static final Map<String, Probe> PROBES = Map.ofEntries(
            entry("/api/source", read()),
            entry("/api/openapi.yaml", read()),
            entry("/manifest.webmanifest", read()),
            entry("/api/session", read()),
            entry("/api/account/sessions", read()),
            entry("/api/account/messages", read()),
            entry("/api/public/courts", read()),
            entry("/api/public/opening-hours", read()),
            entry("/api/public/booking-grid", read()),
            entry("/api/public/config", read()),
            entry("/api/public/config/logo", read()),
            entry("/api/public/booking-cards", read()),
            entry("/api/public/participant-cards", read()),
            entry("/api/public/participant-members", read("query=Doe")),
            entry("/api/bookings", read("date=" + TODAY)),
            entry("/api/bookings/eligibility", read()),
            entry("/api/my/bookings", read()),
            entry("/api/my/participations", read()),
            entry("/api/managed/bookings", read()),
            entry("/api/managed/bookings/{id}", read("bookingId", "")),
            entry("/api/admin/courts", read()),
            entry("/api/admin/courts/{id}", read("courtId", "")),
            entry("/api/admin/booking-cards", read()),
            entry("/api/admin/booking-cards/{id}", read("bookingCardId", "")),
            entry("/api/admin/participant-cards", read()),
            entry("/api/admin/participant-cards/{id}", read("participantCardId", "")),
            entry("/api/admin/membership-types", read()),
            entry("/api/admin/membership-types/{id}", read("membershipTypeId", "")),
            entry("/api/admin/roster", read()),
            entry("/api/admin/roster/{personId}", read("personId", "")),
            entry("/api/admin/import/encodings", read()),
            entry("/api/admin/import/sources", read()),
            entry("/api/admin/import/sources/{id}", read("importSourceId", "")),
            entry("/api/admin/import/sources/{sourceId}/references", read("importSourceId", "")),
            entry("/api/admin/import/sources/{sourceId}/runs", read("importSourceId", "")),
            entry("/api/admin/import/previews/{id}", read("importPreviewId", "")),
            entry("/api/admin/rule-sets", read()),
            entry("/api/admin/rule-types", read()),
            entry("/api/admin/rule-sets/{id}", read("ruleSetId", "")),
            entry("/api/admin/rule-sets/{id}/rules", read("ruleSetId", "")),
            entry("/api/admin/opening-hours", read()),
            entry("/api/admin/config", read()),
            entry("/api/admin/impact/courts/{courtId}", read("courtId", "")),
            entry("/api/admin/impact/booking-cards/{cardId}", read("bookingCardId", "")),
            entry("/api/admin/impact/opening-hours/{day}", read("weekday", "")),
            entry("/api/admin/reports/facility-utilisation", read("from=2026-05-01&to=2026-05-31")),
            entry("/api/admin/messages", read()),
            entry("/api/admin/audit", read()));

    @LocalServerPort
    private int port;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private ImportSourceService importSources;

    @Autowired
    private PreviewService previews;

    private final ObjectMapper json = new ObjectMapper();

    private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);

    private final HttpClient httpClient = HttpClient.newBuilder().cookieHandler(cookies).build();

    private final Map<String, String> identifiers = new HashMap<>();

    @BeforeEach
    void prepareTheClubAndSignIn() throws Exception {
        UUID personId = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        UUID accountId = identity.createEnabledAccount(
                personId, USERNAME, passwordEncoder.encode(PASSWORD), Set.of(Role.values()));
        signIn();

        UUID courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        String bookingCardId = firstIdOf("/api/admin/booking-cards",
                card -> card.get("guestAllowed").asBoolean());
        UUID bookingId = bookings.createBookingWithGuest(courtId, UUID.fromString(bookingCardId),
                new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z")),
                personId, Set.of(Role.values()), "John Roe");
        uploadClubLogo();

        String membershipTypeId = firstIdOf("/api/admin/membership-types");
        UUID sourceId = importSources.create("roster-system", "Membership system", ",", "UTF-8",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME,
                        "Email", CanonicalField.EMAIL),
                Map.of(), UUID.fromString(membershipTypeId),
                Set.of(CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME), 10).sourceId();
        UUID previewId = previews.create(sourceId, SnapshotMode.FULL_SNAPSHOT, "UTF-8",
                new SnapshotUpload("roster.csv", "text/csv", """
                        Member number,First name,Last name,Email
                        4711,Mary,Major,mary.major@example.org
                        """.getBytes(StandardCharsets.UTF_8)), accountId).previewId();

        identifiers.put("courtId", courtId.toString());
        identifiers.put("personId", personId.toString());
        identifiers.put("bookingId", bookingId.toString());
        identifiers.put("bookingCardId", bookingCardId);
        identifiers.put("participantCardId", firstIdOf("/api/admin/participant-cards"));
        identifiers.put("membershipTypeId", membershipTypeId);
        identifiers.put("ruleSetId", firstIdOf("/api/admin/rule-sets"));
        identifiers.put("importSourceId", sourceId.toString());
        identifiers.put("importPreviewId", previewId.toString());
        identifiers.put("weekday", DayOfWeek.MONDAY.name());
    }

    @Test
    void everySafeMethodOperationInTheContractHasAStateInvarianceProbe() {
        // when
        TreeSet<String> documented = documentedSafeOperations();

        // then
        assertThat(new TreeSet<>(PROBES.keySet()))
                .as("a safe-method operation without a probe is an unproven read: nothing would"
                        + " notice if it started writing. Add it to PROBES, with a request that"
                        + " answers successfully.")
                .isEqualTo(documented);
    }

    @Test
    void everyExemptColumnExists() {
        // when
        Set<String> columns = columnsOfEveryTable().entrySet().stream()
                .flatMap(table -> table.getValue().stream().map(column -> table.getKey() + "." + column))
                .collect(TreeSet::new, TreeSet::add, TreeSet::addAll);

        // then
        assertThat(columns)
                .as("an exempt column that no longer exists is an exemption nobody reads any more,"
                        + " and it would silently cover whatever replaced it.")
                .containsAll(EXEMPT_COLUMNS.keySet());
    }

    @Test
    void whenEverySafeMethodOperationIsInvoked_thenNoPersistentStateChanges() throws Exception {
        // given
        List<String> failures = new ArrayList<>();
        Set<String> exemptColumnsThatMoved = new TreeSet<>();

        // when
        for (Map.Entry<String, Probe> probe : new TreeSet<>(PROBES.keySet()).stream()
                .map(path -> entry(path, PROBES.get(path))).toList()) {
            String uri = requestUri(probe.getKey(), probe.getValue());
            Map<String, String> before = stateFingerprint();
            HttpResponse<byte[]> read = send("GET", uri);
            if (read.statusCode() != probe.getValue().expectedStatus()) {
                failures.add("GET " + uri + " answered " + read.statusCode() + " instead of "
                        + probe.getValue().expectedStatus() + ": "
                        + new String(read.body(), StandardCharsets.UTF_8));
                continue;
            }
            HttpResponse<byte[]> head = send("HEAD", uri);
            if (head.statusCode() != read.statusCode()) {
                failures.add("HEAD " + uri + " answered " + head.statusCode()
                        + " where GET answered " + read.statusCode());
            }
            HttpResponse<byte[]> options = send("OPTIONS", uri);
            if (options.statusCode() != 200) {
                failures.add("OPTIONS " + uri + " answered " + options.statusCode());
            }
            Map<String, String> after = stateFingerprint();
            failures.addAll(changedTables(probe.getKey(), before, after));
            exemptColumnsThatMoved.addAll(movedAmong(EXEMPT_COLUMNS.keySet(), before, after));
        }

        // then
        assertThat(exemptColumnsThatMoved)
                .as("an exemption is earned by a column that actually moves under a safe method."
                        + " One that never moves is a blanket nobody checked, and it would cover a"
                        + " write that appears there later.")
                .isEqualTo(new TreeSet<>(EXEMPT_COLUMNS.keySet()));
        assertThat(failures)
                .as("a safe method must leave persistent state exactly as it found it. Every entry"
                        + " below names an operation that wrote, or a probe that never reached its"
                        + " handler and therefore proved nothing.")
                .isEmpty();
    }

    private List<String> changedTables(String path, Map<String, String> before, Map<String, String> after) {
        return before.keySet().stream()
                .filter(table -> !EXEMPT_COLUMNS.containsKey(table))
                .filter(table -> !before.get(table).equals(after.get(table)))
                .map(table -> "GET " + path + " changed table " + table)
                .toList();
    }

    private Set<String> movedAmong(Set<String> keys, Map<String, String> before, Map<String, String> after) {
        return keys.stream()
                .filter(key -> !before.get(key).equals(after.get(key)))
                .collect(TreeSet::new, TreeSet::add, TreeSet::addAll);
    }

    private Map<String, String> stateFingerprint() {
        String query = digestSelects().reduce((left, right) -> left + " UNION ALL " + right).orElseThrow();
        Map<String, String> fingerprint = new LinkedHashMap<>();
        jdbc.sql(query)
                .query((result, row) -> entry(result.getString("state_of"), result.getString("state")))
                .list()
                .forEach(row -> fingerprint.put(row.getKey(), row.getValue()));
        return fingerprint;
    }

    private Stream<String> digestSelects() {
        Map<String, List<String>> columns = columnsOfEveryTable();
        Stream<String> tables = columns.entrySet().stream().map(table -> {
            List<String> observed = table.getValue().stream()
                    .filter(column -> !EXEMPT_COLUMNS.containsKey(table.getKey() + "." + column))
                    .toList();
            assertThat(observed)
                    .as("every column of %s is exempt, which fingerprints nothing at all", table.getKey())
                    .isNotEmpty();
            return digestOf(table.getKey(), "ROW(" + quoted(observed) + ")", table.getKey());
        });
        Stream<String> exempt = EXEMPT_COLUMNS.keySet().stream()
                .map(key -> digestOf(key.substring(0, key.indexOf('.')),
                        "\"" + key.substring(key.indexOf('.') + 1) + "\"", key));
        return Stream.concat(tables, exempt);
    }

    private String digestOf(String table, String expression, String name) {
        return "SELECT '" + name + "' AS state_of,"
                + " coalesce(md5(string_agg(digest, ',' ORDER BY digest)), '') AS state"
                + " FROM (SELECT md5(" + expression + "::text) AS digest FROM public.\"" + table
                + "\") AS digests";
    }

    private String quoted(List<String> columns) {
        return columns.stream().map(column -> "\"" + column + "\"")
                .reduce((left, right) -> left + ", " + right).orElseThrow();
    }

    private Map<String, List<String>> columnsOfEveryTable() {
        Map<String, List<String>> columns = new LinkedHashMap<>();
        publicTables(jdbc).forEach(table -> columns.put(table, jdbc.sql("""
                        SELECT column_name
                        FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = :table
                        ORDER BY column_name
                        """).param("table", table).query(String.class).list()));
        return columns;
    }

    private String requestUri(String path, Probe probe) {
        Matcher templated = TEMPLATED_SEGMENT.matcher(path);
        String resolved = path;
        if (templated.find()) {
            assertThat(identifiers)
                    .as("%s is templated, so its probe has to name the identifier that fills it", path)
                    .containsKey(probe.identifier());
            resolved = templated.replaceAll(Matcher.quoteReplacement(identifiers.get(probe.identifier())));
        } else {
            assertThat(probe.identifier())
                    .as("%s carries no path parameter, so naming an identifier for it is a stale"
                            + " probe row", path)
                    .isEmpty();
        }
        return resolved + (probe.query().isEmpty() ? "" : "?" + probe.query());
    }

    private HttpResponse<byte[]> send(String method, String uri) throws Exception {
        return httpClient.send(HttpRequest.newBuilder(URI.create(baseUrl() + uri))
                .method(method, HttpRequest.BodyPublishers.noBody())
                .build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private String firstIdOf(String path) throws Exception {
        return firstIdOf(path, row -> true);
    }

    private String firstIdOf(String path, Predicate<JsonNode> usable) throws Exception {
        HttpResponse<byte[]> response = send("GET", path);
        assertThat(response.statusCode()).as(path).isEqualTo(200);
        JsonNode body = json.readTree(response.body());
        assertThat(body.isArray()).as("%s answered no list to probe with", path).isTrue();
        return StreamSupport.stream(body.spliterator(), false)
                .filter(usable)
                .findFirst()
                .map(row -> row.get("id").asText())
                .orElseThrow(() -> new IllegalStateException(path + " answered no usable row to probe with"));
    }

    private void uploadClubLogo() throws Exception {
        String boundary = "courtside-" + UUID.randomUUID();
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        body.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\";"
                + " filename=\"logo.png\"\r\nContent-Type: image/png\r\n\r\n")
                .getBytes(StandardCharsets.UTF_8));
        body.write(pngBytes());
        body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        HttpResponse<String> response = httpClient.send(
                HttpRequest.newBuilder(URI.create(baseUrl() + "/api/admin/config/logo"))
                        .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                        .header("X-XSRF-TOKEN", csrfToken())
                        .PUT(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
                        .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    }

    private byte[] pngBytes() throws IOException {
        BufferedImage image = new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(image, "png", png);
        return png.toByteArray();
    }

    private void signIn() throws Exception {
        URI session = URI.create(baseUrl() + "/api/session");
        httpClient.send(HttpRequest.newBuilder(session).GET().build(), HttpResponse.BodyHandlers.discarding());
        String form = "username=" + USERNAME + "&password=" + PASSWORD;
        HttpResponse<String> response = httpClient.send(HttpRequest.newBuilder(session)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("X-XSRF-TOKEN", csrfToken())
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    }

    private String csrfToken() {
        return cookies.getCookieStore().getCookies().stream()
                .filter(cookie -> cookie.getName().equals("XSRF-TOKEN"))
                .map(HttpCookie::getValue)
                .map(value -> URLDecoder.decode(value, StandardCharsets.UTF_8))
                .reduce((first, second) -> second)
                .orElseThrow();
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + port;
    }

    @SuppressWarnings("unchecked")
    private static TreeSet<String> documentedSafeOperations() {
        try (InputStream document = SafeMethodStateInvarianceTest.class.getResourceAsStream(DOCUMENT)) {
            Map<String, Object> tree = new Yaml().load(document);
            Map<String, Object> paths = (Map<String, Object>) tree.get("paths");
            return paths.entrySet().stream()
                    .filter(path -> ((Map<String, Object>) path.getValue()).keySet().stream()
                            .anyMatch(SAFE_METHODS::contains))
                    .map(Map.Entry::getKey)
                    .collect(TreeSet::new, TreeSet::add, TreeSet::addAll);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
