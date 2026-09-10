package org.courtside;

import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.dataexchange.CanonicalField;
import org.courtside.dataexchange.ExecutionService;
import org.courtside.dataexchange.PreviewService;
import org.courtside.dataexchange.ImportSourceService;
import org.courtside.dataexchange.SnapshotMode;
import org.courtside.dataexchange.SnapshotUpload;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.actuate.endpoint.EndpointId;
import org.springframework.boot.actuate.endpoint.web.PathMappedEndpoints;
import org.springframework.boot.health.actuate.endpoint.HealthEndpointGroups;
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
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static java.util.Map.entry;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import({IdentityTestFixture.class, FacilityTestFixture.class, BookingTestFixture.class,
        MemberTestFixture.class})
class SafeMethodStateInvarianceTest extends AbstractIntegrationTest {

    private static final String DOCUMENT = "/api/openapi.yaml";

    private static final Set<String> SAFE_METHODS = Set.of("get", "head", "options");

    private static final Pattern TEMPLATED_SEGMENT = Pattern.compile("\\{([^}]+)}");

    private static final String USERNAME = "richard.miles";

    private static final String PASSWORD = "correct-horse-battery-staple";

    private static final String TODAY = "2026-05-12";

    private static final Instant BOOKED_FROM = Instant.parse("2026-05-12T16:00:00Z");

    private static final Instant BOOKED_UNTIL = Instant.parse("2026-05-12T17:00:00Z");

    private static final String ANOTHER_USERNAME = "john.roe";

    private static final String SESSION_TABLE = "spring_session";

    private static final String ANOTHER_PRINCIPAL = "spring_session of another principal";

    // Columns and not the session table, so a safe method that revoked a session still fails.
    private static final Map<String, String> EXEMPT_COLUMNS = Map.of(
            SESSION_TABLE + ".last_access_time", "the container stamps it on every request, safe or not",
            SESSION_TABLE + ".expiry_time", "it is the last access above plus the inactive interval");

    private static final int ANSWERED = 200;

    private record Probe(String identifier, String query) {
    }

    private static Probe read() {
        return new Probe("", "");
    }

    private static Probe read(String query) {
        return new Probe("", query);
    }

    private static Probe read(String identifier, String query) {
        return new Probe(identifier, query);
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
            entry("/api/public/participant-members", read("query=Miles")),
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
            entry("/api/admin/audit", read()),
            entry("/actuator/health", read()),
            entry("/actuator/health/liveness", read()),
            entry("/actuator/health/readiness", read()),
            entry("/actuator/health/mail", read()));

    @LocalServerPort
    private int port;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PathMappedEndpoints actuator;

    @Autowired
    private HealthEndpointGroups healthGroups;

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

    @Autowired
    private ExecutionService executions;

    @Autowired
    private MemberTestFixture members;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();

    private final Map<String, String> identifiers = new HashMap<>();

