package org.courtside.demo;

import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.courtside.shared.TimeSlot;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import org.courtside.config.ClubTimeZone;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Component
@Profile("demo")
@Order(100)
class DemoDataSeeder implements ApplicationRunner {

    private static final UUID ACTIVE_MEMBERSHIP_TYPE =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final String MARKER_USERNAME = "jane.doe";

    private final PersonRepository persons;
    private final UserAccountRepository accounts;
    private final MemberRepository members;
    private final FacilityService facility;
    private final BookingService bookingService;
    private final BookingRepository bookings;
    private final PasswordEncoder passwordEncoder;
    private final Clock clock;
    private final DemoProperties properties;
    private final String adminUsername;
    private final String adminPassword;
    private final ClubTimeZone timeZone;

    DemoDataSeeder(PersonRepository persons, UserAccountRepository accounts, MemberRepository members,
                   FacilityService facility, BookingService bookingService, BookingRepository bookings,
                   PasswordEncoder passwordEncoder, Clock clock, DemoProperties properties,
                   @Value("${courtside.bootstrap-admin.username}") String adminUsername,
                   @Value("${courtside.bootstrap-admin.password}") String adminPassword,
                   ClubTimeZone timeZone) {
        this.persons = persons;
        this.accounts = accounts;
        this.members = members;
        this.facility = facility;
        this.bookingService = bookingService;
        this.bookings = bookings;
        this.passwordEncoder = passwordEncoder;
        this.clock = clock;
        this.properties = properties;
        this.adminUsername = adminUsername;
        this.adminPassword = adminPassword;
        this.timeZone = timeZone;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments arguments) {
        if (accounts.existsByUsername(MARKER_USERNAME)) {
            requireCompleteSeed();
            return;
        }
        UserAccount admin = requireFreshAccountState();
        makeLocalAdminReady(admin);

        DemoMember jane = createMember("Jane", "Doe", "jane.doe@example.org", MARKER_USERNAME);
        DemoMember john = createMember("John", "Roe", "john.roe@example.org", "john.roe");
        List<Court> courts = prepareCourts();
        createBookings(jane, john, courts);
    }

    private void requireCompleteSeed() {
        if (accounts.findByUsername("john.roe").isEmpty() || members.count() < 2 || bookings.count() < 2) {
            throw new IllegalStateException("The demo dataset is incomplete; run dev-reset to recreate it");
        }
    }

    private UserAccount requireFreshAccountState() {
        List<UserAccount> existing = accounts.findAll();
        if (existing.size() != 1 || !isBootstrapAdmin(existing.getFirst())
                || members.count() != 0 || bookings.count() != 0) {
            throw new IllegalStateException(
                    "Demo data requires a fresh database containing only the bootstrap administrator");
        }
        return existing.getFirst();
    }

    private boolean isBootstrapAdmin(UserAccount account) {
        return account.getUsername().equals(adminUsername)
                && account.getRoles().equals(Set.of(Role.ADMIN))
                && account.isPasswordChangeRequired()
                && account.getPerson().getEmail().equals("admin@localhost.invalid");
    }

    private void makeLocalAdminReady(UserAccount admin) {
        accounts.changeInitialPassword(admin.getId(), passwordEncoder.encode(adminPassword));
    }

    private DemoMember createMember(String firstName, String lastName, String email, String username) {
        Person person = persons.save(new Person(firstName, lastName, email));
        UserAccount account = new UserAccount(person, username,
                passwordEncoder.encode(properties.memberPassword()),
                Set.of(Role.MEMBER));
        account.enable();
        accounts.save(account);
        members.save(new Member(person.getId(), ACTIVE_MEMBERSHIP_TYPE,
                LocalDate.now(clock.withZone(timeZone.zoneId()))));
        return new DemoMember(person, account);
    }

    private List<Court> prepareCourts() {
        List<Court> existing = facility.allCourts();
        if (existing.size() != 1 || existing.getFirst().getNumber() != 1) {
            throw new IllegalStateException("Demo data requires the baseline court configuration");
        }
        Court first = facility.changeCourt(existing.getFirst().getId(), 1, "Centre Court");
        Court second = facility.createCourt(2, "Garden Court");
        return List.of(first, second);
    }

    private void createBookings(DemoMember jane, DemoMember john, List<Court> courts) {
        ZoneId zone = timeZone.zoneId();
        LocalDate today = LocalDate.now(clock.withZone(zone));
        LocalDate monday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        TimeSlot currentWeek = slot(monday.plusDays(1), LocalTime.of(18, 0), zone);
        TimeSlot nextWeek = slot(monday.plusWeeks(1), LocalTime.of(18, 0), zone);

        createBooking(jane, john, courts.getFirst(), currentWeek);
        createBooking(john, jane, courts.get(1), nextWeek);
    }

    private void createBooking(DemoMember booker, DemoMember partner, Court court, TimeSlot slot) {
        if (slot.start().isBefore(clock.instant())) {
            createHistoricalBooking(booker, partner, court, slot);
            return;
        }
        bookingService.create(new CreateBookingCommand(
                List.of(court.getId()), MEMBER_BOOKING_CARD, slot, booker.account().getId(),
                booker.person().getId(), Set.of(Role.ADMIN, Role.MEMBER), "Demo booking",
                List.of(ParticipantSpec.member(partner.person().getId())), null));
    }

    private void createHistoricalBooking(DemoMember booker, DemoMember partner,
                                         Court court, TimeSlot slot) {
        Booking booking = new Booking(MEMBER_BOOKING_CARD, booker.account().getId(),
                "Demo booking", clock.instant());
        booking.allocate(court.getId(), slot);
        booking.addParticipant(ParticipantSpec.member(booker.person().getId()));
        booking.addParticipant(ParticipantSpec.member(partner.person().getId()));
        bookings.save(booking);
    }

    private static TimeSlot slot(LocalDate date, LocalTime time, ZoneId zone) {
        Instant start = ZonedDateTime.of(date, time, zone).toInstant();
        return new TimeSlot(start, start.plusSeconds(3600));
    }

    private record DemoMember(Person person, UserAccount account) {
    }
}
