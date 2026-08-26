package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Predicate;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
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
            "format", "enum", "pattern", "minLength", "maxLength",
            "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf");

    private static final Pattern TEMPLATED_SEGMENT = Pattern.compile("\\{([^}]+)}");

    private static final int LONGEST_REF_CHAIN = 16;

    private static final Map<String, Object> DOCUMENT_TREE = load();

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
                .as("a path parameter that is not an enum names something that may not exist — a"
                        + " uuid names a row, an external identifier names a reference — and what"
                        + " names nothing is answered 404. An operation that does not document it"
                        + " sends a client written against the document into a status it was told"
                        + " could not happen. An enum path parameter is exempt on purpose: every"
                        + " value it accepts exists, so there is no unknown one to answer.")
                .isEmpty();
    }

    @Test
    void everyTemplatedPathDeclaresTheParametersItNames() {
        // when
        TreeSet<String> undeclared = new TreeSet<>();
        paths().forEach((path, methods) -> operationsOf(methods).forEach((method, operation) ->
                TEMPLATED_SEGMENT.matcher(path).results().forEach(segment -> {
                    if (pathParameterNames(methods, operation).contains(segment.group(1))) {
                        return;
                    }
                    undeclared.add(method.toUpperCase() + " " + path + " {" + segment.group(1) + "}");
                })));

        // then
        assertThat(undeclared)
                .as("the checks that decide what an operation must document read its declared"
                        + " parameters. A path that names a variable the operation does not declare"
                        + " is invisible to them, so a whole operation would drop out of every rule"
                        + " at once.")
                .isEmpty();
    }

    @Test
    void everyDeclaredClientErrorCarriesAProblemBody() {
        // when
        TreeSet<String> hollow = new TreeSet<>();
        paths().forEach((path, methods) -> operationsOf(methods).forEach((method, operation) ->
                responsesOf(operation).forEach((status, response) -> {
                    if (!status.startsWith("4") && !status.startsWith("5")) {
                        return;
                    }
                    if (problemBodyOf(response) != problemSchema()) {
                        hollow.add(method.toUpperCase() + " " + path + " " + status);
                    }
                })));

        // then
        assertThat(hollow)
                .as("a status key on its own promises nothing a client can read. Every error this"
                        + " document declares answers application/problem+json with the Problem"
                        + " schema, and a declaration without that body would satisfy the rules"
                        + " above while documenting an empty shape.")
                .isEmpty();
    }

    @Test
    void everyOperationWithAQueryParameterItCanRefuseDocumentsTheAnswer() {
        // when
        TreeSet<String> silent = operationsWithNo("400", ApiContractCoverageTest::canBeRefused);

        // then
        assertThat(silent)
                .as("a query parameter whose schema states a type, a format, an enum or a bound can"
                        + " arrive as something the application refuses — 400"
                        + " urn:courtside:error:parameter-type-mismatch when it does not parse,"
                        + " urn:courtside:error:validation-failed when it parses but breaks its"
                        + " bound — and a required one is refused by being left out at all. Only an"
                        + " optional parameter whose schema states nothing has no refusal to"
                        + " document.")
                .isEmpty();
    }

    private TreeSet<String> operationsWithNo(
            String status, Predicate<Map<String, Object>> reachesThatStatus) {
        TreeSet<String> missing = new TreeSet<>();
        paths().forEach((path, methods) -> operationsOf(methods).forEach((method, operation) -> {
            if (parametersOf(methods, operation).stream().anyMatch(reachesThatStatus)
                    && !responsesOf(operation).containsKey(status)) {
                missing.add(method.toUpperCase() + " " + path);
            }
        }));
        return missing;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Map<String, Object>> operationsOf(Map<String, Object> pathItem) {
        Map<String, Map<String, Object>> operations = new LinkedHashMap<>();
        pathItem.forEach((key, value) -> {
            if (!key.startsWith("x-") && !key.equals("parameters") && value instanceof Map<?, ?>) {
                operations.put(key, (Map<String, Object>) value);
            }
        });
        return operations;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> parametersOf(
            Map<String, Object> pathItem, Map<String, Object> operation) {
        List<Object> shared = (List<Object>) pathItem.getOrDefault("parameters", List.of());
        List<Object> own = (List<Object>) operation.getOrDefault("parameters", List.of());
        return Stream.concat(shared.stream(), own.stream())
                .map(parameter -> (Map<String, Object>) resolve(parameter))
                .toList();
    }

    private static Set<String> pathParameterNames(
            Map<String, Object> pathItem, Map<String, Object> operation) {
        return parametersOf(pathItem, operation).stream()
                .filter(ApiContractCoverageTest::isAPathParameter)
                .map(parameter -> String.valueOf(parameter.get("name")))
                .collect(Collectors.toSet());
    }

    private static Map<String, Object> responsesOf(Map<String, Object> operation) {
        return mapAt(operation, "responses");
    }

    private static boolean isAPathParameter(Map<String, Object> parameter) {
        return "path".equals(parameter.get("in"));
    }

    private static boolean namesARow(Map<String, Object> parameter) {
        return isAPathParameter(parameter) && !schemaOf(parameter).containsKey("enum");
    }

    // Absence answers 400 too, so a required parameter is refusable whatever its schema says.
    private static boolean canBeRefused(Map<String, Object> parameter) {
        if (!"query".equals(parameter.get("in"))) {
            return false;
        }
        if (Boolean.TRUE.equals(parameter.get("required"))) {
            return true;
        }
        Map<String, Object> schema = schemaOf(parameter);
        return !schema.isEmpty()
                && (!"string".equals(schema.get("type"))
                        || REFUSABLE_KEYWORDS.stream().anyMatch(schema::containsKey));
    }

    private static Object problemSchema() {
        return resolve(Map.of("$ref", "#/components/schemas/Problem"));
    }

    private static Object problemBodyOf(Object response) {
        Map<String, Object> body = mapAt(mapAt(resolve(response), "content"),
                MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        return resolve(body.getOrDefault("schema", Map.of()));
    }

    private static Map<String, Object> schemaOf(Map<String, Object> parameter) {
        return asMap(resolve(parameter.getOrDefault("schema", Map.of())));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapAt(Object node, String key) {
        Object value = node instanceof Map<?, ?> map ? ((Map<String, Object>) map).get(key) : null;
        return value == null ? Map.of() : asMap(resolve(value));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object node) {
        return node instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    private static Object resolve(Object node) {
        Object current = node;
        for (int hops = 0; current instanceof Map<?, ?> map
                && map.get("$ref") instanceof String reference; hops++) {
            assertThat(hops)
                    .as("following %s never reaches a node that is not a reference", reference)
                    .isLessThan(LONGEST_REF_CHAIN);
            current = referenced(reference);
        }
        return current;
    }

    @SuppressWarnings("unchecked")
    private static Object referenced(String reference) {
        Object walked = DOCUMENT_TREE;
        for (String segment : reference.replaceFirst("^#/", "").split("/")) {
            assertThat(walked).as("%s leads out of the document", reference).isInstanceOf(Map.class);
            walked = ((Map<String, Object>) walked).get(unescaped(segment));
        }
        assertThat(walked).as("%s names nothing in this document", reference).isNotNull();
        return walked;
    }

    // RFC 6901 orders the two, because unescaping ~0 first would turn ~01 into a slash.
    private static String unescaped(String segment) {
        return segment.replace("~1", "/").replace("~0", "~");
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
                (Map<String, Map<String, Object>>) DOCUMENT_TREE.get("paths");
        assertThat(paths).as("the document must describe at least one path").isNotEmpty();
        return paths;
    }

    private static Map<String, Object> load() {
        try (InputStream in = ApiContractCoverageTest.class.getResourceAsStream(DOCUMENT)) {
            assertThat(in).as("the API document must be on the classpath at %s", DOCUMENT)
                    .isNotNull();
            return new Yaml().load(in);
        } catch (IOException closingFailed) {
            throw new UncheckedIOException(closingFailed);
        }
    }

    private TreeSet<String> documentedOperations() {
        TreeSet<String> operations = new TreeSet<>();
        paths().forEach((path, methods) -> operationsOf(methods).keySet()
                .forEach(method -> operations.add(method.toUpperCase() + " " + path)));
        return operations;
    }
}
