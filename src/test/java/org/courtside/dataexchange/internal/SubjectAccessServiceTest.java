package org.courtside.dataexchange.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.dataexchange.SubjectAccessPersonNotFoundException;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.notification.MessageKind;
import org.courtside.booking.PersonBookingHistory;
import org.courtside.notification.PersonMessageHistory;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.courtside.shared.CancellationReason;
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

    @Autowired
    private org.springframework.jdbc.core.simple.JdbcClient jdbc;

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
    void givenAWaitlistEntryAndOneNamingThePerson_whenTheAnswerIsProduced_thenBothAreInItWithoutTheOtherMember() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "jane.doe", Set.of(Role.MEMBER));
        UUID holderPerson = roster.addPerson("Mary", "Major", "mary.major@example.org");
        UUID holderAccount = identity.createEnabledAccount(holderPerson, "major.mary", Set.of(Role.MEMBER));
        UUID otherPerson = roster.addPerson("John", "Roe", "john.roe@example.org");
        UUID otherAccount = identity.createEnabledAccount(otherPerson, "roe.john", Set.of(Role.MEMBER));
        TimeSlot slot = new TimeSlot(SIX_PM, SEVEN_PM);
        bookings.createBookingNamingMember(courtId, MEMBER_BOOKING_CARD, slot, holderAccount, holderPerson,
                Set.of(Role.MEMBER), null, otherPerson);
        UUID own = bookings.joinWaitlist(courtId, MEMBER_BOOKING_CARD, slot, accountId, personId, holderPerson);
        UUID naming = bookings.joinWaitlist(courtId, MEMBER_BOOKING_CARD, slot, otherAccount, otherPerson, personId);

        // when
        SubjectAccessRecord answer = subjectAccess.answerFor(personId);

        // then
        assertThat(answer.waitlistEntries()).singleElement()
                .satisfies(entry -> assertThat(entry.entryId()).isEqualTo(own))
                .satisfies(entry -> assertThat(entry.state()).isEqualTo("WAITING"));
        assertThat(answer.waitlistsNamedIn()).singleElement()
                .satisfies(entry -> assertThat(entry.entryId()).isEqualTo(naming))
                .satisfies(entry -> assertThat(entry.startsAt()).isEqualTo(SIX_PM));
        assertThat(answer.waitlistsNamedIn().toString()).as("nothing names who made the other entry")
                .doesNotContain(otherAccount.toString()).doesNotContain("Roe");
    }

    @Test
    void givenAWaitlistOfferInTheCentre_whenTheAnswerIsProduced_thenItNamesTheEntryItConcerns() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "jane.doe", Set.of(Role.MEMBER));
        UUID entryId = UUID.randomUUID();
        notifications.notifyWaitlistOffered(accountId, entryId, SIX_PM);

        // when
        SubjectAccessRecord answer = subjectAccess.answerFor(personId);

        // then
        assertThat(answer.notifications()).singleElement()
                .extracting(PersonMessageHistory.Notification::waitlistEntryId)
                .as("everything the entry stored is in the answer").isEqualTo(entryId);
    }

    @Test
    void givenABookingWhosePlaceItsHolderOffered_whenTheAnswerIsProduced_thenItSaysWhenTheyOfferedIt() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "jane.doe", Set.of(Role.MEMBER));
        UUID offered = bookings.createBookingLookingForAPartner(courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), accountId, personId);
        bookings.publishOpenPlace(offered, accountId);
        UUID kept = bookings.createBookingLookingForAPartner(courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(SEVEN_PM, SEVEN_PM.plusSeconds(3600)), accountId, personId);

        // when
        SubjectAccessRecord answer = subjectAccess.answerFor(personId);

        // then
        assertThat(answer.bookingsMade())
                .extracting(PersonBookingHistory.Made::bookingId, PersonBookingHistory.Made::partnerSearchPublishedAt)
                .as("the answer says when the holder offered a place, and nothing for a place they kept")
                .containsExactlyInAnyOrder(tuple(offered, Instant.parse("2026-05-12T10:00:00Z")), tuple(kept, null));
    }

    @Test
    void givenAWaitlistEntryWhoseSlotHasEnded_whenTheAnswerIsProduced_thenItIsStillInIt() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "jane.doe", Set.of(Role.MEMBER));
        UUID holderPerson = roster.addPerson("Mary", "Major", "mary.major@example.org");
        UUID holderAccount = identity.createEnabledAccount(holderPerson, "major.mary", Set.of(Role.MEMBER));
        TimeSlot slot = new TimeSlot(SIX_PM, SEVEN_PM);
        bookings.createBookingNamingMember(courtId, MEMBER_BOOKING_CARD, slot, holderAccount, holderPerson,
                Set.of(Role.MEMBER), null, personId);
        UUID own = bookings.joinWaitlist(courtId, MEMBER_BOOKING_CARD, slot, accountId, personId, holderPerson);
        jdbc.sql("""
                        UPDATE waitlist_entry SET starts_at = starts_at - interval '2 days',
                            ends_at = ends_at - interval '2 days', state = 'ENDED', closed_at = starts_at
                        WHERE id = :id
                        """).param("id", own).update();

        // when
        SubjectAccessRecord answer = subjectAccess.answerFor(personId);

        // then
        assertThat(answer.waitlistEntries()).as("everything stored about the person is in the answer until it is deleted")
                .singleElement().satisfies(entry -> assertThat(entry.state()).isEqualTo("ENDED"));
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
    void givenCentreEntriesAboutCancellations_whenTheAnswerIsProduced_thenEachCarriesTheReasonItStored() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "jane.doe", Set.of(Role.MEMBER));
        UUID bookingId = UUID.randomUUID();
        notifications.notifyCancelled(accountId, bookingId, "WEATHER", SIX_PM);
        notifications.notifyCancelled(accountId, bookingId, "RAIN", SEVEN_PM);

        // when
        SubjectAccessRecord answer = subjectAccess.answerFor(personId);

        // then
        assertThat(answer.notifications())
                .extracting(notification -> notification.kind().name(),
                        PersonMessageHistory.Notification::cancellationReason)
                .as("a code this version does not know answers as none rather than failing the export")
                .containsExactly(tuple("BOOKING_CANCELLED_BY_CLUB", CancellationReason.WEATHER),
                        tuple("BOOKING_CANCELLED_BY_CLUB", null));
    }

    @Test
    void givenAMemberWithACentreEntryAndEmailSwitchedOff_whenTheAnswerIsProduced_thenBothAreInIt() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "jane.doe", Set.of(Role.MEMBER));
        UUID otherPersonId = roster.addPerson("John", "Roe", "john.roe@example.org");
        UUID otherAccountId = identity.createEnabledAccount(otherPersonId, "john.roe", Set.of(Role.MEMBER));
        notifications.notify(accountId, MessageKind.BOOKING_REMINDER, null, SIX_PM);
        notifications.notify(otherAccountId, MessageKind.BOOKING_CONFIRMED, null, SIX_PM);
        notifications.declineEmail(accountId);

        // when
        SubjectAccessRecord answer = subjectAccess.answerFor(personId);

        // then
        assertThat(answer.notifications())
                .extracting(notification -> notification.kind().name(), PersonMessageHistory.Notification::readAt)
                .as("the centre's entries for this person and nobody else's")
                .containsExactly(tuple("BOOKING_REMINDER", null));
        assertThat(answer.declinedChannels())
                .extracting(declined -> declined.channel().name())
                .containsExactly("EMAIL");
    }

    @Test
    void givenCentreEntriesNamingBookings_whenTheAnswerIsProduced_thenEachCarriesWhatItStoredAndNoOtherAccountsEntry() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "jane.doe", Set.of(Role.MEMBER));
        UUID otherPersonId = roster.addPerson("John", "Roe", "john.roe@example.org");
        UUID otherAccountId = identity.createEnabledAccount(otherPersonId, "john.roe", Set.of(Role.MEMBER));
        UUID remindedOf = UUID.randomUUID();
        UUID displaced = UUID.randomUUID();
        notifications.notify(accountId, MessageKind.BOOKING_REMINDER, remindedOf, SIX_PM);
        notifications.notifyDisplaced(accountId, displaced, "DAY_CLOSED", SIX_PM);
        notifications.notifyDisplaced(otherAccountId, UUID.randomUUID(), "COURT_OUT_OF_SERVICE", SIX_PM);

        // when
        SubjectAccessRecord answer = subjectAccess.answerFor(personId);

        // then
        assertThat(answer.notifications())
                .extracting(notification -> notification.kind().name(), PersonMessageHistory.Notification::bookingId,
                        notification -> notification.closure() == null ? null : notification.closure().name())
                .as("every stored parameter of this person's entries, and nothing of anybody else's")
                .containsExactly(tuple("BOOKING_REMINDER", remindedOf, null),
                        tuple("BOOKING_DISPLACED", displaced, "DAY_CLOSED"));
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
    void givenOneAccountSignedInAndOneNever_whenTheAnswerIsProduced_thenEachCarriesItsLastSignIn() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        UUID signedInId = identity.createEnabledAccount(personId, "jane.doe", Set.of(Role.MEMBER));
        UUID neverId = identity.createAccount(personId, "jane.doe.dormant", Set.of(Role.MEMBER));
        identity.recordSignIn(signedInId, SIX_PM);

        // when
        SubjectAccessRecord answer = subjectAccess.answerFor(personId);

        // then
        assertThat(answer.accounts())
                .extracting(SubjectAccessRecord.Account::accountId, SubjectAccessRecord.Account::lastLoginAt)
                .as("the recorded sign-in instant is part of the answer, and an unused account says none")
                .containsExactly(tuple(signedInId, SIX_PM), tuple(neverId, null));
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
        assertThat(answer.notifications()).isEmpty();
        assertThat(answer.declinedChannels()).isEmpty();
        assertThat(answer.bookingSeries()).isEmpty();
    }

    @Test
    void whenAnAnswerIsAskedForWithoutAPerson_thenItIsRefusedAsUnknown() {
        // when / then
        assertThatThrownBy(() -> subjectAccess.answerFor(null))
                .isInstanceOf(SubjectAccessPersonNotFoundException.class);
    }
}
