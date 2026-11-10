package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.internal.CardRoleRequiredException;
import org.courtside.booking.internal.ParticipantsInvalidException;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ExternalBookingTest extends AbstractIntegrationTest {

    private static final Instant TOMORROW_AFTERNOON = Instant.parse("2026-05-13T16:00:00Z");

    @Autowired
    private BookingService bookingService;
    @Autowired
    private FacilityTestFixture facility;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private CardTestFixture cards;
    @Autowired
    private ConfigTestFixture config;

    private UUID courtId;
    private UUID externalPerson;
    private UUID externalAccount;

    @BeforeEach
    void setUp() {
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        externalPerson = identity.createPerson("John", "Roe", "john.roe@example.org");
        externalAccount = identity.createEnabledAccount(externalPerson, "roe.john", Set.of(Role.EXTERNAL));
    }

    @Test
    void givenExternalBookingsAdmitted_whenAnExternalAccountBooksACardNamingThem_thenTheBookingIsConfirmed() {
        // given
        config.admitExternalBookings(true);
        UUID winterHall = cards.createBookingCard("Winter hall", Set.of(Role.EXTERNAL, Role.MEMBER), Set.of());

        // when
        UUID booking = book(winterHall);

        // then
        assertThat(booking).isNotNull();
    }

    @Test
    void givenExternalBookingsNotAdmitted_whenAnExternalAccountBooksACardNamingThem_thenTheCardIsRefused() {
        // given
        UUID winterHall = cards.createBookingCard("Winter hall", Set.of(Role.EXTERNAL), Set.of());

        // when / then
        assertThatThrownBy(() -> book(winterHall)).isInstanceOf(CardRoleRequiredException.class);
    }

    @Test
    void givenExternalBookingsAdmitted_whenAnExternalAccountBooksAMembersOnlyCard_thenTheCardIsRefused() {
        // given
        config.admitExternalBookings(true);
        UUID membersOnly = cards.createBookingCard("Members", Set.of(), Set.of());
        UUID namingMembers = cards.createBookingCard("Club evening", Set.of(Role.MEMBER), Set.of());

        // when / then
        assertThatThrownBy(() -> book(membersOnly)).as("an empty role list means members only")
                .isInstanceOf(CardRoleRequiredException.class);
        assertThatThrownBy(() -> book(namingMembers)).isInstanceOf(CardRoleRequiredException.class);
    }

    @Test
    void givenADoublesCardOpenToExternals_whenAnExternalAccountBooksWithAGuest_thenTheBookingIsConfirmed() {
        // given
        config.admitExternalBookings(true);
        UUID doubles = cards.createDoublesCardForGuestsAllowing("Winter doubles", Set.of(Role.EXTERNAL));

        // when
        UUID booking = book(doubles, List.of(ParticipantSpec.guest("Mary Major")));

        // then
        assertThat(booking).isNotNull();
    }

    @Test
    void givenADoublesCardOpenToExternals_whenAnExternalAccountNamesAMember_thenTheParticipantsAreRefused() {
        // given
        config.admitExternalBookings(true);
        UUID doubles = cards.createDoublesCardForGuestsAllowing("Winter doubles", Set.of(Role.EXTERNAL));
        UUID member = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID ballMachine = cards.createUnlimitedParticipantCard("Ball machine");

        // when / then
        assertThatThrownBy(() -> book(doubles, List.of(ParticipantSpec.member(member))))
                .isInstanceOfSatisfying(ParticipantsInvalidException.class, refused -> assertThat(refused.violationCodes())
                        .containsExactly("booking.participants.outsiderGuestsOnly"));
        assertThatThrownBy(() -> book(doubles, List.of(ParticipantSpec.card(ballMachine))))
                .isInstanceOfSatisfying(ParticipantsInvalidException.class, refused -> assertThat(refused.violationCodes())
                        .containsExactly("booking.participants.outsiderGuestsOnly"));
    }

    private UUID book(UUID cardId, List<ParticipantSpec> participants) {
        return bookingService.create(new CreateBookingCommand(List.of(courtId), cardId,
                new TimeSlot(TOMORROW_AFTERNOON, TOMORROW_AFTERNOON.plusSeconds(3600)), externalAccount, externalPerson,
                Set.of(Role.EXTERNAL), null, participants, null));
    }

    private UUID book(UUID cardId) {
        return bookingService.create(new CreateBookingCommand(List.of(courtId), cardId,
                new TimeSlot(TOMORROW_AFTERNOON, TOMORROW_AFTERNOON.plusSeconds(3600)), externalAccount, externalPerson,
                Set.of(Role.EXTERNAL), null, List.of(), null));
    }
}
