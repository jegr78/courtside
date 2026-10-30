package org.courtside.booking.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
@Import({FacilityTestFixture.class, AuditTestFixture.class})
class OccupancyKeyAdminControllerTest extends AbstractIntegrationTest {

    private static final String ADMIN_KEY = "/api/admin/occupancy-key";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private AuditTestFixture audit;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        facility.createCourt(1, "Court 1");
    }

    @Test
    void whenNoKeyWasEverCreated_thenTheStatusSaysSoAndEveryPollIsRefused() throws Exception {
        // when / then
        mockMvc.perform(get(ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.configured").value(false))
                .andExpect(jsonPath("$.createdAt").doesNotExist());
        mockMvc.perform(get("/api/public/occupancy").param("key", "anything-at-all"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().string(""));
    }

    @Test
    void whenABoardCreatesAKey_thenItIsShownOnceAndAnsweredByTheSignal() throws Exception {
        // when
        String created = mockMvc.perform(post(ADMIN_KEY).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.createdAt").value("2026-05-12T10:00:00Z"))
                .andReturn().getResponse().getContentAsString();
        String key = JsonPath.read(created, "$.key");

        // then
        assertThat(key).as("32 random bytes in base64url").matches("[A-Za-z0-9_-]{43}");
        String shown = mockMvc.perform(get(ADMIN_KEY))
                .andExpect(jsonPath("$.configured").value(true))
                .andExpect(jsonPath("$.createdAt").value("2026-05-12T10:00:00Z"))
                .andReturn().getResponse().getContentAsString();
        assertThat(shown).as("the status never repeats the key").doesNotContain(key);
        mockMvc.perform(get("/api/public/occupancy").param("key", key))
                .andExpect(status().isOk())
                .andExpect(content().string("court1.occupied=0\ncourt1.minutes=1440\n"));
        assertThat(audit.eventsOfType("booking.occupancyKey.created")).as("the creation is audited").hasSize(1)
                .allSatisfy(event -> assertThat(event.payload().toString()).doesNotContain(key));
    }

    @Test
    void givenAKey_whenTheBoardCreatesANewOne_thenTheOldOneStopsWorking() throws Exception {
        // given
        String first = issue();

        // when
        String second = issue();

        // then
        assertThat(second).isNotEqualTo(first);
        mockMvc.perform(get("/api/public/occupancy").param("key", first))
                .andExpect(status().isUnauthorized())
                .andExpect(content().string(""));
        mockMvc.perform(get("/api/public/occupancy").param("key", second)).andExpect(status().isOk());
        assertThat(audit.eventsOfType("booking.occupancyKey.created")).hasSize(2);
    }

    @Test
    void givenAKey_whenTheBoardRevokesIt_thenThePollIsRefusedAndTheRevocationAudited() throws Exception {
        // given
        String key = issue();

        // when
        mockMvc.perform(delete(ADMIN_KEY).with(csrf())).andExpect(status().isNoContent());

        // then
        mockMvc.perform(get(ADMIN_KEY)).andExpect(jsonPath("$.configured").value(false));
        mockMvc.perform(get("/api/public/occupancy").param("key", key))
                .andExpect(status().isUnauthorized())
                .andExpect(content().string(""));
        assertThat(audit.eventsOfType("booking.occupancyKey.revoked")).as("the revocation is audited").hasSize(1);
        assertThat(jdbc.sql("SELECT count(*) FROM occupancy_key").query(Long.class).single()).isZero();
    }

    @Test
    void givenNoKey_whenTheBoardRevokes_thenNothingIsRecorded() throws Exception {
        // when
        mockMvc.perform(delete(ADMIN_KEY).with(csrf())).andExpect(status().isNoContent());

        // then
        assertThat(audit.eventsOfType("booking.occupancyKey.revoked")).as("revoking nothing changes nothing")
                .isEqualTo(List.of());
    }

    private String issue() throws Exception {
        return JsonPath.read(mockMvc.perform(post(ADMIN_KEY).with(csrf()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(), "$.key");
    }
}
