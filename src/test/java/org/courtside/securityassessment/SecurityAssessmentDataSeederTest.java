package org.courtside.securityassessment;

import org.courtside.booking.BookingRepository;
import org.courtside.card.CardService;
import org.courtside.card.ParticipantCard;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.EnumSet;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SecurityAssessmentDataSeederTest {

    @Test
    void givenFreshDatabase_whenSeedingSecurityData_thenEveryRoleHasTwoAccountsAndBoundaryDataExists() {
        // given
        PersonRepository persons = mock(PersonRepository.class);
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        MemberRepository members = mock(MemberRepository.class);
        FacilityService facility = mock(FacilityService.class);
        CardService cards = mock(CardService.class);
        BookingRepository bookings = mock(BookingRepository.class);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        Court first = court(1);
        Court second = court(2);
        when(accounts.count()).thenReturn(1L);
        when(persons.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(encoder.encode("synthetic-password-value")).thenReturn("password-hash");
        when(facility.allCourts()).thenReturn(List.of(first));
        when(facility.changeCourt(first.getId(), 1, "Assessment Court 1")).thenReturn(first);
        when(facility.createCourt(2, "Assessment Court 2")).thenReturn(second);
        ParticipantCard inactiveCard = mock(ParticipantCard.class);
        when(inactiveCard.getId()).thenReturn(java.util.UUID.randomUUID());
        when(cards.createParticipantCard("Inactive assessment card", 1)).thenReturn(inactiveCard);
        SecurityAssessmentDataSeeder seeder = new SecurityAssessmentDataSeeder(
                persons, accounts, members, facility, cards, bookings, jdbc, encoder,
                new SecurityAssessmentProperties(true, "run-0001", SecurityAssessmentDataset.fingerprint(),
                        "synthetic-password-value"),
                Clock.fixed(Instant.parse("2026-08-19T10:00:00Z"), ZoneOffset.UTC),
                () -> ZoneId.of("Europe/Berlin"));

        // when
        seeder.run(new DefaultApplicationArguments(new String[0]));

        // then
        ArgumentCaptor<UserAccount> account = ArgumentCaptor.forClass(UserAccount.class);
        verify(accounts, times(SecurityAssessmentDataSeeder.ROLE_ACCOUNT_COUNT
                + SecurityAssessmentDataset.managerCombinationAccounts())).save(account.capture());
        for (Role role : EnumSet.allOf(Role.class)) {
            assertThat(account.getAllValues().stream().filter(value -> value.getRoles().equals(java.util.Set.of(role))))
                    .as("two isolated identities for %s", role)
                    .hasSize(2);
        }
        assertThat(account.getAllValues().stream()
                .filter(value -> value.getRoles().equals(java.util.Set.of(
                        Role.MEMBER, Role.TRAINER, Role.SPORT_DIRECTOR, Role.YOUTH_DIRECTOR))))
                .hasSize(SecurityAssessmentDataset.managerCombinationAccounts());
        ArgumentCaptor<Member> member = ArgumentCaptor.forClass(Member.class);
        verify(members, times(SecurityAssessmentDataSeeder.ROLE_ACCOUNT_COUNT
                + SecurityAssessmentDataset.managerCombinationAccounts())).save(member.capture());
        assertThat(member.getAllValues()).anySatisfy(value -> assertThat(value.isCurrent()).isFalse());
        verify(bookings, times(SecurityAssessmentDataset.standaloneBookings())).save(any());
        verify(bookings, times(SecurityAssessmentDataset.seriesOccurrences())).saveAndFlush(any());
        verify(jdbc, times(2 + SecurityAssessmentDataset.seriesOccurrences()))
                .update(any(String.class), any(Object[].class));
        verify(cards).setParticipantCardActive(inactiveCard.getId(), false);
        verify(cards).createParticipantCard("Limited assessment card", 1);
        verify(cards).createParticipantCard("Unlimited assessment card", null);
    }

    private Court court(int number) {
        Court court = mock(Court.class);
        when(court.getId()).thenReturn(java.util.UUID.randomUUID());
        when(court.getNumber()).thenReturn(number);
        return court;
    }
}
