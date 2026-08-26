package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Predicate;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class ApiContractCoverageTest extends AbstractIntegrationTest {

    // Read from the classpath, not from src: this is the copy that ships inside the jar, and the
    // instance is expected to be able to hand out its own contract.
    private static final String DOCUMENT = "/api/openapi.yaml";

    // Served by Spring Security's filter chain rather than by a controller, so no handler mapping
    // exists for it — but it is as much a part of the published API as anything else.
    private static final Set<String> NOT_BACKED_BY_A_HANDLER = Set.of(
            "POST /api/session",
            "POST /api/session/logout");

    // A query parameter is free-form only when its schema says nothing a value could break.
    private static final Set<String> REFUSABLE_KEYWORDS = Set.of(
            "format", "enum", "pattern", "minLength", "maxLength", "minimum", "maximum");

    private static Map<String, Object> document;

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    private RequestMappingHandlerMapping mappings;

    @Test
    void everyOperationTheApplicationServesIsInTheDocument() {
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
    void everyOperationInTheDocumentIsServedByTheApplication() {
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

    @Test
    void everyOperationWithAPathParameterDocumentsTheAnswerToAMalformedOne() {
        // when
        TreeSet<String> silent = operationsWithNo(
                "400", ApiContractCoverageTest::isAPathParameter);

        // then
        assertThat(silent)
                .as("a path parameter can always arrive malformed, and the shared advice answers"
                        + " 400 urn:courtside:error:parameter-type-mismatch for it. An operation"
                        + " that does not document 400 promises an error surface it does not have,"
                        + " and a client written against the document meets a status it was told"
                        + " could not happen.")
                .isEmpty();
    }

    @Test
    void everyOperationNamingARowInItsPathDocumentsTheAnswerToAnUnknownOne() {
        // when
        TreeSet<String> silent = operationsWithNo("404", ApiContractCoverageTest::namesARow);

        // then
        assertThat(silent)
                .as("a uuid path parameter names a row, and an id that names no row is answered"
                        + " 404. An operation that does not document it sends a client written"
                        + " against the document into a status it was told could not happen."
                        + " A path parameter that is an enum is exempt on purpose: every value it"
                        + " accepts exists, so there is no unknown one to answer.")
                .isEmpty();
    }

    @Test
    void everyOperationWithAQueryParameterItCanRefuseDocumentsTheAnswer() {
        // when
        TreeSet<String> silent = operationsWithNo("400", ApiContractCoverageTest::canBeRefused);

        // then
        assertThat(silent)
                .as("a query parameter carrying a type, a format, an enum or a bound can arrive as"
                        + " something the application refuses — 400"
                        + " urn:courtside:error:parameter-type-mismatch when it does not parse,"
                        + " urn:courtside:error:validation-failed when it parses but breaks its"
                        + " bound. Only a free-form string parameter has no refusal to document.")
                .isEmpty();
    }

    @SuppressWarnings("unchecked")
    private TreeSet<String> operationsWithNo(
            String status, Predicate<Map<String, Object>> reachesThatStatus) {
        TreeSet<String> missing = new TreeSet<>();
        paths().forEach((path, methods) -> {
            List<Object> shared = (List<Object>) methods.getOrDefault("parameters", List.of());
            methods.forEach((method, operation) -> {
                if (method.startsWith("x-") || method.equals("parameters")) {
                    return;
                }
                Map<String, Object> declared = (Map<String, Object>) operation;
                List<Object> own = (List<Object>) declared.getOrDefault("parameters", List.of());
                boolean reachable = Stream.concat(shared.stream(), own.stream())
                        .map(parameter -> (Map<String, Object>) resolve(parameter))
                        .anyMatch(reachesThatStatus);
                Map<String, Object> responses = (Map<String, Object>) declared.get("responses");
                if (reachable && (responses == null || !responses.containsKey(status))) {
                    missing.add(method.toUpperCase() + " " + path);
                }
            });
        });
        return missing;
    }

    private static boolean isAPathParameter(Map<String, Object> parameter) {
        return "path".equals(parameter.get("in"));
    }

    private static boolean namesARow(Map<String, Object> parameter) {
        return isAPathParameter(parameter) && "uuid".equals(schemaOf(parameter).get("format"));
    }

    private static boolean canBeRefused(Map<String, Object> parameter) {
        if (!"query".equals(parameter.get("in"))) {
            return false;
        }
        Map<String, Object> schema = schemaOf(parameter);
        return !"string".equals(schema.get("type"))
                || REFUSABLE_KEYWORDS.stream().anyMatch(schema::containsKey);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> schemaOf(Map<String, Object> parameter) {
        Object schema = resolve(parameter.getOrDefault("schema", Map.of()));
        return (Map<String, Object>) schema;
    }

    @SuppressWarnings("unchecked")
    private static Object resolve(Object node) {
        Object current = node;
        while (current instanceof Map<?, ?> map && map.get("$ref") instanceof String reference) {
            Object walked = document();
            for (String segment : reference.replaceFirst("^#/", "").split("/")) {
                walked = ((Map<String, Object>) walked).get(segment);
            }
            current = walked;
        }
        return current;
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
    private Map<String, Map<String, Object>> paths() {
        Map<String, Map<String, Object>> paths =
                (Map<String, Map<String, Object>>) document().get("paths");
        assertThat(paths).as("the document must describe at least one path").isNotEmpty();
        return paths;
    }

    private static Map<String, Object> document() {
        if (document == null) {
            try (InputStream in = ApiContractCoverageTest.class.getResourceAsStream(DOCUMENT)) {
                assertThat(in).as("the API document must be on the classpath at %s", DOCUMENT)
                        .isNotNull();
                document = new Yaml().load(in);
            } catch (IOException closingFailed) {
                throw new UncheckedIOException(closingFailed);
            }
        }
        return document;
    }

    private TreeSet<String> documentedOperations() {
        TreeSet<String> operations = new TreeSet<>();
        paths().forEach((path, methods) -> methods.keySet().stream()
                .filter(key -> !key.startsWith("x-") && !key.equals("parameters"))
                .forEach(method -> operations.add(method.toUpperCase() + " " + path)));
        return operations;
    }
}
