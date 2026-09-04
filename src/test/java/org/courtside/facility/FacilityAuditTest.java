package org.courtside.facility;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.audit.testfixture.AuditTestFixture.RecordedEvent;
import org.courtside.facility.internal.WeeklyOpeningHours;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.Arrays;
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
        assertThat(audit.latestPayload(court.getId(), FacilityEvent.CourtAdded.TYPE))
                .containsEntry("number", 7)
                .doesNotContainKey("name");
        audit.assertEventCounts(court.getId(), FacilityEvent.class,
                Map.of(FacilityEvent.CourtAdded.TYPE, 1L));
    }

    @Test
    void givenACourt_whenOnlyItsNameChanges_thenTheLogNamesTheFieldWithoutItsValue() {
        // given
        Court court = facility.createCourt(7, "Centre Court");

        // when
        facility.changeCourt(court.getId(), 7, "Show Court");

        // then
        Map<String, Object> payload = audit.latestPayload(court.getId(), FacilityEvent.CourtChanged.TYPE);
        assertThat(payload)
                .containsEntry("number", 7)
                .containsEntry("changedFields", List.of("name"));
        assertThat(payload.toString()).doesNotContain("Show Court");
        audit.assertEventCounts(court.getId(), FacilityEvent.class,
                Map.of(FacilityEvent.CourtAdded.TYPE, 1L, FacilityEvent.CourtChanged.TYPE, 1L));
    }

    @Test
    void givenAnActiveCourt_whenItIsActivatedAgain_thenNothingIsRecorded() {
        // given
        Court court = facility.createCourt(7, "Centre Court");

        // when
        facility.setCourtActive(court.getId(), true);

        // then
        assertThat(audit.eventsAbout(court.getId(), FacilityEvent.CourtAvailabilityChanged.TYPE)).isEmpty();
    }

    @Test
    void givenACourt_whenChangedWithTheStoredNumberAndName_thenNothingIsRecorded() {
        // given
        Court court = facility.createCourt(7, "Centre Court");

        // when
        facility.changeCourt(court.getId(), 7, "Centre Court");

        // then
        assertThat(audit.eventsAbout(court.getId(), FacilityEvent.CourtChanged.TYPE)).isEmpty();
    }

    @Test
    void givenAnUnnamedCourt_whenChangedToABlankName_thenNothingIsRecorded() {
        // given
        Court court = facility.createCourt(7, null);

        // when
        facility.changeCourt(court.getId(), 7, "\u2003".repeat(61));

        // then
        assertThat(audit.eventsAbout(court.getId(), FacilityEvent.CourtChanged.TYPE)).isEmpty();
    }

    @Test
    void givenAnActiveCourt_whenItIsDeactivated_thenTheLogCarriesTheFlag() {
        // given
        Court court = facility.createCourt(7, "Centre Court");

        // when
        facility.setCourtActive(court.getId(), false);

        // then
        assertThat(audit.latestPayload(court.getId(), FacilityEvent.CourtAvailabilityChanged.TYPE))
                .containsEntry("active", false);
        audit.assertEventCounts(court.getId(), FacilityEvent.class, Map.of(FacilityEvent.CourtAdded.TYPE, 1L,
                FacilityEvent.CourtAvailabilityChanged.TYPE, 1L));
    }

    @Test
    void givenOpeningHours_whenAWindowIsSet_thenTheLogCarriesTheWindow() {
        // when
        OpeningHours hours = facility.setOpeningHours(DayOfWeek.SATURDAY,
                new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));

        // then
        assertThat(audit.latestPayload(hours.getId(), FacilityEvent.OpeningHoursSet.TYPE))
                .containsEntry("openingHoursId", hours.getId().toString())
                .containsEntry("dayOfWeek", DayOfWeek.SATURDAY.getValue())
                .containsEntry("opensAt", "08:00:00")
                .containsEntry("closesAt", "22:00:00");
        audit.assertEventCounts(hours.getId(), FacilityEvent.class,
                Map.of(FacilityEvent.OpeningHoursSet.TYPE, 1L));
    }

    @Test
    void givenOpeningHours_whenSetAgainWithTheStoredWindow_thenNothingIsRecorded() {
        // given
        facility.setOpeningHours(DayOfWeek.SATURDAY, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));

        // when
        facility.setOpeningHours(DayOfWeek.SATURDAY, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));

        // then
        assertThat(audit.eventsOfType(FacilityEvent.OpeningHoursSet.TYPE)).hasSize(1);
    }

    @Test
    void givenOpeningHours_whenTheDayIsClosed_thenTheLogCarriesTheDay() {
        // given
        OpeningHours hours = facility.setOpeningHours(DayOfWeek.SATURDAY,
                new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));

        // when
        facility.closeOn(DayOfWeek.SATURDAY);

        // then
        List<RecordedEvent> closed = audit.eventsOfType(FacilityEvent.OpeningHoursClosed.TYPE);
        assertThat(closed).hasSize(1);
        assertThat(closed.getFirst().payload()).containsEntry("dayOfWeek", DayOfWeek.SATURDAY.getValue());
        audit.assertEventCounts(hours.getId(), FacilityEvent.class,
                Map.of(FacilityEvent.OpeningHoursSet.TYPE, 1L,
                FacilityEvent.OpeningHoursClosed.TYPE, 1L));
    }

    @Test
    void givenAStoredWeek_whenTheSameWeekIsSavedAgain_thenNothingIsRecorded() {
        // given
        List<WeeklyOpeningHours> week = week(DayOfWeek.SATURDAY, LocalTime.of(8, 0), LocalTime.of(22, 0));
        facility.setWeeklyOpeningHours(week);

        // when
        facility.setWeeklyOpeningHours(week);

        // then
        assertThat(audit.eventsOfType(FacilityEvent.OpeningHoursSet.TYPE)).hasSize(1);
        assertThat(audit.eventsOfType(FacilityEvent.OpeningHoursClosed.TYPE)).isEmpty();
    }

    @Test
    void givenAStoredWeek_whenOnlyOneDayChanges_thenTheLogNamesThatDayAlone() {
        // given
        facility.setWeeklyOpeningHours(week(DayOfWeek.SATURDAY, LocalTime.of(8, 0), LocalTime.of(22, 0)));

        // when
        facility.setWeeklyOpeningHours(week(DayOfWeek.SATURDAY, LocalTime.of(9, 0), LocalTime.of(21, 0)));

        // then
        List<RecordedEvent> set = audit.eventsOfType(FacilityEvent.OpeningHoursSet.TYPE);
        assertThat(set).hasSize(2);
        assertThat(set).extracting(recorded -> recorded.payload().get("opensAt"))
                .containsExactlyInAnyOrder("08:00:00", "09:00:00");
        assertThat(set).allSatisfy(recorded -> assertThat(recorded.payload())
                .containsEntry("dayOfWeek", DayOfWeek.SATURDAY.getValue()));
    }

    @Test
    void givenAStoredWeek_whenTheWeekSendsADayWithoutAWindow_thenThatDayIsLoggedAsClosed() {
        // given
        facility.setWeeklyOpeningHours(week(DayOfWeek.SATURDAY, LocalTime.of(8, 0), LocalTime.of(22, 0)));

        // when
        facility.setWeeklyOpeningHours(week(null, null, null));

        // then
        List<RecordedEvent> closed = audit.eventsOfType(FacilityEvent.OpeningHoursClosed.TYPE);
        assertThat(closed).hasSize(1);
        assertThat(closed.getFirst().payload())
                .containsEntry("dayOfWeek", DayOfWeek.SATURDAY.getValue());
    }

    private static List<WeeklyOpeningHours> week(DayOfWeek open, LocalTime opensAt, LocalTime closesAt) {
        return Arrays.stream(DayOfWeek.values())
                .map(day -> day == open
                        ? new WeeklyOpeningHours(day, opensAt, closesAt)
                        : new WeeklyOpeningHours(day, null, null))
                .toList();
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

}
