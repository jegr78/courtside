package org.courtside.notification.internal;

import org.courtside.notification.MessageKind;
import org.junit.jupiter.api.Test;

import java.util.Locale;
import java.util.Map;
import java.util.ResourceBundle;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MailTemplatesTest {

    // Derived, so a message kind added without the templates it names fails here rather than at
    // the moment a member would have been written to.
    private static final Set<String> KEYS = Stream.of(MessageKind.values())
            .flatMap(kind -> Stream.of(kind.templateKey() + ".subject", kind.templateKey() + ".body"))
            .collect(Collectors.toSet());

    // Every value any message names, so a template that reaches for a new one is caught here.
    private static final Map<String, String> VALUES = Map.of("clubName", "Example Tennis Club",
            "firstName", "Jane", "username", "doe.jane",
            "credential", "a-credential", "expiresOn", "1 May 2026",
            "day", "Wednesday, 13 May 2026", "from", "18:00", "to", "19:00",
            "courts", "Court 1", "card", "Member booking");

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
    void givenEveryMessage_whenRenderedInEitherLocale_thenNoPlaceholderSurvives() {
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
    void givenACourtWithoutAName_whenRenderedInEitherLocale_thenItIsNamedByItsNumber() {
        // when / then — the grid says the same thing, and a message must not fall back to English
        assertThat(templates.render("booking.court", Locale.GERMAN, Map.of("number", "3")))
                .isEqualTo("Platz 3");
        assertThat(templates.render("booking.court", Locale.ENGLISH, Map.of("number", "3")))
                .isEqualTo("Court 3");
    }

    @Test
    void givenABookingConfirmation_whenRendered_thenItCarriesThePeriodTheCourtAndTheCard() {
        // when / then
        assertThat(templates.render("booking.confirmed.body", Locale.GERMAN, VALUES))
                .contains("Wednesday, 13 May 2026").contains("18:00").contains("19:00")
                .contains("Court 1").contains("Member booking");
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
