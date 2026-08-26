package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.yaml.snakeyaml.Yaml;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Consumer;
import java.util.function.Predicate;

import static org.assertj.core.api.Assertions.assertThat;

class OmittedContainerWireTest extends AbstractIntegrationTest {

    private static final String DOCUMENT = "/api/openapi.yaml";

    private static final String MODEL_PREFIX = "org.courtside.api.Api";

    private static final Map<String, Object> DOCUMENT_TREE = load();

    private enum Absent { NULL, EMPTY }

    private record Container(String schema, String property) {
    }

    @Autowired
    private ObjectMapper mapper;

    @Test
    void everyRequiredContainerArrivesAbsentAsNullSoItsConstraintCanFail() {
        // when
        TreeSet<String> wrong = disagreeingWith(Absent.NULL, container ->
                requiredOf(container.schema()).contains(container.property()));

        // then
        assertThat(wrong)
                .as("an array or map the document requires must arrive as null when the body omits"
                        + " it, because the generated @NotNull is the only thing that refuses it. A"
                        + " container that arrives empty instead makes that constraint"
                        + " unfalsifiable: the request the document calls incomplete is accepted as"
                        + " though it had sent the empty set.")
                .isEmpty();
    }

    @Test
    void everyOptionalContainerArrivesAbsentAsEmptySoAReadNeedsNoGuard() {
        // when
        TreeSet<String> wrong = disagreeingWith(Absent.EMPTY, container ->
                !requiredOf(container.schema()).contains(container.property())
                        && !nullable(container));

        // then
        assertThat(wrong)
                .as("a container the document leaves optional without declaring it nullable must"
                        + " arrive empty, so the controller that reads it needs no null check. If"
                        + " one of these starts arriving as null, every unguarded read of it"
                        + " answers 500 to a request the document says is allowed.")
                .isEmpty();
    }

    @Test
    void everyNullableContainerArrivesAbsentAsNullBecauseTheDocumentSaysSo() {
        // when
        TreeSet<String> wrong = disagreeingWith(Absent.NULL, OmittedContainerWireTest::nullable);

        // then
        assertThat(wrong)
                .as("a container whose type admits null says absence means something other than"
                        + " the empty set — MoveRequest.newCourtIds leaves the courts as they are."
                        + " Arriving empty would erase that distinction at the wire.")
                .isEmpty();
    }

    private TreeSet<String> disagreeingWith(Absent expected, Predicate<Container> selects) {
        List<Container> selected = containers().stream().filter(selects).toList();
        assertThat(selected)
                .as("a bucket that selects no container proves nothing, so the document must still"
                        + " declare at least one")
                .isNotEmpty();
        TreeSet<String> wrong = new TreeSet<>();
        for (Container container : selected) {
            Object held = absentValueOf(container);
            boolean agrees = expected == Absent.NULL ? held == null : isEmptyContainer(held);
            if (!agrees) {
                wrong.add(container.schema() + "." + container.property()
                        + " arrived as " + described(held));
            }
        }
        return wrong;
    }

    private Object absentValueOf(Container container) {
        try {
            Class<?> type = Class.forName(MODEL_PREFIX + container.schema());
            Method getter = type.getMethod("get" + capitalized(container.property()));
            return getter.invoke(mapper.readValue("{}", type));
        } catch (ReflectiveOperationException notGenerated) {
            throw new AssertionError(
                    "the document names " + container.schema() + "." + container.property()
                            + ", which the generator did not produce as expected", notGenerated);
        }
    }

    private static boolean isEmptyContainer(Object held) {
        return held instanceof Collection<?> collection && collection.isEmpty()
                || held instanceof Map<?, ?> map && map.isEmpty();
    }

    private static String described(Object held) {
        if (held == null) {
            return "null";
        }
        return isEmptyContainer(held) ? "an empty container" : "a container holding " + held;
    }

    private static String capitalized(String property) {
        return Character.toUpperCase(property.charAt(0)) + property.substring(1);
    }

    private List<Container> containers() {
        List<Container> containers = new ArrayList<>();
        for (String schema : requestBodySchemas()) {
            propertiesOf(schema).forEach((property, definition) -> {
                if (isContainer(resolve(definition))) {
                    containers.add(new Container(schema, property));
                }
            });
        }
        assertThat(containers).as("the document must declare containers in its request bodies")
                .isNotEmpty();
        return containers;
    }

    private static boolean isContainer(Map<String, Object> schema) {
        List<String> kinds = kindsOf(schema);
        return kinds.contains("array")
                || kinds.contains("object") && schema.containsKey("additionalProperties");
    }

    private static boolean nullable(Container container) {
        return kindsOf(resolve(propertiesOf(container.schema()).get(container.property())))
                .contains("null");
    }

    @SuppressWarnings("unchecked")
    private static List<String> kindsOf(Map<String, Object> schema) {
        Object type = schema.get("type");
        if (type instanceof List<?> kinds) {
            return (List<String>) kinds;
        }
        return type == null ? List.of() : List.of((String) type);
    }

    // A composed schema states its own required list and its members', and the generator merges
    // both before it decides which field carries @NotNull.
    @SuppressWarnings("unchecked")
    private static Set<String> requiredOf(String schema) {
        Set<String> required = new LinkedHashSet<>();
        forEachPart(schema, part -> required.addAll(
                (Collection<String>) part.getOrDefault("required", List.of())));
        return required;
    }

    private static Map<String, Object> propertiesOf(String schema) {
        Map<String, Object> properties = new LinkedHashMap<>();
        forEachPart(schema, part -> properties.putAll(asMap(part.get("properties"))));
        return properties;
    }

    @SuppressWarnings("unchecked")
    private static void forEachPart(String schema, Consumer<Map<String, Object>> part) {
        Map<String, Object> definition = asMap(schemas().get(schema));
        for (Object member : (List<Object>) definition.getOrDefault("allOf", List.of())) {
            part.accept(resolve(member));
        }
        part.accept(definition);
    }

    private TreeSet<String> requestBodySchemas() {
        TreeSet<String> schemas = new TreeSet<>();
        asMap(DOCUMENT_TREE.get("paths")).forEach((path, item) ->
                asMap(item).forEach((method, operation) -> {
                    Map<String, Object> body = asMap(resolve(asMap(operation).get("requestBody")));
                    asMap(body.get("content")).forEach((mediaType, definition) ->
                            named(asMap(definition).get("schema")).ifPresent(schemas::add));
                }));
        return schemas;
    }

    private static Optional<String> named(Object schema) {
        Object reference = asMap(schema).get("$ref");
        if (reference instanceof String pointer && pointer.startsWith("#/components/schemas/")) {
            return Optional.of(pointer.substring(pointer.lastIndexOf('/') + 1));
        }
        return Optional.empty();
    }

    private static Map<String, Object> schemas() {
        return asMap(asMap(DOCUMENT_TREE.get("components")).get("schemas"));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> resolve(Object node) {
        Object current = node;
        while (asMap(current).get("$ref") instanceof String reference) {
            Object walked = DOCUMENT_TREE;
            for (String segment : reference.replaceFirst("^#/", "").split("/")) {
                walked = ((Map<String, Object>) walked).get(segment);
            }
            current = walked;
        }
        return asMap(current);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object node) {
        return node instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    private static Map<String, Object> load() {
        try (InputStream in = OmittedContainerWireTest.class.getResourceAsStream(DOCUMENT)) {
            assertThat(in).as("the API document must be on the classpath at %s", DOCUMENT).isNotNull();
            return new Yaml().load(in);
        } catch (IOException closingFailed) {
            throw new UncheckedIOException(closingFailed);
        }
    }
}
