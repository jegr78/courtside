package org.courtside.notification;

import org.junit.jupiter.api.Test;

import java.util.Locale;
import java.util.Map;
import java.util.ResourceBundle;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class MailTemplatesTest {

    private static final Set<String> KEYS = Set.of(
            "credentials.newAccount.subject", "credentials.newAccount.body",
            "credentials.passwordReset.subject", "credentials.passwordReset.body");

    @Test
    void whenReadingBothLocales_thenEachDefinesTheSameKeys() {
        // when
        Set<String> german = ResourceBundle.getBundle("mail", Locale.GERMAN).keySet();
        Set<String> english = ResourceBundle.getBundle("mail", Locale.ENGLISH).keySet();

        // then
        assertThat(german).isEqualTo(english).containsAll(KEYS);
    }

    @Test
    void givenACredentialMessage_whenRenderedInEitherLocale_thenNoPlaceholderSurvives() {
        // given
        Map<String, String> values = Map.of("clubName", "Example Tennis Club",
                "firstName", "Jane", "username", "doe.jane",
                "credential", "a-credential", "expiresOn", "1 May 2026");

        // when / then — an unresolved {name} would reach a member as punctuation
        for (Locale locale : new Locale[] {Locale.GERMAN, Locale.ENGLISH}) {
            for (String key : KEYS) {
                assertThat(render(key, locale, values))
                        .as("%s in %s", key, locale)
                        .doesNotContain("{").doesNotContain("}");
            }
        }
    }

    @Test
    void givenACredentialMessage_whenRendered_thenItNamesTheClubAndCarriesTheCredential() {
        // given
        Map<String, String> values = Map.of("clubName", "Example Tennis Club",
                "firstName", "Jane", "username", "doe.jane",
                "credential", "a-credential", "expiresOn", "1 May 2026");

        // when / then
        assertThat(render("credentials.newAccount.body", Locale.GERMAN, values))
                .contains("Example Tennis Club").contains("doe.jane").contains("a-credential");
        assertThat(render("credentials.newAccount.subject", Locale.ENGLISH, values))
                .contains("Example Tennis Club");
    }

    private static String render(String key, Locale locale, Map<String, String> values) {
        String rendered = ResourceBundle.getBundle("mail", locale).getString(key);
        for (Map.Entry<String, String> value : values.entrySet()) {
            rendered = rendered.replace("{" + value.getKey() + "}", value.getValue());
        }
        return rendered;
    }
}
