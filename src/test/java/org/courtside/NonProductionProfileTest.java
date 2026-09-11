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

    private static final Pattern PROFILE = Pattern.compile("@(?:\\w+\\.)*Profile\\(\"(?!!)");
    private static final Pattern CONDITION = Pattern.compile("@(?:\\w+\\.)*Conditional\\w*");
    private static final String ENVIRONMENT = "courtside.environment";
    private static final Pattern EXCLUDED_PACKAGE = Pattern.compile("(org/courtside/[a-z]+)/\\*\\*");
    // The assessment has to read the host and scheme the application itself saw, and only the
    // application can answer that; docs/design.md section 10 records what the residue costs.
    private static final Set<String> REVIEWED_INSTRUMENTATION =
            Set.of("src/main/java/org/courtside/identity/internal/SecurityRequestObservationFilter.java");

    @Test
    void whenTheProductionSourcesAreRead_thenOnlyReviewedInstrumentationIsGatedToAnEnvironment()
            throws Exception {
        // given
        Set<String> excluded = excludedPackages();

        // when
        Set<String> gated = productionSources().stream()
                .filter(source -> excluded.stream().noneMatch(source::startsWith))
                .filter(NonProductionProfileTest::selectsAnEnvironment)
                .collect(Collectors.toCollection(TreeSet::new));

        // then
        assertThat(excluded).as("packaging excludes nothing").isNotEmpty();
        assertThat(gated).as("a shipped class exists only for a non-production environment")
                .containsExactlyInAnyOrderElementsOf(REVIEWED_INSTRUMENTATION);
    }

    @Test
    void whenThePackagingIsRead_thenTheStagedFixturesAreExactlyTheExcludedOnes() throws Exception {
        // given
        Element packaging = document();

        // when
        Set<String> staged = paths(named("execution", "id", "stage-fixtures",
                named("plugin", "artifactId", "maven-resources-plugin", packaging)), "include");

        // then
        assertThat(staged).as("the fixture artifact is not built from what the production jar drops")
                .isEqualTo(paths(named("execution", "id", "default-jar",
                        named("plugin", "artifactId", "maven-jar-plugin", packaging)), "exclude"));
    }

    private static boolean selectsAnEnvironment(String source) {
        try {
            String text = Files.readString(Path.of(source));
            return PROFILE.matcher(text).find()
                    || CONDITION.matcher(text).find() && text.contains(ENVIRONMENT);
        } catch (IOException failure) {
            throw new IllegalStateException(source, failure);
        }
    }

    private static List<String> productionSources() throws IOException {
        try (Stream<Path> files = Files.walk(Path.of("src", "main", "java"))) {
            return files.filter(file -> file.toString().endsWith(".java"))
                    .map(file -> file.toString().replace('\\', '/')).toList();
        }
    }

    private static Set<String> excludedPackages() throws Exception {
        return paths(named("execution", "id", "default-jar",
                named("plugin", "artifactId", "maven-jar-plugin", document())), "exclude").stream()
                .map(EXCLUDED_PACKAGE::matcher)
                .filter(Matcher::matches)
                .map(matcher -> "src/main/java/" + matcher.group(1))
                .collect(Collectors.toCollection(TreeSet::new));
    }

    private static Set<String> paths(Element parent, String tag) {
        return elements(parent.getElementsByTagName(tag)).stream()
                .map(Element::getTextContent)
                .collect(Collectors.toCollection(TreeSet::new));
    }

    private static Element document() throws Exception {
        return DocumentBuilderFactory.newInstance().newDocumentBuilder()
                .parse(Path.of("pom.xml").toFile()).getDocumentElement();
    }

    private static Element named(String tag, String field, String value, Element parent) {
        return elements(parent.getElementsByTagName(tag)).stream()
                .filter(element -> elements(element.getElementsByTagName(field)).stream()
                        .anyMatch(child -> value.equals(child.getTextContent())))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("pom.xml declares no " + tag + " " + value));
    }

    private static List<Element> elements(NodeList nodes) {
        return Stream.iterate(0, index -> index < nodes.getLength(), index -> index + 1)
                .map(nodes::item)
                .filter(node -> node.getNodeType() == Node.ELEMENT_NODE)
                .map(Element.class::cast)
                .toList();
    }
}
