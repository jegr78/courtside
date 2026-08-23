package org.courtside.shared.internal;

import org.courtside.shared.SupportedLanguages;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.core.io.support.ResourcePatternResolver;

import java.util.Arrays;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ShippedLanguagesTest {

    @Test
    void givenAnImageCarryingAThirdLanguage_whenReadingWhatItShips_thenThatLanguageIsOffered() {
        // given
        SupportedLanguages languages = languagesOf("messages_de.properties, messages_fr.properties",
                "mail_de.properties, mail_fr.properties");

        // when / then — nothing names French anywhere; both bundles being present is what says so
        assertThat(languages.tags()).containsExactly("de", "en", "fr");
        assertThat(languages.supports("fr")).isTrue();
    }

    @Test
    void givenNoTranslatedBundleAtAll_whenReadingWhatItShips_thenTheBaseLanguageStandsAlone() {
        // given
        SupportedLanguages languages = languagesOf("", "");

        // when / then
        assertThat(languages.tags()).containsExactly("en");
    }

    @Test
    void givenARegionalBundle_whenReadingWhatItShips_thenItIsOfferedAsALanguageTag() {
        // given
        SupportedLanguages languages = languagesOf("messages_pt_BR.properties", "mail_pt_BR.properties");

        // when / then — the file name separates with an underscore, a language tag with a hyphen
        assertThat(languages.tags()).containsExactly("en", "pt-BR");
    }

    @Test
    void givenALanguageTranslatedForTheScreenButNotForTheMail_whenStarting_thenItRefusesToStart() {
        // when / then — half a translation would reach a member as a message in another language
        assertThatThrownBy(() -> languagesOf("messages_fr.properties", "").tags())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("fr")
                .hasMessageContaining("mail");
    }

    @Test
    void whenAskedAboutALanguageItDoesNotShip_thenItSaysSo() {
        // given
        SupportedLanguages languages = languagesOf("messages_de.properties", "mail_de.properties");

        // when / then
        assertThat(languages.supports("fr")).isFalse();
        assertThat(languages.supports(null)).isFalse();
        assertThat(languages.supports(" ")).isFalse();
    }

    @Test
    void whenReadingTheBundlesThisImageActuallyCarries_thenBothShippedLanguagesAreFound() {
        // when
        SupportedLanguages languages = new ShippedLanguages(new PathMatchingResourcePatternResolver());

        // then — the scan reaching the real classpath is what the stubbed cases cannot prove
        assertThat(languages.tags()).containsExactly("de", "en");
    }

    private static SupportedLanguages languagesOf(String screenBundles, String mailBundles) {
        return new ShippedLanguages(new StubResolver(Map.of(
                "classpath*:messages_*.properties", screenBundles,
                "classpath*:mail_*.properties", mailBundles)));
    }

    private record StubResolver(Map<String, String> fileNamesByPattern) implements ResourcePatternResolver {

        @Override
        public Resource[] getResources(String pattern) {
            String names = fileNamesByPattern.getOrDefault(pattern, "");
            return names.isBlank() ? new Resource[0] : Arrays.stream(names.split(","))
                    .map(String::trim)
                    .map(name -> (Resource) new ClassPathResource(name))
                    .toArray(Resource[]::new);
        }

        @Override
        public Resource getResource(String location) {
            return new ClassPathResource(location);
        }

        @Override
        public ClassLoader getClassLoader() {
            return getClass().getClassLoader();
        }
    }
}
