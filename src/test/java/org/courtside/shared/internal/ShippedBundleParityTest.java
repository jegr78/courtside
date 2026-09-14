package org.courtside.shared.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.io.IOException;
import java.io.InputStreamReader;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class ShippedBundleParityTest {

    private static final Pattern PLACEHOLDER = Pattern.compile("\\{([^}]*)}");

    @ParameterizedTest
    @ValueSource(strings = {"messages", "mail", "seed"})
    void givenATranslatedBundle_whenComparingItWithItsBase_thenNeitherSideCarriesAKeyTheOtherLacks(
            String family) throws IOException {
        // given
        Properties base = read(family + ".properties");

        // when / then
        for (Resource translated : translationsOf(family)) {
            Properties other = read(translated.getFilename());
            assertThat(new TreeSet<>(other.stringPropertyNames()))
                    .as("%s and %s are read by the same key, so a key only one of them has is a"
                            + " member who gets an untranslated message or none", family, translated.getFilename())
                    .isEqualTo(new TreeSet<>(base.stringPropertyNames()));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"messages", "mail", "seed"})
    void givenATranslatedValue_whenComparingItsPlaceholders_thenItNamesTheSameOnes(String family)
            throws IOException {
        // given
        Properties base = read(family + ".properties");

        // when
        TreeMap<String, String> differing = new TreeMap<>();
        for (Resource translated : translationsOf(family)) {
            Properties other = read(translated.getFilename());
            for (String key : base.stringPropertyNames()) {
                String value = other.getProperty(key);
                if (value == null) {
                    continue;
                }
                TreeSet<String> expected = placeholdersIn(base.getProperty(key));
                TreeSet<String> found = placeholdersIn(value);
                if (!expected.equals(found)) {
                    differing.put(translated.getFilename() + " " + key, expected + " vs " + found);
                }
            }
        }

        // then
        assertThat(differing)
                .as("a placeholder the renderer is never given is rendered as itself, so the member"
                        + " reads the name of a field instead of its value")
                .isEmpty();
    }

    @Test
    void whenReadingTheBundlesThisImageCarries_thenEachFamilyHasATranslationToCompare()
            throws IOException {
        // when / then
        assertThat(translationsOf("messages")).isNotEmpty();
        assertThat(translationsOf("mail")).isNotEmpty();
        assertThat(translationsOf("seed")).isNotEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"messages", "mail", "seed"})
    void givenAShippedBundle_whenReadingWhatItSays_thenNoValueOfItIsBlank(String family)
            throws IOException {
        // given
        List<Properties> bundles = new ArrayList<>();
        bundles.add(read(family + ".properties"));
        for (Resource translated : translationsOf(family)) {
            bundles.add(read(translated.getFilename()));
        }

        // when
        TreeSet<String> blank = new TreeSet<>();
        for (Properties bundle : bundles) {
            for (String key : bundle.stringPropertyNames()) {
                if (bundle.getProperty(key).isBlank()) {
                    blank.add(key);
                }
            }
        }

        // then
        assertThat(blank)
                .as("a blank value reaches a member as nothing at all, and a shipped row named this"
                        + " way is refused by the constraint that keeps a name from being empty")
                .isEmpty();
    }

    private static TreeSet<String> placeholdersIn(String value) {
        TreeSet<String> names = new TreeSet<>();
        Matcher found = PLACEHOLDER.matcher(value);
        while (found.find()) {
            names.add(found.group(1));
        }
        return names;
    }

    private static List<Resource> translationsOf(String family) throws IOException {
        List<Resource> translations = new ArrayList<>();
        for (Resource resource : new PathMatchingResourcePatternResolver()
                .getResources("classpath*:" + family + "_*.properties")) {
            translations.add(resource);
        }
        return translations;
    }

    private static Properties read(String name) throws IOException {
        Properties properties = new Properties();
        try (InputStream source = ShippedBundleParityTest.class.getClassLoader()
                .getResourceAsStream(name)) {
            assertThat(source).as("%s is on the classpath", name).isNotNull();
            properties.load(new InputStreamReader(source, StandardCharsets.UTF_8));
        }
        return properties;
    }
}
