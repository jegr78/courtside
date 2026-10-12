package org.courtside.notification;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, NotificationTestFixture.class, BookingTestFixture.class})
class WaitlistOfferMessageTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final TimeSlot SLOT = new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"),
            Instant.parse("2026-05-13T17:00:00Z"));

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private NotificationTestFixture notifications;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JdbcClient jdbc;

    private SentMail mail;
    private UUID court;
    private UUID holderAccount;
    private UUID holderPerson;
    private UUID waitingAccount;
    private UUID waitingPerson;
    private UUID partnerPerson;

    @BeforeEach
    void aTakenCourtWithAWaitingMember() {
        doNothing().when(sender).send(any(MimeMessage.class));
        mail = new SentMail(sender);
        court = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        holderPerson = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        holderAccount = identity.createEnabledAccount(holderPerson, "doe.jane", Set.of(Role.MEMBER));
        waitingPerson = identity.createPerson("Mary", "Major", "mary.major@example.org");
        waitingAccount = identity.createEnabledAccount(waitingPerson, "major.mary",
                passwordEncoder.encode("secret"), Set.of(Role.MEMBER));
        partnerPerson = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
    }

    @Test
    void givenAWaitingMember_whenTheCourtFrees_thenTheOfferReachesTheCentreAndTheMailboxFirst() throws Exception {
        // given
        UUID booking = bookings.createBookingNamingMember(court, MEMBER_CARD, SLOT, holderAccount, holderPerson, Set.of(Role.MEMBER), null, partnerPerson);
        bookings.joinWaitlist(court, MEMBER_CARD, SLOT, waitingAccount, waitingPerson, partnerPerson);

        // when
        bookings.cancelBooking(booking, holderAccount, Set.of(Role.MEMBER));

        // then
        assertThat(notifications.notificationsFor(waitingAccount)).containsExactly(MessageKind.WAITLIST_OFFER);
        assertThat(notifications.mailsQueuedFor(waitingAccount)).containsExactly(MessageKind.WAITLIST_OFFER);
        assertThat(mail.bodiesTo("mary.major@example.org")).singleElement().asString()
                .contains("Mittwoch, 13. Mai 2026", "18:00", "19:00", "Court 1", "bis 12:15 Uhr")
                .doesNotContain("Jane").doesNotContain("Doe");
    }

    @Test
    void givenAMemberWhoDeclinedEmail_whenTheCourtFrees_thenTheOfferStillReachesTheCentre() {
        // given
        notifications.declineEmail(waitingAccount);
        UUID booking = bookings.createBookingNamingMember(court, MEMBER_CARD, SLOT, holderAccount, holderPerson, Set.of(Role.MEMBER), null, partnerPerson);
        bookings.joinWaitlist(court, MEMBER_CARD, SLOT, waitingAccount, waitingPerson, partnerPerson);

        // when
        bookings.cancelBooking(booking, holderAccount, Set.of(Role.MEMBER));

        // then
        assertThat(notifications.notificationsFor(waitingAccount))
                .as("joining the waitlist is the consent, so the centre always holds the offer")
                .containsExactly(MessageKind.WAITLIST_OFFER);
        assertThat(notifications.mailsQueuedFor(waitingAccount)).as("email follows the channel choice").isEmpty();
    }

    @Test
    void whenAMemberTriesToDeclineTheOfferKind_thenItCannotBeSwitchedOff() {
        // when / then
        assertThat(MessageKind.WAITLIST_OFFER.isDeclinable()).isFalse();
        assertThat(jdbc.sql("""
                        SELECT count(*) FROM pg_constraint
                        WHERE conname = 'message_optout_kind_declinable'
                          AND pg_get_constraintdef(oid) LIKE '%WAITLIST_OFFER%'
                        """).query(Integer.class).single())
                .as("no stored opt-out can name the offer, so none is silently turned into one")
                .isZero();
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "MEMBER")
    void givenAnOffer_whenTheMemberReadsTheCentre_thenTheEntryNamesTheSlotItsDeadlineAndLeadsToIt() throws Exception {
        // given
        UUID booking = bookings.createBookingNamingMember(court, MEMBER_CARD, SLOT, holderAccount, holderPerson, Set.of(Role.MEMBER), null, partnerPerson);
        UUID entry = bookings.joinWaitlist(court, MEMBER_CARD, SLOT, waitingAccount, waitingPerson, partnerPerson);
        bookings.cancelBooking(booking, holderAccount, Set.of(Role.MEMBER));
        MockMvc mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

        // when / then
        mockMvc.perform(get("/api/account/notifications"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].kind").value("WAITLIST_OFFER"))
                .andExpect(jsonPath("$.items[0].waitlistOffer.open").value(true))
                .andExpect(jsonPath("$.items[0].waitlistOffer.expiresAt").value("2026-05-12T10:15:00Z"))
                .andExpect(jsonPath("$.items[0].waitlistOffer.slot.courts[0].name").value("Court 1"))
                .andExpect(jsonPath("$.items[0].link.target").value("WAITLIST"))
                .andExpect(jsonPath("$.items[0].link.waitlistEntryId").value(entry.toString()));
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "MEMBER")
    void givenAnEntryOfAnotherAccountNamedInTheCentre_whenTheMemberReadsIt_thenNothingOfThatEntryIsShown()
            throws Exception {
        // given
        UUID booking = bookings.createBookingNamingMember(court, MEMBER_CARD, SLOT, holderAccount, holderPerson, Set.of(Role.MEMBER), null, partnerPerson);
        UUID otherPerson = identity.createPerson("John", "Roe", "john.roe@example.org");
        UUID otherAccount = identity.createEnabledAccount(otherPerson, "roe.john", Set.of(Role.MEMBER));
        UUID foreign = bookings.joinWaitlist(court, MEMBER_CARD, SLOT, otherAccount, otherPerson, partnerPerson);
        bookings.cancelBooking(booking, holderAccount, Set.of(Role.MEMBER));
        jdbc.sql("""
                        INSERT INTO notification (id, account_id, kind, parameters, created_at)
                        VALUES (:id, :account, 'WAITLIST_OFFER', CAST(:parameters AS jsonb), now())
                        """)
                .param("id", UUID.randomUUID()).param("account", waitingAccount)
                .param("parameters", "{\"waitlistEntryId\": \"" + foreign + "\"}").update();
        MockMvc mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

        // when / then
        mockMvc.perform(get("/api/account/notifications"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].waitlistOffer").doesNotExist())
                .andExpect(jsonPath("$.items[0].link.waitlistEntryId").doesNotExist());
    }
}
