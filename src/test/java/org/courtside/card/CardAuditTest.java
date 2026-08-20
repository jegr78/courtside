package org.courtside.card;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.audit.testfixture.AuditTestFixture.RecordedEvent;
import org.courtside.identity.Role;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import(AuditTestFixture.class)
class CardAuditTest extends AbstractIntegrationTest {

    @Autowired
    private CardService cards;

    @Autowired
    private AuditTestFixture audit;

    @Test
    void givenABookingCard_whenItIsCreated_thenTheLogCarriesItsRolesAndNotItsLabel() {
        // when
        BookingCard card = cards.createCard("Team", "#112233", Set.of(Role.MEMBER),
                Set.of(Role.ADMIN), new short[]{2, 4}, true, false, false);

        // then
        assertThat(payloadOf(card.getId(), CardEvent.BookingCardAdded.TYPE))
                .containsEntry("guestAllowed", false)
                .containsEntry("countsAgainstLimits", true)
                .doesNotContainKey("label")
                .doesNotContainKey("color");
    }

    @Test
    void givenABookingCard_whenItsLabelAndColourChange_thenBothAreNamedWithoutTheirValues() {
        // given
        BookingCard card = cards.createCard("Team", "#112233", Set.of(Role.MEMBER),
                Set.of(Role.ADMIN), new short[]{2, 4}, true, false, false);

        // when
        cards.changeCard(card.getId(), "Squad", "#445566", Set.of(Role.MEMBER),
                Set.of(Role.ADMIN), new short[]{2, 4}, true, false, false);

        // then
        Map<String, Object> payload = payloadOf(card.getId(), CardEvent.BookingCardChanged.TYPE);
        assertThat(payload).containsEntry("changedFields", List.of("label", "color"));
        assertThat(payload.toString()).doesNotContain("Squad").doesNotContain("#445566");
    }

    @Test
    void givenABookingCard_whenChangedWithIdenticalValues_thenNothingIsRecorded() {
        // given
        BookingCard card = cards.createCard("Team", "#112233", Set.of(Role.MEMBER),
                Set.of(Role.ADMIN), new short[]{2, 4}, true, false, false);

        // when
        cards.changeCard(card.getId(), "Team", "#112233", Set.of(Role.MEMBER),
                Set.of(Role.ADMIN), new short[]{2, 4}, true, false, false);

        // then
        assertThat(eventsOfTypeAbout(card.getId(), CardEvent.BookingCardChanged.TYPE)).isEmpty();
    }

    @Test
    void givenAParticipantCard_whenItsCapacityChanges_thenTheLogCarriesTheNewCapacity() {
        // given
        ParticipantCard card = cards.createParticipantCard("Guests", 2);

        // when
        cards.changeParticipantCard(card.getId(), "Guests", 4);

        // then
        assertThat(payloadOf(card.getId(), CardEvent.ParticipantCardChanged.TYPE))
                .containsEntry("capacity", 4)
                .containsEntry("changedFields", List.of());
    }

    @Test
    void givenAParticipantCard_whenChangedWithIdenticalValues_thenNothingIsRecorded() {
        // given
        ParticipantCard card = cards.createParticipantCard("Guests", 2);

        // when
        cards.changeParticipantCard(card.getId(), "Guests", 2);

        // then
        assertThat(eventsOfTypeAbout(card.getId(), CardEvent.ParticipantCardChanged.TYPE)).isEmpty();
    }

    @Test
    void givenAnInactiveCard_whenItIsDeactivatedAgain_thenNothingIsRecorded() {
        // given
        BookingCard card = cards.createCard("Team", "#112233", Set.of(Role.MEMBER),
                Set.of(Role.ADMIN), new short[]{2, 4}, true, false, false);
        cards.setCardActive(card.getId(), false);

        // when
        cards.setCardActive(card.getId(), false);

        // then
        assertThat(eventsOfTypeAbout(card.getId(), CardEvent.BookingCardAvailabilityChanged.TYPE))
                .hasSize(1);
    }

    @Test
    void givenTwoCardKinds_whenTheLogNamesThem_thenEachResolvesToItsOwnLabel() {
        // given
        BookingCard booking = cards.createCard("Team", "#112233", Set.of(Role.MEMBER),
                Set.of(Role.ADMIN), new short[]{2, 4}, true, false, false);
        ParticipantCard participant = cards.createParticipantCard("Guests", 2);

        // when / then
        assertThat(audit.nameOf(booking.getId())).isEqualTo("Team");
        assertThat(audit.nameOf(participant.getId())).isEqualTo("Guests");
    }

    private Map<String, Object> payloadOf(UUID subjectId, String eventType) {
        return eventsOfTypeAbout(subjectId, eventType).stream()
                .reduce((first, second) -> second)
                .map(RecordedEvent::payload)
                .orElseThrow();
    }

    private List<RecordedEvent> eventsOfTypeAbout(UUID subjectId, String eventType) {
        return audit.eventsAbout(subjectId).stream()
                .filter(event -> event.eventType().equals(eventType))
                .toList();
    }
}
