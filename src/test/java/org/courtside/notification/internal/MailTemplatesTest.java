package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;

import java.util.Locale;
import java.util.Map;
import java.util.ResourceBundle;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MailTemplatesTest {

    private static final Set<String> KEYS = Set.of(
            "credentials.newAccount.subject", "credentials.newAccount.body",
            "credentials.passwordReset.subject", "credentials.passwordReset.body");

    private static final Map<String, String> VALUES = Map.of("clubName", "Example Tennis Club",
            "firstName", "Jane", "username", "doe.jane",
            "credential", "a-credential", "expiresOn", "1 May 2026");

    private final MailTemplates templates = new MailTemplates();

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
        // when / then — an unresolved {name} would reach a member as punctuation
        for (Locale locale : new Locale[] {Locale.GERMAN, Locale.ENGLISH}) {
            for (String key : KEYS) {
                assertThat(templates.render(key, locale, VALUES))
                        .as("%s in %s", key, locale)
                        .doesNotContain("{").doesNotContain("}");
            }
        }
    }

    @Test
    void givenACredentialMessage_whenRendered_thenItNamesTheClubAndCarriesTheCredential() {
        // when / then
        assertThat(templates.render("credentials.newAccount.body", Locale.GERMAN, VALUES))
                .contains("Example Tennis Club").contains("doe.jane").contains("a-credential");
        assertThat(templates.render("credentials.newAccount.subject", Locale.ENGLISH, VALUES))
                .contains("Example Tennis Club");
    }

    @Test
    void givenAValueThatReadsLikeAPlaceholder_whenRendering_thenItIsNotSubstitutedAgain() {
        // given
        Map<String, String> values = Map.of("clubName", "{username}", "firstName", "Jane",
                "username", "doe.jane", "credential", "s3cret", "expiresOn", "12 May 2026");

        // when
        String rendered = templates.render("credentials.newAccount.body", Locale.ENGLISH, values);

        // then — the club name stayed the value it was given rather than becoming a second username
        assertThat(rendered).contains("{username}");
    }

    @Test
    void givenATemplatePlaceholderNothingProvides_whenRendering_thenItFailsRatherThanShipping() {
        // when / then
        assertThatThrownBy(() ->
                templates.render("credentials.newAccount.body", Locale.ENGLISH, Map.of()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("credentials.newAccount.body");
    }
}
