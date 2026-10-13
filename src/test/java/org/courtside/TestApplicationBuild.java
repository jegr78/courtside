package org.courtside;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

public final class TestApplicationBuild {

    public static final String STATIC_LOCATIONS = "spring.web.resources.static-locations";

    private static final Path INVENTORY = Path.of("security/published-web-resources.json");

    private TestApplicationBuild() {
    }

    public static List<String> staticPaths() {
        try {
            JsonNode inventory = new ObjectMapper().readTree(Files.readString(INVENTORY));
            return inventory.get("anonymousStaticPaths").values().stream()
                    .map(pattern -> pattern.asString().replace("**", "probe.js").replace("*", "probe"))
                    .sorted()
                    .toList();
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    public static Path create() {
        try {
            Path build = Files.createTempDirectory(Files.createDirectories(Path.of("target")), "test-build");
            for (String path : staticPaths()) {
                Path file = build.resolve(path.substring(1));
                Files.createDirectories(file.getParent());
                Files.writeString(file, "built " + path);
            }
            return build;
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    public static void delete(Path build) {
        try (Stream<Path> files = Files.walk(build)) {
            for (Path file : files.sorted(Comparator.reverseOrder()).toList()) {
                Files.delete(file);
            }
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }
}
