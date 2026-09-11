package org.courtside;

import org.junit.jupiter.api.Test;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

// The excluded packages come from the packaging that produces the artifact, so this cannot drift
// from the list that decides what a club receives.
class NonProductionProfileTest {

    private static final Pattern PROFILE = Pattern.compile("@Profile\\(\"([^\"]+)\"\\)");
    private static final Pattern EXCLUDED_PACKAGE = Pattern.compile("(org/courtside/[a-z]+)/\\*\\*");

    @Test
    void whenTheProductionSourcesAreRead_thenNoneIsBoundToANonProductionProfile() throws Exception {
        // given
        Set<String> excluded = excludedPackages();

        // when
        Set<String> bound = productionSources()
                .filter(source -> !excluded.stream().anyMatch(source::startsWith))
                .filter(NonProductionProfileTest::selectsAProfile)
                .collect(Collectors.toCollection(TreeSet::new));

        // then
        assertThat(excluded).as("packaging excludes nothing").isNotEmpty();
        assertThat(bound).as("a shipped class only exists for a non-production environment").isEmpty();
    }

    private static boolean selectsAProfile(String source) {
        try {
            Matcher matcher = PROFILE.matcher(Files.readString(Path.of(source)));
            while (matcher.find()) {
                if (!matcher.group(1).startsWith("!")) return true;
            }
            return false;
        } catch (IOException failure) {
            throw new IllegalStateException(source, failure);
        }
    }

    private static Stream<String> productionSources() throws IOException {
        try (Stream<Path> files = Files.walk(Path.of("src", "main", "java"))) {
            return files.filter(file -> file.toString().endsWith(".java"))
                    .map(file -> file.toString().replace('\\', '/')).toList().stream();
        }
    }

    private static Set<String> excludedPackages() throws Exception {
        NodeList excludes = DocumentBuilderFactory.newInstance().newDocumentBuilder()
                .parse(Path.of("pom.xml").toFile()).getElementsByTagName("exclude");
        return elements(excludes).stream()
                .map(element -> EXCLUDED_PACKAGE.matcher(element.getTextContent()))
                .filter(Matcher::matches)
                .map(matcher -> "src/main/java/" + matcher.group(1))
                .collect(Collectors.toCollection(TreeSet::new));
    }

    private static List<Element> elements(NodeList nodes) {
        return Stream.iterate(0, index -> index < nodes.getLength(), index -> index + 1)
                .map(nodes::item)
                .filter(node -> node.getNodeType() == Node.ELEMENT_NODE)
                .map(Element.class::cast)
                .toList();
    }
}
