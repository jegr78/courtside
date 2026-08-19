package org.courtside.securityassessment;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.ParticipantSpec;
import org.courtside.card.CardService;
import org.courtside.card.ParticipantCard;
import org.courtside.config.ClubTimeZone;
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
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Component
@Profile("security")
@Order(100)
@RequiredArgsConstructor
class SecurityAssessmentDataSeeder implements ApplicationRunner {

    static final String MARKER_USERNAME = "security.member.1";
    static final int ROLE_ACCOUNT_COUNT = Role.values().length * SecurityAssessmentDataset.isolatedAccountsPerRole();
    private static final UUID ACTIVE_MEMBERSHIP_TYPE =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    private final PersonRepository persons;
    private final UserAccountRepository accounts;
    private final MemberRepository members;
    private final FacilityService facility;
    private final CardService cards;
    private final BookingRepository bookings;
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;
    private final SecurityAssessmentProperties properties;
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
        List<SecurityIdentity> identities = createRoleMatrix();
        createRoleCombination(identities);
        List<Court> courts = prepareCourts();
        prepareParticipantCards();
        createBookingsAndSeries(identities, courts);
    }

    private void requireFreshDatabase() {
        if (accounts.count() != 1 || members.count() != 0 || bookings.count() != 0
                || countSeries() != 0) {
            throw new IllegalStateException(
                    "Security data requires a fresh database containing only the bootstrap administrator");
        }
    }

    private void requireCompleteSeed() {
        long seededAccounts = ROLE_ACCOUNT_COUNT + SecurityAssessmentDataset.managerCombinationAccounts();
        if (accounts.count() != seededAccounts + 1 || members.count() != seededAccounts
                || bookings.count() != expectedBookingCount() || countSeries() != 1 || facility.allCourts().size() != 2
                || cards.allParticipantCards().size() != 5) {
            throw new IllegalStateException("The security dataset is incomplete; recreate the environment");
        }
    }

    private void prepareParticipantCards() {
        ParticipantCard inactive = cards.createParticipantCard("Inactive assessment card", 1);
        cards.setParticipantCardActive(inactive.getId(), false);
        cards.createParticipantCard("Limited assessment card", 1);
        cards.createParticipantCard("Unlimited assessment card", null);
    }

    private List<SecurityIdentity> createRoleMatrix() {
        String hash = passwordEncoder.encode(properties.sharedPassword());
        List<SecurityIdentity> result = new ArrayList<>(ROLE_ACCOUNT_COUNT);
        for (Role role : Role.values()) {
            for (int index = 1; index <= SecurityAssessmentDataset.isolatedAccountsPerRole(); index++) {
                String key = "security." + role.name().toLowerCase().replace('_', '.') + "." + index;
                result.add(createIdentity("Security", roleLabel(role) + index, key, hash, Set.of(role), true));
            }
        }
        return result;
    }

    private void createRoleCombination(List<SecurityIdentity> identities) {
        String hash = passwordEncoder.encode(properties.sharedPassword());
        for (int index = 1; index <= SecurityAssessmentDataset.managerCombinationAccounts(); index++) {
            identities.add(createIdentity("Security", "Manager" + index, "security.manager." + index, hash,
                    Set.of(Role.MEMBER, Role.TRAINER, Role.SPORT_DIRECTOR, Role.YOUTH_DIRECTOR), false));
        }
    }

    private SecurityIdentity createIdentity(String firstName, String lastName, String username,
                                            String hash, Set<Role> roles, boolean currentMember) {
        Person person = persons.save(new Person(firstName, lastName, username + "@example.org"));
        UserAccount account = new UserAccount(person, username, hash, roles);
        account.enable();
        accounts.save(account);
        Member member = new Member(person.getId(), ACTIVE_MEMBERSHIP_TYPE,
                LocalDate.now(clock.withZone(timeZone.zoneId())).minusYears(1));
        if (!currentMember) {
            member.endOn(LocalDate.now(clock.withZone(timeZone.zoneId())).minusDays(1));
        }
        members.save(member);
        return new SecurityIdentity(person, account);
    }

    private List<Court> prepareCourts() {
        List<Court> existing = facility.allCourts();
        if (existing.size() != 1 || existing.getFirst().getNumber() != 1) {
            throw new IllegalStateException("Security data requires the baseline court configuration");
        }
        Court first = facility.changeCourt(existing.getFirst().getId(), 1, "Assessment Court 1");
        return List.of(first, facility.createCourt(2, "Assessment Court 2"));
    }

    private void createBookingsAndSeries(List<SecurityIdentity> identities, List<Court> courts) {
        Instant now = clock.instant();
        LocalDate tomorrow = LocalDate.now(clock.withZone(timeZone.zoneId())).plusDays(1);
        for (int index = 0; index < SecurityAssessmentDataset.standaloneBookings(); index++) {
            SecurityIdentity owner = identities.get(index);
            Instant start = ZonedDateTime.of(tomorrow.plusDays(index), LocalTime.of(10, 0),
                    timeZone.zoneId()).toInstant();
            Booking booking = new Booking(MEMBER_BOOKING_CARD, owner.account().getId(),
                    "Security assessment booking " + (index + 1), now);
            booking.allocate(courts.get(index).getId(), new TimeSlot(start, start.plusSeconds(3600)));
            booking.addParticipant(ParticipantSpec.member(owner.person().getId()));
            bookings.save(booking);
        }
        createSeries(identities.getFirst(), courts.getFirst(), tomorrow.plusWeeks(1), now);
    }

    private void createSeries(SecurityIdentity owner, Court court, LocalDate startsOn, Instant now) {
        UUID seriesId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO booking_series (
                    id, card_id, starts_on, start_time, duration_minutes, interval_weeks,
                    weekdays, occurrence_count, note, created_by, created_at
                ) VALUES (?, ?, ?, ?, 60, 1, ARRAY[?]::smallint[], ?, ?, ?, ?)
                """, seriesId, MEMBER_BOOKING_CARD, startsOn, LocalTime.of(12, 0),
                DayOfWeek.from(startsOn).getValue(), SecurityAssessmentDataset.seriesOccurrences(),
                "Security assessment series", owner.account().getId(), Timestamp.from(now));
        jdbc.update("""
                INSERT INTO booking_series_court (booking_series_id, position, court_id)
                VALUES (?, 0, ?)
                """, seriesId, court.getId());
        for (int index = 0; index < SecurityAssessmentDataset.seriesOccurrences(); index++) {
            Instant start = ZonedDateTime.of(startsOn.plusWeeks(index), LocalTime.of(12, 0),
                    timeZone.zoneId()).toInstant();
            Booking booking = new Booking(MEMBER_BOOKING_CARD, owner.account().getId(),
                    "Security assessment series occurrence " + (index + 1), now);
            booking.allocate(court.getId(), new TimeSlot(start, start.plusSeconds(3600)));
            booking.addParticipant(ParticipantSpec.member(owner.person().getId()));
            bookings.saveAndFlush(booking);
            jdbc.update("UPDATE booking SET series_id = ? WHERE id = ?", seriesId, booking.getId());
        }
    }

    private int expectedBookingCount() {
        return SecurityAssessmentDataset.standaloneBookings() + SecurityAssessmentDataset.seriesOccurrences();
    }

    private long countSeries() {
        Long count = jdbc.queryForObject("SELECT count(*) FROM booking_series", Long.class);
        return count == null ? 0 : count;
    }

    private static String roleLabel(Role role) {
        return switch (role) {
            case MEMBER -> "Member";
            case TRAINER -> "Trainer";
            case SPORT_DIRECTOR -> "SportDirector";
            case YOUTH_DIRECTOR -> "YouthDirector";
            case GROUNDSKEEPER -> "Groundskeeper";
            case TREASURER -> "Treasurer";
            case ADMIN -> "Administrator";
        };
    }

    private record SecurityIdentity(Person person, UserAccount account) {
    }
}
