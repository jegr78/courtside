package org.courtside;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class DataProtectionInventoryTest extends AbstractIntegrationTest {

    private static final Path INVENTORY = Path.of("security/data-protection-inventory.json");

    private static final Pattern LOG_STATEMENT = Pattern.compile(
            "log\\.(trace|debug|info|warn|error)\\((?:[^;]|\\n)*?\\);", Pattern.MULTILINE);

    private static final Pattern CACHE_FIELD = Pattern.compile(
            "private final [^;\\n]*\\b(cache|Cache)\\b[^;\\n]*;");

    @Autowired
    private JdbcClient jdbc;

    @Test
    void whenTheSchemaIsRead_thenEveryStoredFieldCarriesAProtectionLevelAndAnOwner() {
        // when
        TreeSet<String> stored = storedFields();

        // then
        assertThat(classified().keySet())
                .as("a stored field nobody classified is a field whose handling rules nothing"
                        + " derives. Give it a level and the lifecycle that ends it.")
                .isEqualTo(stored);
    }

    @Test
    void whenTheInventoryIsRead_thenEveryLevelAndOwnerIsOneTheDocumentDefines() {
        // given
        JsonNode inventory = inventory();
        Set<String> levels = names(inventory.get("levels"));
        Set<String> owners = names(inventory.get("lifecycles"));

        // when / then
        classified().forEach((field, entry) -> {
            assertThat(levels)
                    .as("%s carries the level %s, which the inventory does not define", field,
                            entry.get("level").asText())
                    .contains(entry.get("level").asText());
            assertThat(owners)
                    .as("%s names the lifecycle %s, which the inventory does not define", field,
                            entry.get("lifecycle").asText())
                    .contains(entry.get("lifecycle").asText());
        });
    }

    @Test
    void whenAFieldIsClassifiedAsASecret_thenNoResponseSchemaCarriesItsName() {
        // given
        String contract = read(Path.of("src/main/resources/api/openapi.yaml"));
        TreeSet<String> exposed = new TreeSet<>();

        // when
        classified().forEach((field, entry) -> {
            if (!"secret".equals(entry.get("level").asText())) {
                return;
            }
            String property = camelCase(field.substring(field.indexOf('.') + 1));
            if (contract.contains(property + ":") || contract.contains(property + ",")) {
                exposed.add(field + " as " + property);
            }
        });

        // then
        assertThat(exposed)
                .as("a column classified as a secret must not be a name the published contract"
                        + " carries, because that is the contract offering to hand it out")
                .isEmpty();
    }

    @Test
    void whenAPersonalFieldIsRead_thenNoLogStatementIsHandedItsValue() {
        // given
        Set<String> accessors = personalAccessors();

        // when
        TreeSet<String> handed = new TreeSet<>();
        sourceFiles().forEach(file -> {
            String source = read(file);
            Matcher statement = LOG_STATEMENT.matcher(source);
            while (statement.find()) {
                accessors.stream().filter(statement.group()::contains)
                        .forEach(accessor -> handed.add(file + " logs " + accessor));
            }
        });

        // then
        assertThat(handed)
                .as("a log line carrying a name, an address or a member number puts it into a"
                        + " retention the operator owns and this instance cannot reach. Log the"
                        + " account id instead.")
                .isEmpty();
    }

    @Test
    void whenTheApplicationKeepsSomethingInMemory_thenTheInventoryNamesThatCache() {
        // given
        Set<String> declared = names(inventory().get("caches"));

        // when
        TreeSet<String> found = new TreeSet<>();
        sourceFiles().forEach(file -> {
            if (CACHE_FIELD.matcher(read(file)).find()) {
                found.add(file.getFileName().toString().replace(".java", ""));
            }
        });

        // then
        assertThat(found)
                .as("a cache holds a copy of something outside the schema and outside its sweep,"
                        + " so the inventory says what is in it and what bounds it")
                .isEqualTo(new TreeSet<>(declared));
    }

    private Set<String> personalAccessors() {
        TreeSet<String> accessors = new TreeSet<>();
        classified().forEach((field, entry) -> {
            if ("personal".equals(entry.get("level").asText())) {
                String column = field.substring(field.indexOf('.') + 1);
                accessors.add("get" + Character.toUpperCase(camelCase(column).charAt(0))
                        + camelCase(column).substring(1) + "()");
            }
        });
        return accessors;
    }

    private static Stream<Path> sourceFiles() {
        try (Stream<Path> files = Files.walk(Path.of("src/main/java"))) {
            return files.filter(path -> path.toString().endsWith(".java")).toList().stream();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private TreeMap<String, JsonNode> classified() {
        TreeMap<String, JsonNode> fields = new TreeMap<>();
        inventory().get("storedFields").properties().forEach(table ->
                table.getValue().properties().forEach(column ->
                        fields.put(table.getKey() + "." + column.getKey(), column.getValue())));
        return fields;
    }

    private TreeSet<String> storedFields() {
        TreeSet<String> fields = new TreeSet<>();
        publicTables(jdbc).forEach(table -> jdbc.sql("""
                        SELECT column_name
                        FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = :table
                        """).param("table", table).query(String.class).list()
                .forEach(column -> fields.add(table + "." + column)));
        return fields;
    }

    private static Set<String> names(JsonNode node) {
        TreeSet<String> found = new TreeSet<>();
        node.properties().forEach(property -> found.add(property.getKey()));
        return found;
    }

    private static String camelCase(String column) {
        StringBuilder camel = new StringBuilder();
        boolean capitalise = false;
        for (char character : column.toCharArray()) {
            if (character == '_') {
                capitalise = true;
            } else {
                camel.append(capitalise ? Character.toUpperCase(character) : character);
                capitalise = false;
            }
        }
        return camel.toString();
    }

    private JsonNode inventory() {
        return new ObjectMapper().readTree(read(INVENTORY));
    }

    private static String read(Path path) {
        try {
            return Files.readString(path);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
