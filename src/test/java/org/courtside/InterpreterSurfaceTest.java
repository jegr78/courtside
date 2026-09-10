package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class InterpreterSurfaceTest {

    private static final Map<String, List<String>> INTERPRETERS = new LinkedHashMap<>(Map.of(
            "an operating-system command", List.of("ProcessBuilder", "Runtime.getRuntime"),
            "an LDAP directory", List.of("javax.naming.directory", "InitialDirContext", "LdapContext"),
            "a JNDI lookup", List.of("InitialContext", "javax.naming.Context"),
            "an XPath expression", List.of("XPathFactory", "javax.xml.xpath"),
            "an XML parser", List.of("DocumentBuilder", "SAXParser", "XMLInputFactory", "XmlMapper",
                    "javax.xml.parsers", "TransformerFactory"),
            "a memcache client", List.of("MemcachedClient", "net.spy.memcached"),
            "a LaTeX processor", List.of("pdflatex", "shell-escape"),
            "a dynamic expression", List.of("SpelExpressionParser", "ScriptEngineManager",
                    "javax.script", "GroovyShell"),
            "an archive extractor", List.of("ZipInputStream", "GZIPInputStream", "ZipFile",
                    "InflaterInputStream", "CompressorStreamFactory", "ArchiveStreamFactory")));

    private static final Pattern COMPILED_PATTERN = Pattern.compile("Pattern\\.compile\\(\\s*");

    @Test
    void whenReadingTheShippedSource_thenNoInterpreterIsThereForAnInjectionToReach() throws IOException {
        // given
        TreeSet<String> reached = new TreeSet<>();

        // when
        for (Path source : shippedSources()) {
            String text = Files.readString(source);
            INTERPRETERS.forEach((interpreter, markers) -> {
                if (markers.stream().anyMatch(text::contains)) {
                    reached.add(interpreter + " in " + Path.of("src/main/java").relativize(source));
                }
            });
        }

        // then
        assertThat(reached)
                .as("every one of these gives untrusted input a second language to be read in."
                        + " Adding one means the ASVS and WSTG control for that interpreter now"
                        + " applies to Courtside and needs its own evidence, so this list stays empty.")
                .isEmpty();
    }

    @Test
    void whenReadingEveryCompiledPattern_thenItsSourceIsALiteralAndNotARequest() throws IOException {
        // given
        TreeSet<String> built = new TreeSet<>();

        // when
        for (Path source : shippedSources()) {
            String text = Files.readString(source);
            Matcher matcher = COMPILED_PATTERN.matcher(text);
            while (matcher.find()) {
                if (matcher.end() >= text.length() || text.charAt(matcher.end()) != '"') {
                    built.add(Path.of("src/main/java").relativize(source).toString());
                }
            }
        }

        // then
        assertThat(built)
                .as("a pattern built from anything but a literal lets its source decide what the"
                        + " metacharacters mean, which is the injection this control is about.")
                .isEmpty();
    }

    private static List<Path> shippedSources() throws IOException {
        try (Stream<Path> sources = Files.walk(Path.of("src/main/java"))) {
            return sources.filter(path -> path.toString().endsWith(".java")).toList();
        }
    }
}
