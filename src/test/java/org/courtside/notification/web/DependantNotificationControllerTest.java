package org.courtside.notification.web;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.GuardianGrant;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class})
class DependantNotificationControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private BookingService bookings;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    private MockMvc mockMvc;
    private UUID courtId;
    private UUID jane;
    private UUID john;
    private UUID johnAccount;

    @BeforeEach
    void setUp() {
        doNothing().when(sender).send(any(MimeMessage.class));
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        john = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(john, "roe.john", Set.of(Role.MEMBER));
        bookings.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z")),
                johnAccount, john, Set.of(Role.MEMBER), null, List.of(ParticipantSpec.guest("Richard Miles")), null));
    }

    @Test
    void givenAGuardianGrantedToReadMessages_whenReadingTheDependantsCentre_thenItIsTheirsAndStaysUnread()
            throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.READ_MESSAGES));

        // when
        mockMvc.perform(get("/api/my/dependants/{personId}/notifications", john).with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].kind").value("BOOKING_CONFIRMED"))
                .andExpect(jsonPath("$.items[0].booking.startsAt").value("2026-05-12T16:00:00Z"))
                .andExpect(jsonPath("$.items[0].readAt").value(nullValue()));

        // then
        mockMvc.perform(get("/api/account/notifications").with(as("roe.john")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unread").value(1));
        mockMvc.perform(get("/api/account/notifications").with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(0)));
    }

    @Test
    void givenARelationshipThatDoesNotGrantReading_whenTheGuardianReads_thenTheActionIsRefusedByName()
            throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.VIEW_BOOKINGS));

        // when / then
        mockMvc.perform(get("/api/my/dependants/{personId}/notifications", john).with(as("doe.jane")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:guardian-action-not-granted"))
                .andExpect(jsonPath("$.violations[0].code").value("guardianship.actionNotGranted"))
                .andExpect(jsonPath("$.violations[0].params.action").value("READ_MESSAGES"));
    }

    @Test
    void givenNoRelationship_whenSomebodyReadsAnothersCentre_thenThePersonIsNoDependantOfTheirs() throws Exception {
        // when / then
        mockMvc.perform(get("/api/my/dependants/{personId}/notifications", john).with(as("doe.jane")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:dependant-not-found"));
    }

    private static RequestPostProcessor as(String username) {
        return user(username).roles("MEMBER");
    }
}
