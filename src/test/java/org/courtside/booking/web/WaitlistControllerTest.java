package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.waitlist.JoinWaitlistCommand;
import org.courtside.booking.waitlist.WaitlistService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class WaitlistControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final TimeSlot SLOT = new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"),
            Instant.parse("2026-05-13T17:00:00Z"));

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private BookingService bookings;

    @Autowired
    private WaitlistService waitlist;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;
    private UUID court;
    private Account holder;
    private Account waiting;
    private Account partner;

    record Account(UUID accountId, UUID personId) {
    }

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        court = facility.createCourt(1, "Court 1");
        holder = account("Jane", "Doe", "doe.jane");
        waiting = account("Mary", "Major", "major.mary");
        partner = account("Richard", "Miles", "miles.richard");
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "MEMBER")
    void givenATakenCourt_whenAMemberJoinsItsWaitlist_thenTheEntryIsTheirsAndNamesNoPosition() throws Exception {
        // given
        book(holder);

        // when
        mockMvc.perform(post("/api/my/waitlist").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(joinBody(MEMBER_CARD, SLOT)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").isString())
                .andExpect(header().doesNotExist("Location"));

        // then
        mockMvc.perform(get("/api/my/waitlist"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].state").value("WAITING"))
                .andExpect(jsonPath("$[0].courtId").value(court.toString()))
                .andExpect(jsonPath("$[0].cardLabel").value("Mitgliederbuchung"))
                .andExpect(jsonPath("$[0].position").doesNotExist())
                .andExpect(jsonPath("$[0].accountId").doesNotExist());
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "MEMBER")
    void givenAFreeCourt_whenAMemberJoinsItsWaitlist_thenTheSlotIsRefusedAsNotTaken() throws Exception {
        // when / then
        mockMvc.perform(post("/api/my/waitlist").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(joinBody(MEMBER_CARD, SLOT)))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value("urn:courtside:error:waitlist-slot-not-taken"))
                .andExpect(jsonPath("$.violations[0].code").value("waitlist.slot.free"));
        assertThat(entries()).isZero();
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "MEMBER")
    void givenAnEndBeforeTheStart_whenAMemberJoins_thenTheFieldIsRefused() throws Exception {
        // given
        book(holder);
        String body = joinBody(MEMBER_CARD, SLOT).replace(SLOT.end().toString(), SLOT.start().minusSeconds(3600).toString());

        // when / then
        mockMvc.perform(post("/api/my/waitlist").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("endsAt"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.ChronologicalSlot"));
        assertThat(entries()).isZero();
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "MEMBER")
    void givenAnOversizedNote_whenAMemberJoins_thenTheFieldIsRefused() throws Exception {
        // given
        book(holder);
        String body = joinBody(MEMBER_CARD, SLOT).replace("\"participants\"", "\"note\": \"%s\", \"participants\""
                .formatted("x".repeat(501)));

        // when / then
        mockMvc.perform(post("/api/my/waitlist").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("note"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Size"))
                .andExpect(jsonPath("$.fieldErrors[0].params.max").value(500));
        assertThat(entries()).isZero();
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "MEMBER")
    void givenMorePlayersThanACourtHolds_whenAMemberJoins_thenTheFieldIsRefused() throws Exception {
        // given
        book(holder);
        String players = String.join(", ", java.util.Collections.nCopies(21, "{\"guestName\": \"Guest\"}"));
        String body = joinBody(MEMBER_CARD, SLOT).replace("[{\"personId\": \"%s\"}]".formatted(partner.personId()),
                "[" + players + "]");

        // when / then
        mockMvc.perform(post("/api/my/waitlist").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("participants"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Size"))
                .andExpect(jsonPath("$.fieldErrors[0].params.max").value(20));
        assertThat(entries()).isZero();
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "MEMBER")
    void givenACardForTrainersOnly_whenAMemberJoinsWithIt_thenTheCardIsRefused() throws Exception {
        // given
        book(holder);

        // when / then
        mockMvc.perform(post("/api/my/waitlist").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(joinBody(TRAINING_CARD, SLOT)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:card-role-required"));
        assertThat(entries()).isZero();
    }

    @Test
    void givenNoSession_whenJoiningAWaitlist_thenTheCallerMustSignIn() throws Exception {
        // given
        book(holder);

        // when / then
        mockMvc.perform(post("/api/my/waitlist").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(joinBody(MEMBER_CARD, SLOT)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
        assertThat(entries()).isZero();
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "MEMBER")
    void givenAnOffer_whenTheMemberAcceptsIt_thenTheCourtIsTheirBooking() throws Exception {
        // given
        UUID entry = offered();

        // when
        String bookingId = mockMvc.perform(post("/api/my/waitlist/{id}/acceptance", entry).with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(header().exists("Location"))
                .andReturn().getResponse().getContentAsString().replaceAll(".*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");

        // then
        assertThat(jdbc.sql("SELECT booked_by FROM booking WHERE id = :id AND status = 'CONFIRMED'")
                .param("id", UUID.fromString(bookingId)).query(UUID.class).single()).isEqualTo(waiting.accountId());
        mockMvc.perform(get("/api/my/waitlist"))
                .andExpect(jsonPath("$[0].state").value("BOOKED"))
                .andExpect(jsonPath("$[0].bookingId").value(bookingId));
    }

    @Test
    @WithMockUser(username = "miles.richard", roles = "MEMBER")
    void givenAnotherMembersOffer_whenAMemberAcceptsIt_thenItIsNotFoundAndNothingIsBooked() throws Exception {
        // given
        UUID entry = offered();

        // when / then
        mockMvc.perform(post("/api/my/waitlist/{id}/acceptance", entry).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:waitlist-entry-not-found"))
                .andExpect(jsonPath("$.violations[0].code").value("waitlist.entry.notFound"));
        assertThat(stateOf(entry)).isEqualTo("OFFERED");
        assertThat(jdbc.sql("SELECT count(*) FROM booking WHERE status = 'CONFIRMED'").query(Integer.class).single())
                .isZero();
    }

    @Test
    @WithMockUser(username = "miles.richard", roles = "MEMBER")
    void givenAnotherMembersEntry_whenAMemberLeavesIt_thenItIsNotFoundAndKeepsWaiting() throws Exception {
        // given
        book(holder);
        UUID entry = joinAs(waiting);

        // when / then
        mockMvc.perform(delete("/api/my/waitlist/{id}", entry).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:waitlist-entry-not-found"));
        assertThat(stateOf(entry)).isEqualTo("WAITING");
        mockMvc.perform(get("/api/my/waitlist"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "MEMBER")
    void givenAWaitingEntry_whenTheMemberLeavesIt_thenItIsClosed() throws Exception {
        // given
        book(holder);
        UUID entry = joinAs(waiting);

        // when
        mockMvc.perform(delete("/api/my/waitlist/{id}", entry).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        assertThat(stateOf(entry)).isEqualTo("LEFT");
    }

    @Test
    @WithMockUser(username = "miles.richard", roles = "MEMBER")
    void givenAnOffer_whenAnotherMemberBooksTheCourt_thenItIsReservedForTheWaitingMember() throws Exception {
        // given
        offered();

        // when / then
        mockMvc.perform(post("/api/bookings").with(csrf()).header("Idempotency-Key", "reserved-court")
                        .contentType(MediaType.APPLICATION_JSON).content("""
                                {"courtIds": ["%s"], "cardId": "%s", "startsAt": "%s", "endsAt": "%s",
                                 "participants": [{"personId": "%s"}]}
                                """.formatted(court, MEMBER_CARD, SLOT.start(), SLOT.end(), holder.personId())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:court-reserved"));
    }

    @Test
    void givenAnOffer_whenAVisitorReadsTheReservedSlots_thenTheCourtIsHeldAndNobodyIsNamed() throws Exception {
        // given
        offered();

        // when / then
        mockMvc.perform(get("/api/reserved-slots").param("date", "2026-05-13"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].courtId").value(court.toString()))
                .andExpect(jsonPath("$[0].ownEntryId").value(nullValue()))
                .andExpect(jsonPath("$[0].accountId").doesNotExist());
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "MEMBER")
    void givenAnOffer_whenItsHolderReadsTheReservedSlots_thenTheirEntryLeadsToIt() throws Exception {
        // given
        UUID entry = offered();

        // when / then
        mockMvc.perform(get("/api/reserved-slots").param("date", "2026-05-13"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].ownEntryId").value(entry.toString()));
    }

    @Test
    void givenAnOffer_whenAVisitorReadsTheWeek_thenTheSlotIsHeldWithoutAName() throws Exception {
        // given
        offered();

        // when / then
        mockMvc.perform(get("/api/reserved-slots").param("from", "2026-05-11").param("to", "2026-05-17"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].courtId").value(court.toString()))
                .andExpect(jsonPath("$[0].ownEntryId").value(nullValue()))
                .andExpect(jsonPath("$[0].accountId").doesNotExist());
    }

    @Test
    void givenARangeLongerThanAWeek_whenReadingTheReservedSlots_thenItIsRefusedByName() throws Exception {
        // when / then
        mockMvc.perform(get("/api/reserved-slots").param("from", "2026-05-11").param("to", "2026-05-18"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:day-range-invalid"))
                .andExpect(jsonPath("$.violations[0].code").value("bookings.range.tooLong"))
                .andExpect(jsonPath("$.violations[0].params.maxDays").value(7));
    }

    private UUID offered() {
        UUID booking = book(holder);
        UUID entry = joinAs(waiting);
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));
        assertThat(stateOf(entry)).isEqualTo("OFFERED");
        return entry;
    }

    private UUID joinAs(Account account) {
        return waitlist.join(new JoinWaitlistCommand(court, MEMBER_CARD, SLOT, account.accountId(),
                account.personId(), Set.of(Role.MEMBER), null, List.of(ParticipantSpec.member(partner.personId()))));
    }

    private UUID book(Account account) {
        return bookings.create(new CreateBookingCommand(List.of(court), MEMBER_CARD, SLOT, account.accountId(),
                account.personId(), Set.of(Role.MEMBER), null, List.of(ParticipantSpec.member(partner.personId())),
                null));
    }

    private String joinBody(UUID card, TimeSlot slot) {
        return """
                {"courtId": "%s", "cardId": "%s", "startsAt": "%s", "endsAt": "%s",
                 "participants": [{"personId": "%s"}]}
                """.formatted(court, card, slot.start(), slot.end(), partner.personId());
    }

    private Account account(String firstName, String lastName, String username) {
        UUID person = identity.createPerson(firstName, lastName, username + "@example.org");
        return new Account(identity.createEnabledAccount(person, username, passwordEncoder.encode("secret"),
                Set.of(Role.MEMBER)), person);
    }

    private String stateOf(UUID entry) {
        return jdbc.sql("SELECT state FROM waitlist_entry WHERE id = :id").param("id", entry)
                .query(String.class).single();
    }

    private int entries() {
        return jdbc.sql("SELECT count(*) FROM waitlist_entry").query(Integer.class).single();
    }
}
