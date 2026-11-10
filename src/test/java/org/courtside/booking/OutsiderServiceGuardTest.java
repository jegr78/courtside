package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.partner.PartnerSearchService;
import org.courtside.booking.series.CancelScope;
import org.courtside.booking.series.SeriesService;
import org.courtside.booking.waitlist.JoinWaitlistCommand;
import org.courtside.booking.waitlist.WaitlistService;
import org.courtside.card.CardService;
import org.courtside.identity.OutsiderRefusedException;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.DependantService;
import org.courtside.member.MemberService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.SoftAssertions.assertSoftly;

class OutsiderServiceGuardTest extends AbstractIntegrationTest {

    private static final Set<Role> EXTERNAL = Set.of(Role.EXTERNAL);

    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private PartnerSearchService partnerSearch;
    @Autowired
    private WaitlistService waitlist;
    @Autowired
    private SeriesService series;
    @Autowired
    private MemberService members;
    @Autowired
    private CardService cards;
    @Autowired
    private DependantService dependants;
    @Autowired
    private DependantBookings dependantBookings;
    @Autowired
    private UserDetailsService userDetails;

    private UUID account;
    private UUID person;

    @BeforeEach
    void anExternalAccountWithoutMembership() {
        person = identity.createPerson("John", "Roe", "john.roe@example.org");
        account = identity.createEnabledAccount(person, "roe.john", EXTERNAL);
        UserDetails signedIn = userDetails.loadUserByUsername("roe.john");
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(signedIn, null, signedIn.getAuthorities()));
    }

    @AfterEach
    void signOut() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void givenAnOutsider_whenItReachesAMemberOnlyServiceBehindTheWebLayer_thenEachServiceRefusesIt() {
        // given
        UUID any = UUID.randomUUID();
        Map<String, ThrowingCallable> calls = Map.ofEntries(
                Map.entry("partner publish", () -> partnerSearch.publish(any, account)),
                Map.entry("partner withdraw", () -> partnerSearch.withdraw(any, account)),
                Map.entry("open places", () -> partnerSearch.openPlaces(account, person, EXTERNAL)),
                Map.entry("partner accept", () -> partnerSearch.accept(any, account, person, EXTERNAL)),
                Map.entry("waitlist join", () -> waitlist.join(
                        new JoinWaitlistCommand(any, any, null, account, person, EXTERNAL, null, List.of()))),
                Map.entry("waitlist leave", () -> waitlist.leave(any, account)),
                Map.entry("waitlist accept", () -> waitlist.accept(any, account, person, EXTERNAL)),
                Map.entry("waitlist entries", () -> waitlist.ownEntries(account)),
                Map.entry("series preview", () -> series.preview(null, account, person, EXTERNAL)),
                Map.entry("series create", () -> series.create(null, List.of(java.time.Instant.EPOCH), account, person,
                        EXTERNAL, null)),
                Map.entry("series cancel", () -> series.cancel(any, any, CancelScope.values()[0], account, EXTERNAL,
                        null)),
                Map.entry("series move preview", () -> series.previewMove(null, account, EXTERNAL)),
                Map.entry("series move", () -> series.move(null, account, EXTERNAL)),
                Map.entry("member search", () -> members.findParticipants("Doe", account)),
                Map.entry("participant cards", () -> cards.activeParticipantCardsFor(account, EXTERNAL)),
                Map.entry("dependants", () -> dependants.dependantsOfCurrentAccount()),
                Map.entry("dependant cards", () -> dependantBookings.cardsFor(any)));

        // when / then
        assertSoftly(soft -> calls.forEach((name, call) ->
                soft.assertThatThrownBy(call).as(name).isInstanceOf(OutsiderRefusedException.class)));
    }
}
