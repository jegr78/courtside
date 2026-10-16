package org.courtside.notification;

import org.courtside.AbstractIntegrationTest;
import org.courtside.notification.internal.MessageTemplateRefusedException;
import org.courtside.notification.internal.MessageTemplateService;
import org.courtside.notification.internal.MessageText;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MessageTemplateServiceTest extends AbstractIntegrationTest {

    @Autowired
    private MessageTemplateService templates;

    @Autowired
    private JdbcClient jdbc;

    @BeforeEach
    void startWithTheShippedWording() {
        jdbc.sql("DELETE FROM message_template_override").update();
        jdbc.sql("DELETE FROM domain_event WHERE event_type LIKE 'notification.template.%'").update();
    }

    @Test
    void givenAClubsWording_whenTheTemplatesAreListed_thenItStandsBesideTheShippedOne() {
        // given
        MessageText own = new MessageText("{clubName}: booked", "See you on {day}, {firstName}.");
        templates.change(MessageKind.BOOKING_CONFIRMED, "en", own);

        // when
        MessageTemplateService.Template confirmed = templates.templates().stream()
                .filter(template -> template.kind() == MessageKind.BOOKING_CONFIRMED)
                .findFirst().orElseThrow();

        // then
        assertThat(confirmed.languages()).extracting(MessageTemplateService.Wording::language)
                .containsExactly("de", "en");
        assertThat(confirmed.languages().get(1).own()).contains(own);
        assertThat(confirmed.languages().get(0).own()).as("German keeps the shipped wording").isEmpty();
        assertThat(confirmed.languages().get(1).shipped().body()).contains("{day}");
        assertThat(audited("notification.template.changed")).isEqualTo(1);
    }

    @Test
    void givenAFirstPasswordWithoutThePassword_whenSaved_thenItIsRefusedAndNothingIsStored() {
        // when / then
        assertThatThrownBy(() -> templates.change(MessageKind.CREDENTIALS_NEW_ACCOUNT, "de",
                new MessageText("{clubName}", "Hallo {firstName}, Benutzername {username}.")))
                .isInstanceOfSatisfying(MessageTemplateRefusedException.class, refused ->
                        assertThat(refused.violationCodes()).containsExactly("messageTemplate.placeholder.missing"));
        assertThat(jdbc.sql("SELECT count(*) FROM message_template_override").query(Integer.class).single())
                .isZero();
    }

    @Test
    void givenAClubsWording_whenReset_thenTheShippedWordingIsBackAndTheResetIsRecorded() {
        // given
        templates.change(MessageKind.BOOKING_REMINDER, "de", new MessageText("Erinnerung", "Bis {day}."));

        // when
        templates.reset(MessageKind.BOOKING_REMINDER, "de");
        templates.reset(MessageKind.BOOKING_REMINDER, "de");

        // then
        assertThat(templates.templates().stream()
                .filter(template -> template.kind() == MessageKind.BOOKING_REMINDER)
                .flatMap(template -> template.languages().stream())
                .filter(wording -> wording.own().isPresent())
                .toList()).isEmpty();
        assertThat(audited("notification.template.reset")).as("a reset of nothing records nothing").isEqualTo(1);
    }

    @Test
    void givenAWording_whenPreviewed_thenItReadsWithExampleValuesAndIsNotStored() {
        // when
        MessageText preview = templates.preview(MessageKind.BOOKING_CONFIRMED, "en",
                new MessageText("{clubName}: {day}", "Hello {firstName}, court {courts} from {from}.\n{instanceLink}"));

        // then
        assertThat(preview.subject()).doesNotContain("{").contains("Saturday");
        assertThat(preview.body()).isEqualTo("Hello Jane, court 1 from 18:00.\nhttps://courts.example.org/my-bookings");
        assertThat(jdbc.sql("SELECT count(*) FROM message_template_override").query(Integer.class).single())
                .isZero();
    }

    @Test
    void givenAnUnsupportedLanguage_whenSaved_thenItIsRefusedWithAReason() {
        // when / then
        assertThatThrownBy(() -> templates.change(MessageKind.BOOKING_CONFIRMED, "fr",
                new MessageText("Réservé", "Le {day}.")))
                .isInstanceOfSatisfying(MessageTemplateRefusedException.class, refused ->
                        assertThat(refused.violationCodes()).isEqualTo(List.of("messageTemplate.language.unknown")));
    }

    private int audited(String type) {
        return jdbc.sql("SELECT count(*) FROM domain_event WHERE event_type = :type")
                .param("type", type).query(Integer.class).single();
    }
}