    private void prepareTheClubAndSignIn() throws Exception {
        UUID personId = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        UUID accountId = identity.createEnabledAccount(
                personId, USERNAME, passwordEncoder.encode(PASSWORD), Set.of(Role.values()));
        holdASessionForAnotherAccount();
        askForCredentialsSoTheMessageLogHasAnEntry();
        signIn();

        UUID courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        String bookingCardId = seededId("SELECT id FROM booking_card WHERE guest_allowed ORDER BY label");
        UUID bookingId = bookings.createBookingWithGuest(courtId, UUID.fromString(bookingCardId),
                new TimeSlot(BOOKED_FROM, BOOKED_UNTIL), accountId, personId, Set.of(Role.values()),
                null, "John Roe");
        uploadClubLogo();

        String membershipTypeId = seededId("SELECT id FROM membership_type ORDER BY name");
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
                        4711,Jane,Doe,jane.doe@example.org
                        """.getBytes(StandardCharsets.UTF_8)), accountId).previewId();
        executions.execute(previewId, false, accountId);
        UUID reviewedPreviewId = previews.create(sourceId, SnapshotMode.FULL_SNAPSHOT, "UTF-8",
                new SnapshotUpload("roster.csv", "text/csv", """
                        Member number,First name,Last name,Email
                        4711,Jane,Doe,jane.doe@example.org
                        4712,John,Roe,john.roe@example.org
                        """.getBytes(StandardCharsets.UTF_8)), accountId).previewId();

        identifiers.put("courtId", courtId.toString());
        identifiers.put("personId", personId.toString());
        identifiers.put("bookingId", bookingId.toString());
        identifiers.put("bookingCardId", bookingCardId);
        identifiers.put("participantCardId", seededId("SELECT id FROM participant_card ORDER BY label"));
        identifiers.put("membershipTypeId", membershipTypeId);
        identifiers.put("ruleSetId", seededId("SELECT id FROM rule_set ORDER BY name"));
        identifiers.put("importSourceId", sourceId.toString());
        identifiers.put("importPreviewId", reviewedPreviewId.toString());
        identifiers.put("weekday", BOOKED_FROM.atZone(ZoneOffset.UTC).getDayOfWeek().name());
    }

    private int sessionsOfAnotherPrincipal() {
        return jdbc.sql("SELECT count(*) FROM public.spring_session"
                        + " WHERE principal_name IS DISTINCT FROM :caller")
                .param("caller", USERNAME).query(Integer.class).single();
    }

    private String seededId(String query) {
        return jdbc.sql(query + " LIMIT 1").query(String.class).single();
    }

    // The caller's own session row moves on every request; another account's must not, and without
    // a second one the exemption could not tell the two apart.
    private void holdASessionForAnotherAccount() throws Exception {
        UUID canaryPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        identity.createEnabledAccount(canaryPersonId, ANOTHER_USERNAME,
                passwordEncoder.encode(PASSWORD), Set.of(Role.MEMBER));
        signIn(HttpClient.newBuilder().cookieHandler(
                new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build(), ANOTHER_USERNAME);
    }

    private void askForCredentialsSoTheMessageLogHasAnEntry() {
        UUID recipient = identity.createPerson("Mary", "Major", "mary.major@example.org");
        identity.createEnabledAccount(recipient, "mary.major", Set.of(Role.MEMBER));
        members.requestAccountCredentials(recipient);
    }

    @Test
    void whenTheContractIsRead_thenEverySafeMethodOperationHasAStateInvarianceProbe() {
        // when
        TreeSet<String> shipped = documentedSafeOperations();
        shipped.addAll(exposedActuatorPaths());

        // then
        assertThat(new TreeSet<>(PROBES.keySet()))
                .as("a safe-method operation without a probe is an unproven read: nothing would"
                        + " notice if it started writing. Add it to PROBES, with a request that"
                        + " answers successfully.")
                .isEqualTo(shipped);
    }

    @Test
    void whenTheSchemaIsRead_thenEveryExemptColumnStillExists() {
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
        prepareTheClubAndSignIn();
        assertThat(sessionsOfAnotherPrincipal())
                .as("without a second signed-in account the exempt columns cannot tell the caller's"
                        + " own session row from somebody else's, and the digest below reads nothing")
                .isEqualTo(1);
        List<String> failures = new ArrayList<>();
        Set<String> exemptColumnsThatMoved = new TreeSet<>();

        // when
        for (Map.Entry<String, Probe> probe : new TreeSet<>(PROBES.keySet()).stream()
                .map(path -> entry(path, PROBES.get(path))).toList()) {
            String uri = requestUri(probe.getKey(), probe.getValue());
            Map<String, String> before = stateFingerprint();
            HttpResponse<byte[]> read = send("GET", uri);
            if (read.statusCode() != ANSWERED) {
                failures.add("GET " + uri + " answered " + read.statusCode() + " instead of "
                        + ANSWERED + ": " + new String(read.body(), StandardCharsets.UTF_8));
                continue;
            }
            HttpResponse<byte[]> head = send("HEAD", uri);
            if (head.statusCode() != read.statusCode()) {
                failures.add("HEAD " + uri + " answered " + head.statusCode()
                        + " where GET answered " + read.statusCode());
            }
            HttpResponse<byte[]> options = send("OPTIONS", uri);
            if (options.statusCode() != ANSWERED) {
                failures.add("OPTIONS " + uri + " answered " + options.statusCode());
            }
            Map<String, String> after = stateFingerprint();
            failures.addAll(changedState(probe.getKey(), before, after));
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

    private List<String> changedState(String path, Map<String, String> before, Map<String, String> after) {
        return before.keySet().stream()
                .filter(state -> !EXEMPT_COLUMNS.containsKey(state))
                .filter(state -> !before.get(state).equals(after.get(state)))
                .map(state -> "a safe method on " + path + " changed " + state)
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
            return digestOf(table.getKey(), "ROW(" + quoted(observed) + ")", table.getKey(), "");
        });
        Stream<String> exempt = EXEMPT_COLUMNS.keySet().stream()
                .map(key -> digestOf(key.substring(0, key.indexOf('.')),
                        identifier(key.substring(key.indexOf('.') + 1)), key, ""));
        Stream<String> otherSessions = Stream.of(digestOf(SESSION_TABLE,
                "ROW(" + quoted(columns.get(SESSION_TABLE)) + ")", ANOTHER_PRINCIPAL,
                "principal_name IS DISTINCT FROM " + literal(USERNAME)));
        return Stream.concat(Stream.concat(tables, exempt), otherSessions);
    }

    private String digestOf(String table, String expression, String name, String where) {
        return "SELECT " + literal(name) + " AS state_of,"
                + " coalesce(md5(string_agg(digest, ',' ORDER BY digest)), '') AS state"
                + " FROM (SELECT md5(" + expression + "::text) AS digest FROM public."
                + identifier(table) + (where.isEmpty() ? "" : " WHERE " + where) + ") AS digests";
    }

    private String identifier(String name) {
        return "\"" + name.replace("\"", "\"\"") + "\"";
    }

    private String literal(String value) {
        return "'" + value.replace("'", "''") + "'";
    }

    private String quoted(List<String> columns) {
        return columns.stream().map(this::identifier)
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
        signIn(httpClient, USERNAME);
    }

    private void signIn(HttpClient client, String username) throws Exception {
        URI session = URI.create(baseUrl() + "/api/session");
        client.send(HttpRequest.newBuilder(session).GET().build(), HttpResponse.BodyHandlers.discarding());
        String form = "username=" + username + "&password=" + PASSWORD;
        HttpResponse<String> response = client.send(HttpRequest.newBuilder(session)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("X-XSRF-TOKEN", csrfToken(client))
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    }

    private String csrfToken() {
        return csrfToken(httpClient);
    }

    private String csrfToken(HttpClient client) {
        return ((CookieManager) client.cookieHandler().orElseThrow()).getCookieStore().getCookies().stream()
                .filter(cookie -> cookie.getName().equals("XSRF-TOKEN"))
                .map(HttpCookie::getValue)
                .map(value -> URLDecoder.decode(value, StandardCharsets.UTF_8))
                .reduce((first, second) -> second)
                .orElseThrow();
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + port;
    }

    // The document describes /api and the manifest; what a club also serves is whatever the
    // management exposure lets out, which is configuration rather than contract.
    private Set<String> exposedActuatorPaths() {
        Set<String> paths = new TreeSet<>(actuator.getAllPaths());
        String health = actuator.getPath(EndpointId.of("health"));
        if (health != null) {
            healthGroups.getNames().forEach(group -> paths.add(health + "/" + group));
        }
        return paths;
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
