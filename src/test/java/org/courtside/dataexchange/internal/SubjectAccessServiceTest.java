package org.courtside.dataexchange.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.dataexchange.SubjectAccessPersonNotFoundException;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.notification.MessageKind;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

@Import({IdentityTestFixture.class, MemberTestFixture.class, FacilityTestFixture.class,
        BookingTestFixture.class, NotificationTestFixture.class})
class SubjectAccessServiceTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");

    @Autowired
    private SubjectAccessService subjectAccess;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture roster;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private NotificationTestFixture notifications;

    private UUID courtId;

    @BeforeEach
    void setUp() {
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @Test
    void givenAMemberBookedForThemselves_whenTheAnswerIsProduced_thenTheBookingIsAnsweredOnlyOnce() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "jane.doe", Set.of(Role.MEMBER));
        UUID namedId = roster.addPerson("John", "Roe", "john.roe@example.org");
        UUID bookingId = bookings.createBookingNamingMember(courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), accountId, personId, Set.of(Role.MEMBER), "Doubles",
                namedId);

        // when
        SubjectAccessRecord answer = subjectAccess.answerFor(personId);

        // then
        assertThat(answer.bookingsMade()).singleElement()
                .satisfies(booking -> assertThat(booking.bookingId()).isEqualTo(bookingId));
        assertThat(answer.bookingsRecordedIn())
                .as("whoever makes a booking is its first participant, and that is not a second"
                        + " booking somebody recorded them in")
                .isEmpty();
    }

    @Test
    void givenMessagesWentToAMemberAndTheyDeclinedAKind_whenTheAnswerIsProduced_thenBothAreInIt() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "jane.doe", Set.of(Role.MEMBER));
        notifications.recordHandedOver(accountId, MessageKind.CREDENTIALS_NEW_ACCOUNT,
                "<first@example.org>", SIX_PM);
        notifications.recordRefused(accountId, MessageKind.CREDENTIALS_PASSWORD_RESET,
                "<second@example.org>", SEVEN_PM, "SMTPAddressFailedException", "550");
        notifications.decline(accountId, MessageKind.BOOKING_REMINDER);

        // when
        SubjectAccessRecord answer = subjectAccess.answerFor(personId);

        // then
        assertThat(answer.messages())
                .extracting(message -> message.kind().name(), message -> message.state().name())
                .containsExactly(
                        tuple("CREDENTIALS_NEW_ACCOUNT", "HANDED_OVER"),
                        tuple("CREDENTIALS_PASSWORD_RESET", "REFUSED"));
        assertThat(answer.messages().getLast().statusCode()).isEqualTo("550");
        assertThat(answer.declinedMessages())
                .extracting(declined -> declined.kind().name())
                .containsExactly("BOOKING_REMINDER");
    }

    @Test
    void givenAMemberSetUpARecurringBooking_whenTheAnswerIsProduced_thenTheSeriesIsInItToo() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "jane.doe", Set.of(Role.MEMBER));
        UUID seriesId = bookings.recordSeries(courtId, MEMBER_BOOKING_CARD,
                LocalDate.of(2026, 5, 13), LocalTime.of(18, 0), 60, Set.of(DayOfWeek.WEDNESDAY), 6,
                accountId, "Weekly doubles", SIX_PM);

        // when
        SubjectAccessRecord answer = subjectAccess.answerFor(personId);

        // then
        assertThat(answer.bookingSeries()).singleElement().satisfies(series -> {
            assertThat(series.seriesId()).isEqualTo(seriesId);
            assertThat(series.note()).isEqualTo("Weekly doubles");
            assertThat(series.weekdays()).containsExactly(DayOfWeek.WEDNESDAY);
            assertThat(series.occurrenceCount()).isEqualTo(6);
        });
    }

    @Test
    void givenAPersonWithoutAnAccount_whenTheAnswerIsProduced_thenTheMessageSectionsAreEmpty() {
        // given
        UUID personId = roster.addPerson("John", "Roe", "john.roe@example.org");

        // when
        SubjectAccessRecord answer = subjectAccess.answerFor(personId);

        // then
        assertThat(answer.messages()).isEmpty();
        assertThat(answer.declinedMessages()).isEmpty();
        assertThat(answer.bookingSeries()).isEmpty();
    }

    @Test
    void whenAnAnswerIsAskedForWithoutAPerson_thenItIsRefusedAsUnknown() {
        // when / then
        assertThatThrownBy(() -> subjectAccess.answerFor(null))
                .isInstanceOf(SubjectAccessPersonNotFoundException.class);
    }
}
