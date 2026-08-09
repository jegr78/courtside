package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.assertj.core.api.Assertions.assertThat;

// Walks Spring's mapping registry and the document in both directions, so neither an undocumented
// endpoint nor an unserved contract entry can ship.
class ApiContractCoverageTest extends AbstractIntegrationTest {

    // Read from the classpath, not from src: this is the copy that ships inside the jar, and the
    // instance is expected to be able to hand out its own contract.
    private static final String DOCUMENT = "/api/openapi.yaml";

    // Served by Spring Security's filter chain rather than by a controller, so no handler mapping
    // exists for it — but it is as much a part of the published API as anything else.
    private static final Set<String> NOT_BACKED_BY_A_HANDLER = Set.of(
            "POST /api/session",
            "POST /api/session/logout");

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    private RequestMappingHandlerMapping mappings;

    @Test
    void everyOperationTheApplicationServesIsInTheDocument() throws IOException {
        // when
        TreeSet<String> served = servedOperations();
        TreeSet<String> documented = documentedOperations();

        // then
        assertThat(served)
                .as("an endpoint the application serves but the document does not describe is an"
                        + " API change nobody reviewed. Add it to %s.", DOCUMENT)
                .isSubsetOf(documented);
    }

    @Test
    void everyOperationInTheDocumentIsServedByTheApplication() throws IOException {
        // when
        TreeSet<String> served = servedOperations();
        served.addAll(NOT_BACKED_BY_A_HANDLER);
        TreeSet<String> documented = documentedOperations();

        // then
        assertThat(documented)
                .as("the document promises an operation nothing serves. Either implement it or"
                        + " remove it — a contract that describes what does not exist is worse than"
                        + " no contract.")
                .isSubsetOf(served);
    }

    private TreeSet<String> servedOperations() {
        TreeSet<String> operations = new TreeSet<>();
        for (Map.Entry<RequestMappingInfo, ?> entry : mappings.getHandlerMethods().entrySet()) {
            RequestMappingInfo info = entry.getKey();
            var patterns = info.getPathPatternsCondition();
            if (patterns == null) {
                continue;
            }
            patterns.getPatterns().stream()
                    .map(pattern -> pattern.getPatternString())
                    .filter(path -> path.startsWith("/api") || path.equals("/manifest.webmanifest"))
                    .forEach(path -> info.getMethodsCondition().getMethods()
                            .forEach(method -> operations.add(method + " " + path)));
        }
        return operations;
    }

    @SuppressWarnings("unchecked")
    private TreeSet<String> documentedOperations() throws IOException {
        Map<String, Object> document;
        try (InputStream in = ApiContractCoverageTest.class.getResourceAsStream(DOCUMENT)) {
            assertThat(in).as("the API document must be on the classpath at %s", DOCUMENT).isNotNull();
            document = new Yaml().load(in);
        }
        Map<String, Map<String, Object>> paths =
                (Map<String, Map<String, Object>>) document.get("paths");
        assertThat(paths).as("the document must describe at least one path").isNotEmpty();

        TreeSet<String> operations = new TreeSet<>();
        paths.forEach((path, methods) -> methods.keySet().stream()
                .filter(key -> !key.startsWith("x-") && !key.equals("parameters"))
                .forEach(method -> operations.add(method.toUpperCase() + " " + path)));
        return operations;
    }
}
