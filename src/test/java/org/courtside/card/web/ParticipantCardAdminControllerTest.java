package org.courtside.card.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.card.CardService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
class ParticipantCardAdminControllerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private CardService cardService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void whenCreatingAParticipantCardWithoutACapacity_thenItReportsNullAndIsUnlimited() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/participant-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Spare racket"}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.label").value("Spare racket"))
                .andExpect(jsonPath("$.capacity").doesNotExist())
                .andExpect(jsonPath("$.active").value(true));
    }

    @Test
    void whenCreatingAParticipantCard_thenTheLocationHeaderResolvesToTheCreatedCard() throws Exception {
        // given
        MvcResult created = mockMvc.perform(post("/api/admin/participant-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Spare racket", "capacity": 3}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn();
        String location = created.getResponse().getHeader("Location");
        String id = location.substring(location.lastIndexOf('/') + 1);

        // when / then
        mockMvc.perform(get(location))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.label").value("Spare racket"))
                .andExpect(jsonPath("$.capacity").value(3));
    }

    @Test
    void givenAnUnknownParticipantCard_whenGettingIt_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/participant-cards/" + UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:card-not-found"))
                .andExpect(jsonPath("$.title").value("Card not found"));
    }

    @Test
    void whenCreatingAParticipantCardWithCapacityOne_thenItReportsOne() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/participant-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Second ball machine", "capacity": 1}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.capacity").value(1));
    }

    @Test
    void whenCreatingAParticipantCardWithCapacityZero_thenItIsRejected() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/participant-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Broken card", "capacity": 0}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("capacity"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Min"))
                .andExpect(jsonPath("$.fieldErrors[0].params.value").value(1));
    }

    @Test
    void givenAParticipantCard_whenCreatingASecondWithTheSameLabel_thenItIsAConflict() throws Exception {
        // given
        createParticipantCard("Spare racket");

        // when / then
        mockMvc.perform(post("/api/admin/participant-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Spare racket"}
                                """)
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:card-label-taken"));
    }

    @Test
    void givenTwoParticipantCards_whenRenamingOneOntoTheOthersLabel_thenItIsAConflict() throws Exception {
        // given
        createParticipantCard("Spare racket");
        String id = createParticipantCard("Spare shuttlecock");

        // when / then
        mockMvc.perform(put("/api/admin/participant-cards/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Spare racket"}
                                """)
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:card-label-taken"));
    }

    @Test
    void givenADeactivatedParticipantCard_whenListing_thenTheAdminListStillShowsItButTheActiveListDoesNot()
            throws Exception {
        // given
        String body = mockMvc.perform(post("/api/admin/participant-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Extra ball machine", "capacity": 1}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(body, "$.id");

        // when
        mockMvc.perform(put("/api/admin/participant-cards/" + id + "/active")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));

        // then
        mockMvc.perform(get("/api/admin/participant-cards"))
                .andExpect(jsonPath("$[?(@.id=='" + id + "')]").isNotEmpty());
        assertThat(cardService.activeParticipantCards())
                .extracting(card -> card.getId().toString())
                .doesNotContain(id);
    }

    private String createParticipantCard(String label) throws Exception {
        String body = mockMvc.perform(post("/api/admin/participant-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "%s"}
                                """.formatted(label))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.id");
    }
}
