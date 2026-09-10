package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.actuate.endpoint.web.PathMappedEndpoints;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.web.servlet.handler.SimpleUrlHandlerMapping;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PublishedWebSurfaceTest extends AbstractIntegrationTest {

    private static final Path INVENTORY_FILE = Path.of("security/published-web-resources.json");

    private static final Path RULES =
            Path.of("src/main/java/org/courtside/identity/internal/SecurityConfiguration.java");

    private static final Path PROXY = Path.of("deploy/Caddyfile");

    private static final String PERMITTED = ".permitAll()";

    private static final String UNAUTHENTICATED = "urn:courtside:error:unauthenticated";

    private static final String PROBLEM = "application/problem+json";

    private static final String UNMAPPED = "urn:courtside:error:unmapped-path";

    private static final String ERROR_DISPATCH = "/error";

    private static final String WELL_KNOWN = "/.well-known";

    private static final String API = "/api";

    private static final String MANAGEMENT = "/actuator";

    private static final String PROBE = "published-web-surface-probe";

    private static final Pattern LITERAL = Pattern.compile("\"(/[^\"]*)\"");

    private static final Pattern NAVIGATION = Pattern.compile("\\n\\s*path ([^\\n]+)\\n");

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final JsonNode INVENTORY = MAPPER.readTree(read(INVENTORY_FILE));

    private final HttpClient anonymous = HttpClient.newHttpClient();

    @LocalServerPort
    private int port;

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    private RequestMappingHandlerMapping controllerMappings;

    @Autowired
    private List<SimpleUrlHandlerMapping> urlMappings;

    @Autowired
    private PathMappedEndpoints actuatorEndpoints;

    @Test
    void whenTheShellRoutesAreRead_thenTheViewControllersTheSecurityRulesAndTheProxyAgree() {
        // given
        Set<String> permitted = permittedPaths();
        Set<String> staticPaths = inventoryStrings("anonymousStaticPaths");

        // when
        Set<String> browserSurface = union(union(shellRoutes(), staticPaths), servedPaths(false));
        List<String> proxied = List.of(proxiedPaths());

        // then
        assertThat(permitted).describedAs(
                "the rules permit the shell routes, the built resources and the generated metadata, "
                        + "and nothing besides")
                .isEqualTo(browserSurface);
        assertThat(browserSurface).allSatisfy(path -> assertThat(proxied)
                .describedAs("the proxy redirects %s to HTTPS rather than refusing it as plain HTTP", path)
                .anySatisfy(pattern -> assertThat(matches(pattern, path)).isTrue()));
        assertThat(proxied).allSatisfy(pattern -> assertThat(browserSurface)
                .describedAs("the proxy redirect pattern %s still names something this application serves",
                        pattern)
                .anySatisfy(path -> assertThat(matches(pattern, path)).isTrue()));
    }

    @Test
    void givenEveryPathTheRulesExpose_whenItIsRequestedWithoutASession_thenOnlyTheInventoriedOnesAnswer() {
        // given
        Set<String> reachable = Stream.concat(
                        inventoryStrings("anonymousStaticPaths").stream().map(PublishedWebSurfaceTest::concrete),
                        servedResources().stream().map(resource -> resource.get("path").asString()))
                .collect(Collectors.toCollection(TreeSet::new));

        // when / then
        assertThat(reachable).allSatisfy(path -> {
            HttpResponse<String> response = fetch(path);
            assertThat(response.statusCode())
                    .describedAs("%s is published, so it is answered rather than demanded a session for", path)
                    .isIn(200, 404);
            if (response.statusCode() == 404) {
                assertThat(problemType(path))
                        .describedAs("%s is published, and an absent build only leaves it unmapped", path)
                        .isEqualTo(UNMAPPED);
            }
        });
        assertThat(inventoryStrings("absentMetadata")).allSatisfy(name -> assertThat(problemType("/" + name))
                .describedAs("%s is a metadata resource this product does not publish", name)
                .isEqualTo(UNAUTHENTICATED));
        assertThat(problemType("/" + PROBE))
                .describedAs("an address nobody reviewed stays behind a session")
                .isEqualTo(UNAUTHENTICATED);
    }

    @Test
    void givenEveryServedMetadataResource_whenItIsRead_thenItsContentStaysInsideTheReviewedContract() {
        // given
        List<Pattern> disclosing = disclosingPatterns();

        // when / then
        assertThat(servedResources()).allSatisfy(resource -> {
            String path = resource.get("path").asString();
            HttpResponse<String> response = fetch(path);
            assertThat(response.statusCode()).describedAs("%s answers anonymously", path).isEqualTo(200);
            assertThat(response.headers().firstValue("content-type").orElse(""))
                    .startsWith(resource.get("mediaType").asString());
            JsonNode body = MAPPER.readTree(response.body());
            assertThat(new TreeSet<>(body.propertyNames()))
                    .describedAs("%s discloses the reviewed properties and no others", path)
                    .isEqualTo(new TreeSet<>(strings(resource.get("keys"))));
            assertThat(strings(resource.get("configuredKeys")))
                    .describedAs("%s leaves a club-configured property unchecked, so it names fewer "
                            + "than all of them", path)
                    .isSubsetOf(strings(resource.get("keys")))
                    .hasSizeLessThan(resource.get("keys").size());
            resource.get("reviewedValues").properties().forEach(reviewed ->
                    assertThat(values(body.path(reviewed.getKey())))
                            .describedAs("%s carries reviewed values for %s", path, reviewed.getKey())
                            .isSubsetOf(strings(reviewed.getValue())));
            String decided = withoutConfiguredValues(response.body(), resource);
            assertThat(disclosing)
                    .describedAs("%s discloses nothing the build policy would refuse in a shipped file, "
                            + "apart from what a club configured", path)
                    .noneMatch(pattern -> pattern.matcher(decided).find());
        });
    }

    @Test
    void givenEveryMappedAddress_whenItIsReadOutsideTheApi_thenItIsAnInventoriedPublication() {
        // given
        Set<String> published = servedPaths(false);

        // when
        Set<String> controllerPaths = controllerMappings.getHandlerMethods().keySet().stream()
                .filter(info -> info.getPathPatternsCondition() != null)
                .flatMap(info -> info.getPathPatternsCondition().getPatternValues().stream())
                .filter(path -> !path.startsWith(API))
                .collect(Collectors.toCollection(TreeSet::new));

        // then
        assertThat(controllerPaths)
                .describedAs("outside the API a controller answers only the error dispatch and inventoried metadata")
                .isEqualTo(union(Set.of(ERROR_DISPATCH), published));
        assertThat(new TreeSet<>(actuatorEndpoints.getAllPaths()))
                .describedAs("the exposed management endpoints are the inventoried ones")
                .isEqualTo(servedPaths(true));
        assertThat(INVENTORY.get("conditionalResources").values()).allSatisfy(conditional -> {
            String path = conditional.get("path").asString();
            assertThat(actuatorEndpoints.getAllPaths())
                    .describedAs("%s answers only where %s is set", path,
                            conditional.get("condition").asString())
                    .doesNotContain(path);
            assertThat(problemType(path))
                    .describedAs("%s stays behind a session while its condition is unset", path)
                    .isEqualTo(UNAUTHENTICATED);
        });
        assertThat(Stream.concat(controllerPaths.stream(), shellRoutes().stream()))
                .describedAs("nothing answers under the well-known prefix")
                .noneMatch(path -> path.startsWith(WELL_KNOWN));
    }

    private Set<String> shellRoutes() {
        return urlMappings.stream()
                .min(Comparator.comparingInt(SimpleUrlHandlerMapping::getOrder))
                .orElseThrow()
                .getUrlMap()
                .keySet()
                .stream()
                .collect(Collectors.toCollection(TreeSet::new));
    }

    private Set<String> permittedPaths() {
        String source = read(RULES);
        Set<String> permitted = new TreeSet<>();
        for (int closing = source.indexOf(PERMITTED); closing >= 0;
                closing = source.indexOf(PERMITTED, closing + PERMITTED.length())) {
            int opening = source.lastIndexOf("Matchers(", closing);
            Matcher matcher = LITERAL.matcher(source.substring(opening, closing));
            while (matcher.find()) {
                permitted.add(matcher.group(1));
            }
        }
        permitted.removeIf(path -> path.startsWith(API) || path.startsWith(MANAGEMENT));
        return permitted;
    }

    private String[] proxiedPaths() {
        String proxy = read(PROXY);
        Matcher matcher = NAVIGATION.matcher(proxy.substring(proxy.indexOf("@browserNavigation {")));
        if (!matcher.find()) {
            throw new IllegalStateException("The proxy declares no browser navigation paths");
        }
        return matcher.group(1).trim().split("\\s+");
    }

    private List<Pattern> disclosingPatterns() {
        return Stream.of("credentialPatterns", "disclosureMarkers")
                .flatMap(property -> INVENTORY.get(property).values().stream())
                .map(declared -> Pattern.compile(declared.get("pattern").asString()))
                .toList();
    }

    private static String withoutConfiguredValues(String body, JsonNode resource) {
        JsonNode remaining = MAPPER.readTree(body);
        strings(resource.get("configuredKeys")).forEach(((ObjectNode) remaining)::remove);
        return remaining.toString();
    }

    private Set<String> servedPaths(boolean management) {
        return servedResources().stream()
                .map(resource -> resource.get("path").asString())
                .filter(path -> path.startsWith(MANAGEMENT) == management)
                .collect(Collectors.toCollection(TreeSet::new));
    }

    private List<JsonNode> servedResources() {
        return INVENTORY.get("servedResources").values().stream().toList();
    }

    private Set<String> inventoryStrings(String property) {
        return new TreeSet<>(strings(INVENTORY.get(property)));
    }

    private static List<String> strings(JsonNode node) {
        return node.values().stream().map(JsonNode::asString).toList();
    }

    private static List<String> values(JsonNode node) {
        return node.isArray() ? strings(node) : List.of(node.asString());
    }

    private static Set<String> union(Set<String> first, Set<String> second) {
        return Stream.concat(first.stream(), second.stream())
                .collect(Collectors.toCollection(TreeSet::new));
    }

    private static boolean matches(String pattern, String path) {
        return concrete(path).matches(Stream.of(pattern.split("\\*", -1))
                .map(Pattern::quote).collect(Collectors.joining(".*")));
    }

    private static String concrete(String pattern) {
        return pattern.replace("**", PROBE).replace("*", PROBE).replaceAll("\\{[^}]+}", PROBE);
    }

    private String problemType(String path) {
        HttpResponse<String> response = fetch(path);
        return response.headers().firstValue("content-type").orElse("").startsWith(PROBLEM)
                ? MAPPER.readTree(response.body()).path("type").asString("")
                : "";
    }

    private HttpResponse<String> fetch(String path) {
        try {
            return anonymous.send(
                    HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exception);
        }
    }

    private static String read(Path path) {
        try {
            return Files.readString(path);
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }
}
