package org.courtside.notification.internal;

import org.courtside.notification.MessageKind;
import org.courtside.shared.CancellationReason;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;

import static java.util.Map.entry;
import java.util.ResourceBundle;
import java.util.Set;
import java.util.regex.Pattern;
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
    private static final Map<String, String> VALUES = Map.ofEntries(
            entry("clubName", "Example Tennis Club"), entry("firstName", "Jane"),
            entry("username", "doe.jane"), entry("credential", "a-credential"),
            entry("resetCode", "ABCD-EFGH"), entry("expiresAt", "13 May 2026, 11:00"),
            entry("expiresOn", "1 May 2026"), entry("day", "Wednesday, 13 May 2026"),
            entry("from", "18:00"), entry("to", "19:00"), entry("courts", "Court 1"),
            entry("card", "Member booking"), entry("player", "John Roe"),
            entry("closure", "A court your booking is on has been taken out of service"),
            entry("weekdays", "Tuesday"), entry("first", "Tuesday, 19 May 2026"),
            entry("last", "Tuesday, 2 June 2026"), entry("count", "3"),
            entry("reason", "Reason: the weather."), entry("previousFrom", "17:00"), entry("previousTo", "19:00"),
            entry("previousCourts", "Court 2"), entry("until", "18:15"), entry("untilDay", "Wednesday, 13 May 2026"),
            entry("instanceLink", "https://courts.example.org/my-bookings"));

    private static final String ADDRESS_LIKE = "(?i)[a-z][a-z0-9+.-]*://|\\b[\\p{L}0-9-]+\\.\\p{L}{2,}\\b";

    private final MailTemplates templates = new MailTemplates();

    @Test
    void whenReadingBothLocales_thenEachDefinesTheSameKeys() {
        // when
        Set<String> german = shipped(Locale.GERMAN).keySet();
        Set<String> english = shipped(Locale.ENGLISH).keySet();

        // then
        assertThat(german).isEqualTo(english).containsAll(KEYS);
    }

    @Test
    void givenEveryCancellationReason_whenRenderedInEitherLocale_thenEachHasItsOwnSentence() {
        // when / then
        for (Locale locale : new Locale[] {Locale.GERMAN, Locale.ENGLISH}) {
            Set<String> sentences = Stream.concat(Stream.of(CancellationReason.values()).map(Enum::name),
                            Stream.of("none"))
                    .map(code -> templates.render("booking.cancellationReason." + code, locale, Map.of()))
                    .collect(Collectors.toSet());
            assertThat(sentences).as("one distinct sentence per code and one for none in %s", locale)
                    .hasSize(CancellationReason.values().length + 1)
                    .allSatisfy(sentence -> assertThat(sentence).isNotBlank().doesNotContain("{"));
        }
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
    void givenTheNoticeAboutBeingRecorded_whenRendered_thenItNamesNobodyButItsReader() {
        // when / then — the participation list resolves no name, and neither may this message
        assertThat(templates.render("booking.playerRecorded.body", Locale.GERMAN, VALUES))
                .contains("Jane").doesNotContain("John Roe");
        assertThat(templates.render("booking.playerWithdrew.body", Locale.ENGLISH, VALUES))
                .contains("John Roe");
    }

    @Test
    void givenEachKindOfClosure_whenRenderedInEitherLocale_thenItSaysWhatWentOutOfService() {
        // when / then: one message, three reasons, and none of them may fall back to English
        assertThat(templates.render("booking.displaced.court", Locale.GERMAN, VALUES))
                .isEqualTo("Ein Platz deiner Buchung wurde deaktiviert");
        assertThat(templates.render("booking.displaced.card", Locale.GERMAN, VALUES))
                .contains("Member booking");
        assertThat(templates.render("booking.displaced.day", Locale.ENGLISH, VALUES))
                .isEqualTo("The club is now closed on that day");
        assertThat(templates.render("booking.displaced.hours", Locale.ENGLISH, VALUES))
                .isEqualTo("The opening hours no longer include your booking");
    }

    @Test
    void givenAReminder_whenRendered_thenItCarriesTheBookingAndTheWayOut() {
        // when / then: the reminder tells the member how to release the court
        assertThat(templates.render("booking.reminder.body", Locale.GERMAN, VALUES))
                .contains("Wednesday, 13 May 2026").contains("Court 1").contains("storniere");
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

    @Test
    void givenNoInstanceAddress_whenABookingMessageIsRendered_thenItReadsExactlyAsWithoutTheLinkLine() {
        // given
        Map<String, String> values = new HashMap<>(VALUES);
        values.put("instanceLink", "");

        // when
        String body = templates.render("booking.confirmed.body", Locale.ENGLISH, values);

        // then
        assertThat(body).isEqualTo("Hello Jane,\n\nYour booking at Example Tennis Club is confirmed.\n\n"
                + "Wednesday, 13 May 2026\n18:00 to 19:00\nCourt: Court 1\nBooking type: Member booking\n\n"
                + "You can cancel the booking in Courtside.\n\nExample Tennis Club");
    }

    @Test
    void givenAnInstanceAddress_whenABookingMessageIsRendered_thenItEndsWithTheLinkOnItsOwnLine() {
        // when / then
        for (Locale locale : new Locale[] {Locale.GERMAN, Locale.ENGLISH}) {
            assertThat(templates.render("booking.reminder.body", locale, VALUES)).as("%s", locale)
                    .endsWith("\nExample Tennis Club\nhttps://courts.example.org/my-bookings");
        }
    }

    @Test
    void givenAnEmptyLinkOnItsOwnLine_whenRendered_thenOnlyThatLineIsDropped() {
        // when
        String rendered = MailTemplates.fill("test", "First\n{instanceLink}\n\nLast\n {instanceLink} ",
                Map.of("instanceLink", ""));

        // then
        assertThat(rendered).isEqualTo("First\n\nLast");
    }

    @Test
    void givenAnEmptyLinkInsideASentence_whenRendered_thenItRendersEmptyAndKeepsTheLine() {
        // when
        String rendered = MailTemplates.fill("test", "Open {instanceLink} to see it.\n{clubName}",
                Map.of("instanceLink", "", "clubName", "Example Tennis Club"));

        // then
        assertThat(rendered).isEqualTo("Open  to see it.\nExample Tennis Club");
    }

    @Test
    void givenAnEmptyValueOtherThanTheLinkOnItsOwnLine_whenRendered_thenTheLineStays() {
        // when
        String rendered = MailTemplates.fill("test", "First\n{clubName}\nLast",
                Map.of("clubName", "", "instanceLink", ""));

        // then
        assertThat(rendered).as("only the link may vanish with its line").isEqualTo("First\n\nLast");
    }

    @Test
    void whenReadingTheShippedBookingMessages_thenEachBodyEndsWithTheLinkOnItsOwnLine() {
        // when / then
        for (Locale locale : new Locale[] {Locale.GERMAN, Locale.ENGLISH}) {
            ResourceBundle bundle = shipped(locale);
            for (MessageKind kind : ShippedMessageKinds.LINKED) {
                assertThat(bundle.getString(kind.templateKey() + ".body")).as("%s in %s", kind, locale)
                        .endsWith("\n{instanceLink}");
                assertThat(bundle.getString(kind.templateKey() + ".subject")).as("%s in %s", kind, locale)
                        .doesNotContain("{instanceLink}");
            }
        }
    }

    @Test
    void whenReadingTheShippedCredentialMessages_thenNoneCarriesALinkOrAnAddress() {
        // given
        Set<MessageKind> credentialKinds = new HashSet<>(ShippedMessageKinds.CREDENTIAL);
        for (MessageKind kind : MessageKind.values()) {
            String body = shipped(Locale.ENGLISH).getString(kind.templateKey() + ".body");
            if (body.contains("{credential}") || body.contains("{resetCode}")) {
                credentialKinds.add(kind);
            }
        }

        // when / then
        for (Locale locale : new Locale[] {Locale.GERMAN, Locale.ENGLISH}) {
            ResourceBundle bundle = shipped(locale);
            for (MessageKind kind : credentialKinds) {
                for (String part : new String[] {".subject", ".body"}) {
                    assertThat(bundle.getString(kind.templateKey() + part))
                            .as("a credential message is what phishing imitates: %s%s in %s", kind, part, locale)
                            .doesNotContain("{instanceLink}")
                            .doesNotContainPattern(ADDRESS_LIKE);
                }
            }
        }
    }

    @Test
    void givenAHostWhoseLanguageIsGerman_whenTheEnglishTemplatesAreRead_thenTheyAreTheEnglishOnes() {
        // given
        Locale host = Locale.getDefault();
        Locale.setDefault(Locale.GERMANY);
        try {
            // when
            String body = templates.render("booking.reminder.body", Locale.ENGLISH, VALUES);

            // then
            assertThat(body).as("an English member must not get the host's German text").startsWith("Hello Jane,");
            assertThat(shipped(Locale.ENGLISH).getString("booking.reminder.body")).startsWith("Hello {firstName},");
        } finally {
            Locale.setDefault(host);
        }
    }

    @Test
    void givenATemplateWithWindowsLineBreaks_whenTheLinkIsEmpty_thenOnlyItsLineIsDropped() {
        // when
        String rendered = MailTemplates.fill("test", "First\r\n{instanceLink}\r\nLast\r\n\t{instanceLink}",
                Map.of("instanceLink", ""));

        // then
        assertThat(rendered).isEqualTo("First\r\nLast");
    }

    @Test
    void whenTheAddressPatternReadsTheShippedBundles_thenOnlyAddressesMatchIt() {
        // given
        Pattern address = Pattern.compile(ADDRESS_LIKE);

        // when / then
        assertThat(address.matcher("Sign in at courts.example.org").find()).isTrue();
        assertThat(address.matcher("Melde dich auf bücher.example.de an").find()).isTrue();
        for (Locale locale : new Locale[] {Locale.GERMAN, Locale.ENGLISH}) {
            ResourceBundle bundle = shipped(locale);
            for (String key : bundle.keySet()) {
                assertThat(address.matcher(bundle.getString(key)).find())
                        .as("%s in %s reads like an address, so the credential guard would raise false alarms", key, locale)
                        .isFalse();
            }
        }
    }

    private static ResourceBundle shipped(Locale locale) {
        return ResourceBundle.getBundle("mail", locale,
                ResourceBundle.Control.getNoFallbackControl(ResourceBundle.Control.FORMAT_PROPERTIES));
    }
}
