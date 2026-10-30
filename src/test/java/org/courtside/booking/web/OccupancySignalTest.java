package org.courtside.booking.web;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.internal.OccupancyKeys;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.BookingCard;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, BookingTestFixture.class, CardTestFixture.class})
class OccupancySignalTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private OccupancyKeys keys;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;
    private UUID courtOne;
    private UUID courtTwo;
    private UUID booker;
    private String key;

    @BeforeEach
    void twoCourtsAndAKey() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity())
                .addFilters(context.getBean(OccupancyKeyQueryMask.class)).build();
        courtOne = facility.createCourt(1, "Centre Court");
        courtTwo = facility.createCourt(2, "Court 2");
        booker = identity.createEnabledAccount(identity.createPerson("Jane", "Doe", "jane.doe@example.org"),
                "doe.jane", Set.of(Role.MEMBER));
        key = keys.issue().key();
    }

    @Test
    void givenOneCourtInPlayAndTheOtherBookedLater_whenPolled_thenTheAnswerHoldsOnlyTheDocumentedLines()
            throws Exception {
        // given
        UUID playing = book(courtOne, MEMBER_BOOKING_CARD, minutes(-30), minutes(30));
        book(courtTwo, MEMBER_BOOKING_CARD, NOW.plusSeconds(37 * 60 + 30), minutes(97));

        // when
        String body = poll(key)
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_PLAIN))
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(body).as("occupied now reads 1 and 0 minutes, the next start counts down in whole minutes")
                .isEqualTo("""
                        court1.occupied=1
                        court1.minutes=0
                        court2.occupied=0
                        court2.minutes=37
                        """);
        assertThat(body).as("nothing beyond the occupancy state leaves the instance")
                .doesNotContain("Centre Court").doesNotContain(playing.toString())
                .doesNotContain(courtOne.toString()).doesNotContain("doe.jane").doesNotContain("Member");
    }

    @Test
    void givenABookingThatEndedAndOneStartingLater_whenPolled_thenTheCourtIsFreeUntilTheNextStart() throws Exception {
        // given
        book(courtOne, MEMBER_BOOKING_CARD, minutes(-60), NOW);
        book(courtOne, MEMBER_BOOKING_CARD, minutes(5), minutes(65));

        // when / then
        assertThat(lines()).as("a booking ending now no longer occupies, the next one is five minutes away")
                .contains("court1.occupied=0", "court1.minutes=5");
    }

    @Test
    void givenABookingStartingNow_whenPolled_thenItsCourtIsOccupied() throws Exception {
        // given
        book(courtOne, MEMBER_BOOKING_CARD, NOW, minutes(60));

        // when / then
        assertThat(lines()).contains("court1.occupied=1", "court1.minutes=0");
    }

    @Test
    void givenNoBookingWithinADay_whenPolled_thenTheMinutesStopAtTheirCeiling() throws Exception {
        // given
        book(courtOne, MEMBER_BOOKING_CARD, NOW.plus(Duration.ofHours(24)).plusSeconds(60), minutes(25 * 60));

        // when / then
        assertThat(lines()).as("a start beyond 24 hours and no booking at all both read the ceiling")
                .contains("court1.occupied=0", "court1.minutes=1440", "court2.occupied=0", "court2.minutes=1440");
    }

    @Test
    void givenAClosureAndACardWithoutTheSignal_whenPolled_thenNeitherCourtReadsOccupied() throws Exception {
        // given
        UUID silentCard = cards.createBookingCard("Maintenance", Set.of(), Set.of());
        cards.letBookingsSignalOccupancy(silentCard, false);
        book(courtOne, BookingCard.COURT_CLOSED, minutes(-30), minutes(30));
        book(courtTwo, silentCard, minutes(-30), minutes(30));
        book(courtTwo, silentCard, minutes(40), minutes(100));

        // when / then
        assertThat(lines()).as("only a signalling card occupies a court or counts as its next booking")
                .contains("court1.occupied=0", "court1.minutes=1440", "court2.occupied=0", "court2.minutes=1440");
    }

    @Test
    void givenACancelledBooking_whenPolled_thenItsCourtIsFree() throws Exception {
        // given
        UUID booking = book(courtOne, MEMBER_BOOKING_CARD, minutes(-30), minutes(30));
        jdbc.sql("UPDATE booking SET status = 'CANCELLED' WHERE id = :id").param("id", booking).update();
        jdbc.sql("UPDATE court_allocation SET status = 'CANCELLED' WHERE booking_id = :id").param("id", booking).update();

        // when / then
        assertThat(lines()).contains("court1.occupied=0", "court1.minutes=1440");
    }

    @Test
    void givenAnInactiveCourt_whenPolled_thenItIsNotAnswered() throws Exception {
        // given
        book(courtTwo, MEMBER_BOOKING_CARD, minutes(-30), minutes(30));
        facility.deactivateCourt(courtTwo);

        // when / then
        assertThat(lines()).as("an inactive court is left out rather than reported free")
                .containsExactly("court1.occupied=0", "court1.minutes=1440");
    }

    @Test
    void givenAMissingOrWrongKey_whenPolled_thenTheAnswerIsAnEmpty401() throws Exception {
        // when / then
        mockMvc.perform(get("/api/public/occupancy"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().string(""));
        poll(key.substring(1) + "x")
                .andExpect(status().isUnauthorized())
                .andExpect(content().string(""));
    }

    @Test
    void givenARotatedKey_whenPolledWithTheOldOne_thenOnlyTheNewOneIsAnswered() throws Exception {
        // given
        String rotated = keys.issue().key();

        // when / then
        poll(key).andExpect(status().isUnauthorized()).andExpect(content().string(""));
        poll(rotated).andExpect(status().isOk());
    }

    @Test
    void givenARevokedKey_whenPolled_thenItIsRefused() throws Exception {
        // given
        keys.revoke();

        // when / then
        poll(key).andExpect(status().isUnauthorized()).andExpect(content().string(""));
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void givenRequestLoggingAtDebug_whenPolled_thenTheKeyAppearsInNoLogAuditOrEvent(CapturedOutput output)
            throws Exception {
        // given
        List<Logger> requestLoggers = List.of((Logger) LoggerFactory.getLogger("org.springframework.web"),
                (Logger) LoggerFactory.getLogger("org.springframework.test.web.servlet"));
        List<Level> before = requestLoggers.stream().map(Logger::getLevel).toList();
        requestLoggers.forEach(logger -> logger.setLevel(Level.DEBUG));

        // when
        try {
            poll(key).andExpect(status().isOk());
            poll(key + "x").andExpect(status().isUnauthorized());
        } finally {
            for (int index = 0; index < requestLoggers.size(); index++) {
                requestLoggers.get(index).setLevel(before.get(index));
            }
        }

        // then
        assertThat(output.getAll()).as("the request was logged at all").contains("/api/public/occupancy");
        assertThat(output.getAll()).as("but never with its key").doesNotContain(key);
        List<String> payloads = jdbc.sql("SELECT event_type || ' ' || payload::text FROM domain_event")
                .query(String.class).list();
        assertThat(payloads).as("the key was issued and audited").anyMatch(row -> row.startsWith("booking.occupancyKey.created"));
        assertThat(payloads).as("no recorded event carries the key").noneMatch(row -> row.contains(key));
        assertThat(jdbc.sql("SELECT key_hash FROM occupancy_key").query(String.class).single())
                .as("only a hash of the key is stored").isNotEqualTo(key).doesNotContain(key);
    }

    private UUID book(UUID court, UUID card, Instant start, Instant end) {
        return bookings.insertBookingThatHasStarted(court, card, new TimeSlot(start, end), booker);
    }

    private static Instant minutes(long offset) {
        return NOW.plus(Duration.ofMinutes(offset));
    }

    private ResultActions poll(String withKey) throws Exception {
        return mockMvc.perform(get("/api/public/occupancy?key=" + withKey));
    }

    private List<String> lines() throws Exception {
        return poll(key).andExpect(status().isOk()).andReturn().getResponse().getContentAsString().lines().toList();
    }
}
