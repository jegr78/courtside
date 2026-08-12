package org.courtside.performance;

import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.HistoricalBookingImporter;
import org.courtside.booking.ParticipantSpec;
import org.courtside.facility.Court;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.FacilityService;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.courtside.shared.TimeSlot;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Component
@Profile("perf")
@Order(100)
@RequiredArgsConstructor
class PerformanceDataSeeder implements ApplicationRunner {

    static final int MEMBER_COUNT = 1_000;
    static final int COURT_COUNT = 8;
    static final int BOOKING_COUNT = 224;
    static final String MARKER_USERNAME = "member0001";
    static final String CONTENTION_USERNAME = "member1000";
    private static final UUID ACTIVE_MEMBERSHIP_TYPE =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    private final PersonRepository persons;
    private final UserAccountRepository accounts;
    private final MemberRepository members;
    private final FacilityService facility;
    private final BookingService bookingService;
    private final HistoricalBookingImporter historicalBookings;
    private final BookingRepository bookings;
    private final PasswordEncoder passwordEncoder;
    private final PerformanceProperties properties;
    private final Clock clock;
    private final ClubTimeZone timeZone;

    @Override
    @Transactional
    public void run(ApplicationArguments arguments) {
        if (accounts.existsByUsername(MARKER_USERNAME)) {
            requireCompleteSeed();
            return;
        }
        requireFreshDatabase();
        List<PerformanceMember> seededMembers = createMembers();
        List<Court> courts = prepareCourts();
        createBookings(seededMembers, courts);
    }

    private void requireFreshDatabase() {
        if (accounts.count() != 1 || members.count() != 0 || bookings.count() != 0) {
            throw new IllegalStateException(
                    "Performance data requires a fresh database containing only the bootstrap administrator");
        }
        if (properties.sharedPassword() == null || properties.sharedPassword().length() < 12) {
            throw new IllegalStateException("COURTSIDE_PERF_SHARED_PASSWORD must contain at least 12 characters");
        }
    }

    private void requireCompleteSeed() {
        if (accounts.count() != MEMBER_COUNT + 1L || members.count() != MEMBER_COUNT
                || facility.allCourts().size() != COURT_COUNT || bookings.count() < BOOKING_COUNT
                || accounts.findByUsername(CONTENTION_USERNAME).isEmpty()) {
            throw new IllegalStateException("The performance dataset is incomplete; run perf-reset to recreate it");
        }
    }

    private List<PerformanceMember> createMembers() {
        String passwordHash = passwordEncoder.encode(properties.sharedPassword());
        List<PerformanceMember> result = new ArrayList<>(MEMBER_COUNT);
        for (int index = 1; index <= MEMBER_COUNT; index++) {
            String number = "%04d".formatted(index);
            Person person = persons.save(new Person("Member", number, "member" + number + "@example.org"));
            UserAccount account = new UserAccount(person, "member" + number, passwordHash, Set.of(Role.MEMBER));
            account.enable();
            accounts.save(account);
            members.save(new Member(person.getId(), ACTIVE_MEMBERSHIP_TYPE));
            result.add(new PerformanceMember(person, account));
        }
        return result;
    }

    private List<Court> prepareCourts() {
        List<Court> existing = facility.allCourts();
        if (existing.size() != 1 || existing.getFirst().getNumber() != 1) {
            throw new IllegalStateException("Performance data requires the baseline court configuration");
        }
        List<Court> courts = new ArrayList<>(COURT_COUNT);
        courts.add(facility.changeCourt(existing.getFirst().getId(), 1, "Court 1"));
        for (int number = 2; number <= COURT_COUNT; number++) {
            courts.add(facility.createCourt(number, "Court " + number));
        }
        return courts;
    }

    private void createBookings(List<PerformanceMember> seededMembers, List<Court> courts) {
        ZoneId zone = timeZone.zoneId();
        LocalDate today = LocalDate.now(clock.withZone(zone));
        int memberIndex = 0;
        for (int dayOffset = -7; dayOffset < 7; dayOffset++) {
            LocalDate date = today.plusDays(dayOffset);
            for (Court court : courts) {
                memberIndex = createBooking(seededMembers, court, date, LocalTime.of(10, 0), zone, memberIndex);
                memberIndex = createBooking(seededMembers, court, date, LocalTime.of(18, 0), zone, memberIndex);
            }
        }
    }

    private int createBooking(List<PerformanceMember> seededMembers, Court court, LocalDate date,
                              LocalTime time, ZoneId zone, int memberIndex) {
        PerformanceMember booker = seededMembers.get(memberIndex % (MEMBER_COUNT - 1));
        PerformanceMember partner = seededMembers.get((memberIndex + 1) % (MEMBER_COUNT - 1));
        Instant start = ZonedDateTime.of(date, time, zone).toInstant();
        CreateBookingCommand command = new CreateBookingCommand(
                List.of(court.getId()), MEMBER_BOOKING_CARD, new TimeSlot(start, start.plusSeconds(3600)),
                booker.account().getId(), booker.person().getId(), Set.of(Role.ADMIN, Role.MEMBER),
                "Performance booking", List.of(ParticipantSpec.member(partner.person().getId())), null);
        if (command.slot().end().isBefore(clock.instant())) {
            historicalBookings.importBooking(command);
            return memberIndex + 2;
        }
        try {
            bookingService.create(command);
        } catch (BookingRulesViolatedException failure) {
            throw new IllegalStateException("Performance booking fixture was rejected at " + start
                    + ": " + failure.getViolations(), failure);
        }
        return memberIndex + 2;
    }

    private record PerformanceMember(Person person, UserAccount account) {
    }
}
