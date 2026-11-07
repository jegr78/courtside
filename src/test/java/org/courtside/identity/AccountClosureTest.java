package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.RosterService;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class, BookingTestFixture.class,
        CardTestFixture.class, ConfigTestFixture.class})
class AccountClosureTest extends AbstractIntegrationTest {

    private static final TimeSlot EVENING =
            new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z"));

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private UserDetailsService userDetails;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private ConfigTestFixture config;

    @Autowired
    private RosterService roster;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private Clock clock;

    private MockMvc mockMvc;
    private UUID court;
    private UUID winterDoubles;
    private UUID john;
    private UUID johnAccount;

    @BeforeEach
    void anExternalPlayerWithAPassword() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        court = facility.createCourt(1, "Court 1");
        config.admitExternalBookings(true);
        winterDoubles = cards.createDoublesCardForGuestsAllowing("Winter doubles", Set.of(Role.EXTERNAL));
        john = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(john, "roe.john", Set.of(Role.EXTERNAL));
    }

    @Test
    void givenAnExternalPlayerWithoutABooking_whenTheyCloseTheirAccount_thenNothingOfThemRemainsAndTheyCannotSignIn()
            throws Exception {
        // given
        UserDetails signedIn = userDetails.loadUserByUsername("roe.john");
        jdbc.sql("INSERT INTO account_mfa (account_id, totp_secret) VALUES (:id, 'sealed-secret')")
                .param("id", johnAccount).update();
        jdbc.sql("INSERT INTO mfa_recovery_code (account_id, code_hash, created_at) VALUES (:id, :hash, now())")
                .param("id", johnAccount).param("hash", "a".repeat(64)).update();
        jdbc.sql("INSERT INTO user_entities (id, account_id, name) VALUES ('passkey-handle', :id, 'roe.john')")
                .param("id", johnAccount).update();
        jdbc.sql("""
                INSERT INTO password_reset_token (account_id, code_hash, address_hash, security_epoch, created_at, expires_at)
                VALUES (:id, :hash, :hash, 0, now(), now() + interval '1 hour')
                """).param("id", johnAccount).param("hash", "b".repeat(64)).update();

        // when
        close(signedIn, true).andExpect(status().isNoContent());

        // then
        Map<String, Object> account = jdbc.sql("""
                        SELECT a.username, a.enabled, a.password_hash, a.anonymised_at, p.first_name, p.last_name, p.email
                        FROM user_account a JOIN person p ON p.id = a.person_id WHERE a.id = :id
                        """).param("id", johnAccount).query().singleRow();
        assertThat(account).as("the account stays as a row that names nobody")
                .containsEntry("enabled", false)
                .containsEntry("password_hash", null)
                .containsEntry("username", "anonymised-" + johnAccount)
                .containsEntry("email", "anonymised-" + john + "@example.invalid");
        assertThat(account.get("anonymised_at")).as("the account records when it was anonymised").isNotNull();
        assertThat(String.join(" ", (String) account.get("first_name"), (String) account.get("last_name")))
                .as("the name is gone").doesNotContain("John").doesNotContain("Roe");
        assertThat(jdbc.sql("""
                        SELECT (SELECT count(*) FROM account_mfa WHERE account_id = :id)
                             + (SELECT count(*) FROM mfa_recovery_code WHERE account_id = :id)
                             + (SELECT count(*) FROM user_entities WHERE account_id = :id)
                             + (SELECT count(*) FROM password_reset_token WHERE account_id = :id)
                        """).param("id", johnAccount).query(Long.class).single())
                .as("no second factor, passkey or reset code outlives the account").isZero();
        assertThatThrownBy(() -> userDetails.loadUserByUsername("roe.john"))
                .as("the old username no longer signs anybody in").isInstanceOf(UsernameNotFoundException.class);
        assertThat(jdbc.sql("SELECT payload::text FROM domain_event WHERE event_type = 'identity.account.closed'")
                .query(String.class).list())
                .as("the closure is audited by account id alone")
                .singleElement().asString().contains(johnAccount.toString()).doesNotContain("Roe")
                .doesNotContain("john.roe");
    }

    @Test
    void givenAClosedAccount_whenSomebodyRegistersItsOldUsername_thenTheNameIsFreeAgain() throws Exception {
        // given
        close(userDetails.loadUserByUsername("roe.john"), true).andExpect(status().isNoContent());
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when
        UUID taken = identity.createEnabledAccount(mary, "roe.john", Set.of(Role.EXTERNAL));

        // then
        assertThat(taken).as("a closed account keeps no username").isNotEqualTo(johnAccount);
    }

    @Test
    void givenAnExternalPlayerWithAnUpcomingBooking_whenTheyCloseTheirAccount_thenTheBookingRefusesIt()
            throws Exception {
        // given
        bookings.createBookingWithGuest(court, winterDoubles, EVENING, johnAccount, john, Set.of(Role.EXTERNAL),
                null, "Mary Major");

        // when / then
        close(userDetails.loadUserByUsername("roe.john"), true)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:account-closure-blocked-by-booking"));
        assertThat(identity.isAccountEnabled(johnAccount)).as("a refused closure changes nothing").isTrue();
        assertThat(identity.personName(john)).isEqualTo("John Roe");
    }

    @Test
    void givenAnExternalPlayerWhoseBookingHasEnded_whenTheyCloseTheirAccount_thenItCloses() throws Exception {
        // given
        bookings.insertBookingThatHasStarted(court, winterDoubles,
                new TimeSlot(Instant.parse("2026-05-12T08:00:00Z"), Instant.parse("2026-05-12T09:00:00Z")),
                johnAccount);

        // when / then
        close(userDetails.loadUserByUsername("roe.john"), true).andExpect(status().isNoContent());
        assertThat(identity.isAccountEnabled(johnAccount)).as("a past booking does not hold the account").isFalse();
    }

    @Test
    void givenAClosedAccount_whenTheBoardEnablesOrRenamesIt_thenTheAnonymisedRowIsRefused() throws Exception {
        // given
        close(userDetails.loadUserByUsername("roe.john"), true).andExpect(status().isNoContent());

        // when / then
        assertThatThrownBy(() -> roster.setAccountEnabled(john, true))
                .as("a closed account cannot be switched on again").isInstanceOf(AccountAnonymisedException.class);
        assertThatThrownBy(() -> roster.changePerson(john, "John", "Roe", "john.roe@example.org"))
                .as("a closed person takes no name back").isInstanceOf(AccountAnonymisedException.class);
        assertThat(identity.personName(john)).doesNotContain("Roe");
    }

    @Test
    void givenAClosedAccount_whenABookingIsWrittenForIt_thenTheBookingIsRefused() throws Exception {
        // given
        close(userDetails.loadUserByUsername("roe.john"), true).andExpect(status().isNoContent());

        // when / then
        assertThatThrownBy(() -> bookings.createBookingWithGuest(court, winterDoubles, EVENING, johnAccount, john,
                Set.of(Role.EXTERNAL), null, "Mary Major"))
                .as("a booking that raced the closure finds the account closed")
                .isInstanceOf(AccountAnonymisedException.class);
    }

    @Test
    void givenAMember_whenTheyCloseTheirAccount_thenOnlyTheBoardMayEndIt() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER, Role.EXTERNAL));
        members.holdRunningMembership(jane);

        // when / then
        close(userDetails.loadUserByUsername("doe.jane"), true)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"))
                .andExpect(jsonPath("$.violations[0].code").value("identity.account.closureNotOpen"));
        assertThat(identity.isAccountEnabled(janeAccount)).as("a member's account stays").isTrue();
    }

    @Test
    void givenAnExternalPlayerWithoutARecentProof_whenTheyCloseTheirAccount_thenTheyMustProveItFirst()
            throws Exception {
        // when / then
        close(userDetails.loadUserByUsername("roe.john"), false)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:recent-authentication-required"));
        assertThat(identity.isAccountEnabled(johnAccount)).as("nothing closes without a fresh proof").isTrue();
    }

    private ResultActions close(UserDetails signedIn, boolean recentlyProven) throws Exception {
        var request = delete("/api/account").with(user(signedIn)).with(csrf());
        if (recentlyProven) {
            request.sessionAttr("courtside.authenticated-at", clock.instant().toEpochMilli());
        }
        return mockMvc.perform(request);
    }
}
