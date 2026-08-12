package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// At UTC+10:30 in June, far enough that filtering on the server's or the database's zone instead
// of the club's would misclassify this booking's weekday.
@WithMockUser(username = "admin", roles = "ADMIN")
class ImpactClubZoneTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final ZoneId ZONE = ZoneId.of("Australia/Lord_Howe");
    private static final Instant STARTS_AT = Instant.parse("2026-06-02T14:00:00Z");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        jdbc.sql("UPDATE club_config SET time_zone = ?").param(ZONE.getId()).update();
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenABookingWhoseUtcAndClubLocalDatesFallOnDifferentWeekdays_whenClosingTheClubLocalWeekday_thenItIsCounted()
            throws Exception {
        // given
        DayOfWeek clubWeekday = STARTS_AT.atZone(ZONE).getDayOfWeek();
        assertThat(clubWeekday).isNotEqualTo(STARTS_AT.atZone(ZoneOffset.UTC).getDayOfWeek());
        UUID court = courts.save(new Court(1, null)).getId();
        UUID bookingId = insertBooking(court);

        // when / then
        mockMvc.perform(get("/api/admin/impact/opening-hours/" + clubWeekday))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(1))
                .andExpect(jsonPath("$.bookings[0].bookingId").value(bookingId.toString()));
    }

    private UUID insertBooking(UUID courtId) {
        UUID bookingId = UUID.randomUUID();
        jdbc.sql("INSERT INTO booking (id, card_id, status) VALUES (?, ?, 'CONFIRMED')")
                .params(bookingId, MEMBER_BOOKING_CARD)
                .update();
        jdbc.sql("""
                        INSERT INTO court_allocation
                            (id, booking_id, court_id, starts_at, ends_at, status)
                        VALUES (?, ?, ?, ?, ?, 'CONFIRMED')
                        """)
                .params(UUID.randomUUID(), bookingId, courtId,
                        STARTS_AT.atOffset(ZoneOffset.UTC), STARTS_AT.plusSeconds(3600).atOffset(ZoneOffset.UTC))
                .update();
        return bookingId;
    }
}
