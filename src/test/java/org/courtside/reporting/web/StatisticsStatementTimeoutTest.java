package org.courtside.reporting.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingStatistics;
import org.courtside.notification.MessageStatistics;
import org.courtside.reporting.internal.StatisticsService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
class StatisticsStatementTimeoutTest extends AbstractIntegrationTest {

    private static final LocalDate FROM = LocalDate.of(2026, 4, 1);
    private static final LocalDate TO = LocalDate.of(2026, 4, 30);

    @MockitoBean
    private BookingStatistics bookings;

    @MockitoBean
    private MessageStatistics messages;

    @Autowired
    private StatisticsService statistics;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenEveryStatisticsRead_whenItQueriesTheDatabase_thenItsTransactionCarriesTheStatementTimeout() {
        // given
        Map<String, String> seen = new LinkedHashMap<>();
        when(bookings.firstBookingOn()).thenAnswer(call -> {
            seen.put("range", statementTimeout());
            return Optional.empty();
        });
        when(bookings.utilisation(any(), any())).thenAnswer(call -> {
            seen.put("utilisation", statementTimeout());
            return null;
        });
        when(bookings.bookingFigures(any(), any())).thenAnswer(call -> {
            seen.put("bookings", statementTimeout());
            return null;
        });
        when(bookings.activeMembers(any(), any())).thenAnswer(call -> {
            seen.put("members", statementTimeout());
            return 0L;
        });
        when(messages.queuedBetween(any(), any())).thenAnswer(call -> {
            seen.put("messages", statementTimeout());
            return List.of();
        });

        // when
        statistics.range();
        statistics.utilisation(FROM, TO);
        statistics.bookings(FROM, TO);
        statistics.members(FROM, TO);
        statistics.messages(FROM, TO);

        // then
        assertThat(seen).as("every read runs its statements under the 30-second timeout").isEqualTo(Map.of(
                "range", "30s", "utilisation", "30s", "bookings", "30s", "members", "30s", "messages", "30s"));
        assertThat(statementTimeout()).as("the timeout is local to the read's transaction").isEqualTo("0");
    }

    @Test
    void givenAStatementThatOutrunsTheTimeout_whenReadingStatistics_thenTheAnswerIsATypedProblemWithoutSql()
            throws Exception {
        // given
        when(bookings.firstBookingOn()).thenAnswer(call -> {
            jdbc.sql("SET LOCAL statement_timeout = '50ms'").update();
            jdbc.sql("SELECT pg_sleep(2)").query(String.class).single();
            return Optional.empty();
        });

        // when
        String body = mockMvc.perform(get("/api/admin/statistics/range"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:statement-timeout"))
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(body).as("a cancelled statement is never quoted to the client")
                .doesNotContain("pg_sleep", "SELECT", "57014");
    }

    private String statementTimeout() {
        return jdbc.sql("SHOW statement_timeout").query(String.class).single();
    }
}
