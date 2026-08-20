package org.courtside.facility;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.audit.testfixture.AuditTestFixture.RecordedEvent;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import(AuditTestFixture.class)
class FacilityAuditTest extends AbstractIntegrationTest {

    @Autowired
    private FacilityService facility;

    @Autowired
    private AuditTestFixture audit;

    @Test
    void givenACourt_whenItIsCreated_thenTheLogCarriesItsNumberAndNotItsName() {
        // when
        Court court = facility.createCourt(7, "Centre Court");

        // then
        assertThat(payloadOf(court.getId(), FacilityEvent.CourtAdded.TYPE))
                .containsEntry("number", 7)
                .doesNotContainKey("name");
    }

    @Test
    void givenACourt_whenOnlyItsNameChanges_thenTheLogNamesTheFieldWithoutItsValue() {
        // given
        Court court = facility.createCourt(7, "Centre Court");

        // when
        facility.changeCourt(court.getId(), 7, "Show Court");

        // then
        Map<String, Object> payload = payloadOf(court.getId(), FacilityEvent.CourtChanged.TYPE);
        assertThat(payload)
                .containsEntry("number", 7)
                .containsEntry("changedFields", List.of("name"));
        assertThat(payload.toString()).doesNotContain("Show Court");
    }

    @Test
    void givenAnActiveCourt_whenItIsActivatedAgain_thenNothingIsRecorded() {
        // given
        Court court = facility.createCourt(7, "Centre Court");

        // when
        facility.setCourtActive(court.getId(), true);

        // then
        assertThat(eventsOfTypeAbout(court.getId(), FacilityEvent.CourtAvailabilityChanged.TYPE)).isEmpty();
    }

    @Test
    void givenAnActiveCourt_whenItIsDeactivated_thenTheLogCarriesTheFlag() {
        // given
        Court court = facility.createCourt(7, "Centre Court");

        // when
        facility.setCourtActive(court.getId(), false);

        // then
        assertThat(payloadOf(court.getId(), FacilityEvent.CourtAvailabilityChanged.TYPE))
                .containsEntry("active", false);
    }

    @Test
    void givenOpeningHours_whenTheDayIsClosed_thenTheLogCarriesTheDay() {
        // given
        facility.setOpeningHours(DayOfWeek.SATURDAY,
                new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));

        // when
        facility.closeOn(DayOfWeek.SATURDAY);

        // then
        List<RecordedEvent> closed = audit.eventsOfType(FacilityEvent.OpeningHoursClosed.TYPE);
        assertThat(closed).hasSize(1);
        assertThat(closed.getFirst().payload()).containsEntry("dayOfWeek", DayOfWeek.SATURDAY.getValue());
    }

    @Test
    void givenNoOpeningHours_whenTheDayIsClosed_thenNothingIsRecorded() {
        // when
        facility.closeOn(DayOfWeek.SUNDAY);

        // then
        assertThat(audit.eventsOfType(FacilityEvent.OpeningHoursClosed.TYPE)).isEmpty();
    }

    @Test
    void givenACourt_whenItIsCreated_thenTheAuditLogCanNameIt() {
        // given
        Court court = facility.createCourt(7, "Centre Court");

        // then
        assertThat(audit.nameOf(court.getId())).isEqualTo("Centre Court");
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
