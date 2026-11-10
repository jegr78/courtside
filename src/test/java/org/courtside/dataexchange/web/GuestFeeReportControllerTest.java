package org.courtside.dataexchange.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class GuestFeeReportControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final String REPORT = "/api/treasury/guest-fees";
    private static final String EXPORT = "/api/treasury/guest-fees/export";

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private MemberTestFixture members;
    @Autowired
    private FacilityTestFixture facility;
    @Autowired
    private BookingTestFixture bookings;
    @Autowired
    private UserDetailsService userDetailsService;
    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;
    private UUID court;
    private UUID secondCourt;
    private UUID janeAccount;
    private UUID johnAccount;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        court = facility.createCourt(1, "Court 1");
        secondCourt = facility.createCourt(2, "Court 2");
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(john, "roe.john", Set.of(Role.MEMBER));
        identity.createEnabledAccount(identity.createPerson("Mary", "Major", "mary.major@example.org"),
                "major.mary", Set.of(Role.MEMBER, Role.TREASURER));
        identity.createEnabledAccount(identity.createPerson("Richard", "Miles", "richard.miles@example.org"),
                "miles.richard", Set.of(Role.ADMIN));
        UUID type = members.createMembershipType("Adult");
        UUID main = source("main", "Main roster", type);
        UUID youth = source("youth", "Youth roster", type);
        reference(main, "A-17", jane);
        reference(youth, "B-3", jane);
        reference(main, "-4", john);
    }

    @Test
    void givenAYearOfGuestBookings_whenTheTreasurerReadsTheReport_thenOnlyEndedConfirmedChargedGuestsCount() throws Exception {
        // given
        aTestYear();

        // when / then
        mockMvc.perform(post(REPORT).param("from", "2026-01-01").param("to", "2026-12-31")
                        .with(csrf()).with(user(as("major.mary"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.from").value("2026-01-01"))
                .andExpect(jsonPath("$.to").value("2026-12-31"))
                .andExpect(jsonPath("$.sources[*].displayName").value(org.hamcrest.Matchers.contains(
                        "Main roster", "Youth roster")))
                .andExpect(jsonPath("$.members", hasSize(3)))
                .andExpect(jsonPath("$.members[0].lastName").value("Doe"))
                .andExpect(jsonPath("$.members[0].currency").value("CHF"))
                .andExpect(jsonPath("$.members[0].guestPlaces").value(1))
                .andExpect(jsonPath("$.members[0].sumMinor").value(300))
                .andExpect(jsonPath("$.members[1].lastName").value("Doe"))
                .andExpect(jsonPath("$.members[1].currency").value("EUR"))
                .andExpect(jsonPath("$.members[1].guestPlaces").value(5))
                .andExpect(jsonPath("$.members[1].sumMinor").value(2500))
                .andExpect(jsonPath("$.members[1].memberNumbers[*].externalId").value(
                        org.hamcrest.Matchers.contains("A-17", "B-3")))
                .andExpect(jsonPath("$.members[2].lastName").value("Roe"))
                .andExpect(jsonPath("$.members[2].guestPlaces").value(1))
                .andExpect(jsonPath("$.members[2].sumMinor").value(750))
                .andExpect(jsonPath("$.unassignedGuestPlaces").value(1));
    }

    @Test
    void givenNoPeriod_whenTheReportIsRead_thenItCoversTheCurrentCalendarYear() throws Exception {
        // given
        aTestYear();

        // when / then
        mockMvc.perform(post(REPORT).with(csrf()).with(user(as("miles.richard"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.from").value("2026-01-01"))
                .andExpect(jsonPath("$.to").value("2026-12-31"))
                .andExpect(jsonPath("$.members", hasSize(3)));
    }

    @Test
    void givenAYearOfGuestBookings_whenTheReportIsDownloaded_thenEachRowCarriesTheMemberNumbersOfEverySource() throws Exception {
        // given
        aTestYear();

        // when
        String written = mockMvc.perform(post(EXPORT).param("from", "2026-01-01").param("to", "2026-12-31")
                        .param("separator", ";").with(csrf()).with(user(as("major.mary"))))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("text/csv"))
                .andExpect(header().string("Content-Disposition",
                        "attachment; filename=\"guest-fees-2026-01-01-2026-12-31.csv\""))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        // then
        assertThat(Arrays.asList(written.split("\r\n"))).containsExactly(
                "﻿memberNumber Main roster;memberNumber Youth roster;firstName;lastName;email;guestPlaces;amount;currency",
                "A-17;B-3;Jane;Doe;jane.doe@example.org;1;3.00;CHF",
                "A-17;B-3;Jane;Doe;jane.doe@example.org;5;25.00;EUR",
                "'-4;;John;Roe;john.roe@example.org;1;7.50;EUR");
    }

    @Test
    void givenAMember_whenTheyAskForTheReport_thenTheyAreRefused() throws Exception {
        // when / then
        mockMvc.perform(post(REPORT).with(csrf()).with(user(as("doe.jane")))).andExpect(status().isForbidden());
        mockMvc.perform(post(EXPORT).with(csrf()).with(user(as("doe.jane")))).andExpect(status().isForbidden());
    }

    @Test
    void givenATreasurerWhoMustStillChangeTheirPassword_whenTheyAskForTheReport_thenTheyAreRefused() throws Exception {
        // given
        identity.requirePasswordChange("major.mary");

        // when / then
        mockMvc.perform(post(REPORT).with(csrf()).with(user(as("major.mary")))).andExpect(status().isForbidden());
        mockMvc.perform(post(EXPORT).with(csrf()).with(user(as("major.mary")))).andExpect(status().isForbidden());
    }

    @Test
    void givenNoSession_whenTheReportIsAskedFor_thenTheCallerMustSignIn() throws Exception {
        // when / then
        mockMvc.perform(post(REPORT).with(csrf())).andExpect(status().isUnauthorized());
    }

    @Test
    void givenAPeriodLongerThanAYear_whenTheReportIsRead_thenItIsRefusedByNameAndNothingIsRecorded() throws Exception {
        // when / then
        mockMvc.perform(post(REPORT).param("from", "2025-01-01").param("to", "2026-01-02")
                        .with(csrf()).with(user(as("major.mary"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("booking.facilityUtilisation.periodTooLong"));
        assertThat(readsRecorded()).as("a refused period reads nothing").isZero();
    }

    @Test
    void givenOnlyAStartDate_whenTheReportIsRead_thenTheHalfPeriodIsRefusedByName() throws Exception {
        // when / then
        mockMvc.perform(post(REPORT).param("from", "2025-03-01").with(csrf()).with(user(as("major.mary"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:guest-fee-period-incomplete"))
                .andExpect(jsonPath("$.violations[0].code").value("treasury.guestFees.periodIncomplete"));
        assertThat(readsRecorded()).as("a half period reads nothing").isZero();
    }

    @Test
    void givenOnlyAnEndDate_whenTheFileIsDownloaded_thenTheHalfPeriodIsRefusedByName() throws Exception {
        // when / then
        mockMvc.perform(post(EXPORT).param("to", "2025-06-30").with(csrf()).with(user(as("major.mary"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:guest-fee-period-incomplete"))
                .andExpect(jsonPath("$.violations[0].code").value("treasury.guestFees.periodIncomplete"));
        assertThat(readsRecorded()).as("a half period reads nothing").isZero();
    }

    @Test
    void givenAnEncodingThatCannotWrite_whenTheReportIsDownloaded_thenItIsRefusedAndNothingIsRecorded() throws Exception {
        // when / then
        mockMvc.perform(post(EXPORT).param("encoding", "UTF-99").with(csrf()).with(user(as("major.mary"))))
                .andExpect(status().isBadRequest());
        assertThat(readsRecorded()).as("a refused download reads nothing").isZero();
    }

    @Test
    void givenAReversedPeriod_whenTheReportIsRead_thenThePeriodIsRefusedByName() throws Exception {
        // when / then
        mockMvc.perform(post(REPORT).param("from", "2026-12-31").param("to", "2026-01-01")
                        .with(csrf()).with(user(as("major.mary"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("booking.facilityUtilisation.periodOrder"));
    }

    @Test
    void givenAYearOfGuestBookings_whenTheReportIsReadAndDownloaded_thenEachReadIsRecordedWithoutItsContent() throws Exception {
        // given
        aTestYear();

        // when
        mockMvc.perform(post(REPORT).with(csrf()).with(user(as("major.mary")))).andExpect(status().isOk());
        mockMvc.perform(post(EXPORT).with(csrf()).with(user(as("major.mary")))).andExpect(status().isOk());

        // then
        List<String> payloads = jdbc.sql("""
                        SELECT payload::text FROM domain_event WHERE event_type = 'dataexchange.guestFees.read'
                        ORDER BY occurred_at, payload::text
                        """).query(String.class).list();
        assertThat(payloads).as("one entry for the screen and one for the file").hasSize(2);
        assertThat(payloads).allSatisfy(payload -> assertThat(payload)
                .as("the period is recorded, nobody's name or sum")
                .contains("2026-01-01").contains("2026-12-31")
                .doesNotContain("Doe").doesNotContain("Roe").doesNotContain("2500").doesNotContain("A-17"));
        assertThat(payloads).anySatisfy(payload -> assertThat(payload).contains("\"form\": \"SCREEN\""));
        assertThat(payloads).anySatisfy(payload -> assertThat(payload).contains("\"form\": \"FILE\""));
    }

    private void aTestYear() {
        UUID twoGuests = booking(janeAccount, "2026-02-10T10:00:00Z");
        bookings.chargeGuests(twoGuests, 2, 500, "EUR");
        UUID withAFreeGuest = booking(janeAccount, "2026-03-10T10:00:00Z");
        bookings.chargeGuests(withAFreeGuest, 1, 500, "EUR");
        bookings.chargeGuests(withAFreeGuest, 1, 0, "EUR");
        UUID onTwoCourts = booking(janeAccount, "2026-04-01T10:00:00Z");
        bookings.allocateAnotherCourt(onTwoCourts, secondCourt);
        bookings.chargeGuests(onTwoCourts, 1, 500, "EUR");
        bookings.chargeGuests(booking(janeAccount, "2026-04-02T10:00:00Z"), 1, 300, "CHF");
        bookings.chargeGuests(booking(janeAccount, "2025-12-31T23:30:00Z"), 1, 500, "EUR");
        bookings.chargeGuests(booking(janeAccount, "2025-12-31T22:00:00Z"), 1, 500, "EUR");
        bookings.chargeGuests(booking(johnAccount, "2026-03-01T10:00:00Z"), 1, 750, "EUR");
        bookings.chargeGuests(booking(janeAccount, "2026-06-01T10:00:00Z"), 1, 500, "EUR");
        bookings.chargeGuests(booking(janeAccount, "2026-05-12T09:30:00Z"), 1, 500, "EUR");
        UUID cancelled = booking(janeAccount, "2026-01-20T10:00:00Z");
        bookings.chargeGuests(cancelled, 1, 500, "EUR");
        bookings.cancelRecorded(cancelled);
        UUID forgotten = booking(johnAccount, "2026-02-01T10:00:00Z");
        bookings.chargeGuests(forgotten, 1, 500, "EUR");
        bookings.pseudonymise(forgotten);
    }

    private long readsRecorded() {
        return jdbc.sql("SELECT count(*) FROM domain_event WHERE event_type = 'dataexchange.guestFees.read'")
                .query(Long.class).single();
    }

    private UUID booking(UUID bookedBy, String startsAt) {
        Instant start = Instant.parse(startsAt);
        return bookings.insertBookingThatHasStarted(court, MEMBER_BOOKING_CARD,
                new TimeSlot(start, start.plusSeconds(3600)), bookedBy);
    }

    private UUID source(String key, String displayName, UUID membershipType) {
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO import_source (id, source_key, display_name, separator, encoding,
                            default_membership_type_id, removal_warning_percent, created_at, column_mode)
                        VALUES (:id, :key, :name, ',', 'UTF-8', :type, 20, now(), 'HEADER')
                        """)
                .param("id", id).param("key", key).param("name", displayName).param("type", membershipType)
                .update();
        return id;
    }

    private void reference(UUID sourceId, String externalId, UUID personId) {
        jdbc.sql("""
                        INSERT INTO import_external_reference (id, source_id, external_id, person_id, linked_at)
                        VALUES (:id, :source, :external, :person, now())
                        """)
                .param("id", UUID.randomUUID()).param("source", sourceId).param("external", externalId)
                .param("person", personId).update();
    }

    private UserDetails as(String username) {
        return userDetailsService.loadUserByUsername(username);
    }
}
