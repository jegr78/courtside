package org.courtside.facility;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.audit.testfixture.AuditTestFixture.RecordedEvent;
import org.courtside.facility.internal.WeeklyOpeningHours;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.LocalDate;
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

    @Autowired
    private JdbcClient jdbc;

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
    void givenAClosure_whenOnlyItsReasonChanges_thenTheLogNamesTheFieldWithoutItsValue() {
        // given
        Court court = facility.createCourt(7, "Centre Court");
        CourtClosure closure = facility.createCourtClosure(court.getId(), "Resurfacing",
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30));

        // when
        facility.changeCourtClosure(closure.id(), court.getId(), "Private lesson",
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30));

        // then
        List<Object> changes = audit.eventsAbout(closure.id(), FacilityEvent.CourtClosureSet.TYPE).stream()
                .map(event -> event.payload().get("changedFields")).toList();
        assertThat(changes).containsExactlyInAnyOrder(List.of("courtId", "name", "startsOn", "endsOn"), List.of("name"));
        assertThat(audit.eventsAbout(closure.id()).toString()).doesNotContain("Private lesson");
    }

    @Test
    void givenASeason_whenItsHoursChange_thenTheLogNamesTheHours() {
        // given
        List<WeeklyOpeningHours> early = Arrays.stream(DayOfWeek.values())
                .map(day -> new WeeklyOpeningHours(day, LocalTime.of(8, 0), LocalTime.of(20, 0))).toList();
        List<WeeklyOpeningHours> late = Arrays.stream(DayOfWeek.values())
                .map(day -> new WeeklyOpeningHours(day, LocalTime.of(10, 0), LocalTime.of(20, 0))).toList();
        OpeningPeriod season = facility.createOpeningPeriod(OpeningPeriod.Kind.SEASON, "Summer",
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 9, 30), early);

        // when
        facility.changeOpeningPeriod(season.id(), OpeningPeriod.Kind.SEASON, "Summer",
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 9, 30), late);

        // then
        assertThat(audit.eventsAbout(season.id(), FacilityEvent.OpeningPeriodSet.TYPE).stream()
                .map(event -> event.payload().get("changedFields")).toList())
                .containsExactlyInAnyOrder(List.of("kind", "name", "startsOn", "endsOn", "days"), List.of("days"));
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
                Map.of(FacilityEvent.OpeningHoursSet.TYPE, 1L));
        audit.assertEventCounts(hours.getVersionId(), FacilityEvent.class,
                Map.of(FacilityEvent.OpeningHoursClosed.TYPE, 1L));
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

    @Test
    void givenAWeekScheduledForNovember_whenItNarrowsADay_thenTheLogNamesTheDaysItGoverns() {
        // given
        facility.scheduleOpeningHours(LocalDate.of(2027, 3, 1),
                week(DayOfWeek.SATURDAY, LocalTime.of(8, 0), LocalTime.of(22, 0)));
        facility.setOpeningHours(DayOfWeek.SATURDAY, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));

        // when
        facility.scheduleOpeningHours(LocalDate.of(2026, 11, 1),
                week(DayOfWeek.SATURDAY, LocalTime.of(10, 0), LocalTime.of(18, 0)));

        // then
        assertThat(setFrom("2026-11-01")).singleElement().satisfies(payload -> assertThat(payload)
                .containsEntry("opensAt", "10:00:00")
                .containsEntry("until", "2027-03-01"));
    }

    @Test
    void givenAScheduledWeek_whenItIsRemoved_thenTheLogCarriesTheRestoredHoursForItsDays() {
        // given
        facility.setOpeningHours(DayOfWeek.SATURDAY, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        facility.scheduleOpeningHours(LocalDate.of(2026, 11, 1),
                week(DayOfWeek.SATURDAY, LocalTime.of(7, 0), LocalTime.of(23, 0)));

        // when
        facility.removeScheduledOpeningHours(LocalDate.of(2026, 11, 1));

        // then
        assertThat(setFrom("2026-11-01")).extracting(payload -> payload.get("opensAt"))
                .as("the scheduled window, then the restored one").containsExactlyInAnyOrder("07:00:00", "08:00:00");
    }

    private List<Map<String, Object>> setFrom(String effectiveFrom) {
        return audit.eventsOfType(FacilityEvent.OpeningHoursSet.TYPE).stream()
                .map(RecordedEvent::payload)
                .filter(payload -> effectiveFrom.equals(payload.get("effectiveFrom")))
                .toList();
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


    @Test
    void givenAnAccessPoint_whenItsCodeChanges_thenTheEventNamesTheFieldAndNoStoredRowCarriesEitherCode() {
        // given
        Court court = facility.createCourt(7, "Centre Court");
        AccessPoint gate = facility.createAccessPoint("North gate", List.of(court.getId()), "135790");

        // when
        facility.changeAccessPoint(gate.getId(), "North gate", List.of(court.getId()), "246802");

        // then
        assertThat(audit.latestPayload(gate.getId(), FacilityEvent.AccessPointChanged.TYPE))
                .containsEntry("changedFields", List.of("staticCode"))
                .containsEntry("courtIds", List.of(court.getId().toString()));
        List<String> stored = jdbc.sql("SELECT payload::text FROM domain_event WHERE subject_id = ?")
                .param(gate.getId()).query(String.class).list();
        assertThat(stored).as("the added, the changed and the code-changed event are all stored").hasSize(3);
        assertThat(String.join("|", stored))
                .as("a static code is a door key and never enters the audit log")
                .doesNotContain("135790").doesNotContain("246802");
    }

    @Test
    void givenAnAccessPoint_whenChangedWithEveryStoredValue_thenNothingIsRecorded() {
        // given
        Court court = facility.createCourt(7, "Centre Court");
        AccessPoint gate = facility.createAccessPoint("North gate", List.of(court.getId()), null);

        // when
        facility.changeAccessPoint(gate.getId(), " North gate ", List.of(court.getId()), null);
        facility.setAccessPointActive(gate.getId(), true);

        // then
        audit.assertEventCounts(gate.getId(), FacilityEvent.class, Map.of(FacilityEvent.AccessPointAdded.TYPE, 1L));
    }

    @Test
    void givenAnAccessPoint_whenItIsRenamedAndDeactivated_thenTheLogNamesTheFieldAndCarriesTheFlag() {
        // given
        AccessPoint gate = facility.createAccessPoint("North gate", List.of(), null);

        // when
        facility.changeAccessPoint(gate.getId(), "South gate", List.of(), null);
        facility.setAccessPointActive(gate.getId(), false);

        // then
        Map<String, Object> changed = audit.latestPayload(gate.getId(), FacilityEvent.AccessPointChanged.TYPE);
        assertThat(changed).containsEntry("changedFields", List.of("name"));
        assertThat(changed.toString()).doesNotContain("South gate");
        assertThat(audit.latestPayload(gate.getId(), FacilityEvent.AccessPointAvailabilityChanged.TYPE))
                .containsEntry("active", false);
    }
}
