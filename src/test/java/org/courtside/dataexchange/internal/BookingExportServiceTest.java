package org.courtside.dataexchange.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.nio.charset.StandardCharsets;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import({IdentityTestFixture.class, MemberTestFixture.class, FacilityTestFixture.class,
        BookingTestFixture.class})
class BookingExportServiceTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");

    @Autowired
    private BookingExportService exports;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private MemberTestFixture roster;

    private UUID courtId;

    @BeforeEach
    void setUp() {
        courtId = facility.createCourt(1, "Centre court");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    private String exported(LocalDate from, LocalDate to) {
        return new String(exports.bookings(from, to, ',', "UTF-8"), StandardCharsets.UTF_8);
    }

    @Test
    void givenAConfirmedBooking_whenThePeriodIsExported_thenItIsARowNamingCourtSlotAndCard() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        bookings.createBookingWithGuest(courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), personId, Set.of(Role.MEMBER), "Guest");

        // when
        String written = exported(LocalDate.of(2026, 5, 13), LocalDate.of(2026, 5, 13));

        // then
        assertThat(written.lines().findFirst())
                .hasValue("﻿date,startsAt,endsAt,courtNumber,courtName,card");
        assertThat(written.lines().skip(1)).hasSize(1);
        assertThat(written).contains("2026-05-13,").contains(",1,Centre court,");
    }

    @Test
    void givenABookingOutsideThePeriod_whenItIsExported_thenTheFileHoldsOnlyTheHeader() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        bookings.createBookingWithGuest(courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), personId, Set.of(Role.MEMBER), "Guest");

        // when
        String written = exported(LocalDate.of(2026, 5, 14), LocalDate.of(2026, 5, 20));

        // then
        assertThat(written.lines().skip(1)).isEmpty();
    }

    @Test
    void givenAPeriodEndingBeforeItStarts_whenItIsExported_thenItIsRefusedWithTheOrderCode() {
        // when / then
        assertThatThrownBy(() -> exported(LocalDate.of(2026, 5, 20), LocalDate.of(2026, 5, 13)))
                .hasFieldOrPropertyWithValue("code", "booking.facilityUtilisation.periodOrder");
    }

    @Test
    void givenAPeriodLongerThanTheReportsAllow_whenItIsExported_thenItIsRefusedWithTheLengthCode() {
        // when / then
        assertThatThrownBy(() -> exported(LocalDate.of(2026, 1, 1), LocalDate.of(2027, 1, 2)))
                .hasFieldOrPropertyWithValue("code", "booking.facilityUtilisation.periodTooLong");
    }
}
