package org.courtside.performance;

import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.HistoricalBookingImporter;
import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.MemberRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PerformanceDataSeederTest {

    @Test
    void givenCompletedSeedWithLoadBookings_whenStartingAgain_thenAdditionalBookingsRemainValid() {
        // given
        PersonRepository persons = mock(PersonRepository.class);
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        MemberRepository members = mock(MemberRepository.class);
        FacilityService facility = mock(FacilityService.class);
        BookingRepository bookings = mock(BookingRepository.class);
        when(accounts.existsByUsername(PerformanceDataSeeder.MARKER_USERNAME)).thenReturn(true);
        when(accounts.count()).thenReturn(PerformanceDataSeeder.MEMBER_COUNT + 1L);
        when(members.count()).thenReturn((long) PerformanceDataSeeder.MEMBER_COUNT);
        when(bookings.count()).thenReturn(PerformanceDataSeeder.BOOKING_COUNT + 1L);
        when(facility.allCourts()).thenReturn(java.util.Collections.nCopies(
                PerformanceDataSeeder.COURT_COUNT, mock(Court.class)));
        when(accounts.findByUsername(PerformanceDataSeeder.CONTENTION_USERNAME))
                .thenReturn(Optional.of(mock(org.courtside.identity.UserAccount.class)));
        PerformanceDataSeeder seeder = new PerformanceDataSeeder(
                persons, accounts, members, facility, mock(BookingService.class),
                mock(HistoricalBookingImporter.class), bookings, mock(PasswordEncoder.class),
                new PerformanceProperties(true, "performance-password"), Clock.systemUTC(),
                () -> java.time.ZoneId.of("Europe/Berlin"));

        // when / then
        assertThatCode(() -> seeder.run(new DefaultApplicationArguments(new String[0])))
                .doesNotThrowAnyException();
    }

    @Test
    void givenFreshBaseline_whenSeedingPerformanceData_thenAllBookingsUseDomainService() throws Exception {
        // given
        PersonRepository persons = mock(PersonRepository.class);
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        MemberRepository members = mock(MemberRepository.class);
        FacilityService facility = mock(FacilityService.class);
        BookingService bookingService = mock(BookingService.class);
        HistoricalBookingImporter historicalBookings = mock(HistoricalBookingImporter.class);
        BookingRepository bookings = mock(BookingRepository.class);
        PasswordEncoder passwordEncoder = mock(PasswordEncoder.class);
        Court baseline = court(1);
        when(accounts.existsByUsername(PerformanceDataSeeder.MARKER_USERNAME)).thenReturn(false);
        when(accounts.count()).thenReturn(1L);
        when(members.count()).thenReturn(0L);
        when(bookings.count()).thenReturn(0L);
        when(persons.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(passwordEncoder.encode("performance-password")).thenReturn("password-hash");
        when(facility.allCourts()).thenReturn(List.of(baseline));
        when(facility.changeCourt(baseline.getId(), 1, "Court 1")).thenAnswer(invocation -> court(1));
        for (int number = 2; number <= PerformanceDataSeeder.COURT_COUNT; number++) {
            int courtNumber = number;
            when(facility.createCourt(number, "Court " + number)).thenAnswer(invocation -> court(courtNumber));
        }
        PerformanceDataSeeder seeder = new PerformanceDataSeeder(
                persons, accounts, members, facility, bookingService, historicalBookings, bookings, passwordEncoder,
                new PerformanceProperties(true, "performance-password"),
                Clock.fixed(Instant.parse("2026-08-10T12:00:00Z"), ZoneOffset.UTC),
                () -> java.time.ZoneId.of("Europe/Berlin"));

        // when
        seeder.run(new DefaultApplicationArguments(new String[0]));

        // then
        verify(persons, times(PerformanceDataSeeder.MEMBER_COUNT)).save(any());
        verify(accounts, times(PerformanceDataSeeder.MEMBER_COUNT)).save(any());
        verify(members, times(PerformanceDataSeeder.MEMBER_COUNT)).save(any());
        verify(bookingService, atLeastOnce()).create(any());
        verify(historicalBookings, atLeastOnce()).importBooking(any());
        long domainServiceCalls = mockingDetails(bookingService).getInvocations().size()
                + mockingDetails(historicalBookings).getInvocations().size();
        assertThat(domainServiceCalls).isEqualTo(PerformanceDataSeeder.BOOKING_COUNT);
        verify(bookings, never()).save(any());
    }

    @Test
    void givenASlotAlreadyUnderWay_whenSeedingPerformanceData_thenItIsNeitherBookedNorImported() throws Exception {
        // given
        PersonRepository persons = mock(PersonRepository.class);
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        MemberRepository members = mock(MemberRepository.class);
        FacilityService facility = mock(FacilityService.class);
        BookingService bookingService = mock(BookingService.class);
        HistoricalBookingImporter historicalBookings = mock(HistoricalBookingImporter.class);
        BookingRepository bookings = mock(BookingRepository.class);
        PasswordEncoder passwordEncoder = mock(PasswordEncoder.class);
        Court baseline = court(1);
        when(accounts.existsByUsername(PerformanceDataSeeder.MARKER_USERNAME)).thenReturn(false);
        when(accounts.count()).thenReturn(1L);
        when(members.count()).thenReturn(0L);
        when(bookings.count()).thenReturn(0L);
        when(persons.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(passwordEncoder.encode("performance-password")).thenReturn("password-hash");
        when(facility.allCourts()).thenReturn(List.of(baseline));
        when(facility.changeCourt(baseline.getId(), 1, "Court 1")).thenAnswer(invocation -> court(1));
        for (int number = 2; number <= PerformanceDataSeeder.COURT_COUNT; number++) {
            int courtNumber = number;
            when(facility.createCourt(number, "Court " + number)).thenAnswer(invocation -> court(courtNumber));
        }
        Instant halfwayThroughTheEveningSlot = Instant.parse("2026-08-10T16:30:00Z");
        PerformanceDataSeeder seeder = new PerformanceDataSeeder(
                persons, accounts, members, facility, bookingService, historicalBookings, bookings, passwordEncoder,
                new PerformanceProperties(true, "performance-password"),
                Clock.fixed(halfwayThroughTheEveningSlot, ZoneOffset.UTC),
                () -> java.time.ZoneId.of("Europe/Berlin"));

        // when
        seeder.run(new DefaultApplicationArguments(new String[0]));

        // then
        ArgumentCaptor<CreateBookingCommand> created = ArgumentCaptor.forClass(CreateBookingCommand.class);
        ArgumentCaptor<CreateBookingCommand> imported = ArgumentCaptor.forClass(CreateBookingCommand.class);
        verify(bookingService, atLeastOnce()).create(created.capture());
        verify(historicalBookings, atLeastOnce()).importBooking(imported.capture());
        assertThat(created.getAllValues())
                .as("the booking rules refuse a slot that has already started")
                .allSatisfy(command -> assertThat(command.slot().start())
                        .isAfterOrEqualTo(halfwayThroughTheEveningSlot));
        assertThat(imported.getAllValues())
                .as("a historical booking must have ended")
                .allSatisfy(command -> assertThat(command.slot().end())
                        .isBefore(halfwayThroughTheEveningSlot));
    }

    private Court court(int number) {
        Court court = mock(Court.class);
        when(court.getId()).thenReturn(java.util.UUID.randomUUID());
        when(court.getNumber()).thenReturn(number);
        return court;
    }
}
