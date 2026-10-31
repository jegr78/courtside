package org.courtside.access.web;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.UUID;

import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
class AccessGrantAdminWithoutConnectorTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void anAdministrativeClient() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenNoConnector_whenTheBoardReadsTheOverview_thenItSaysSoAndListsNothing() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/access-grants"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.connector").value("none"))
                .andExpect(jsonPath("$.connected").value(false))
                .andExpect(jsonPath("$.probe").isEmpty())
                .andExpect(jsonPath("$.grants").isEmpty());
    }

    @Test
    void givenNoConnector_whenTheBoardReadsTheGroups_thenNoListIsOffered() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/access-control/groups"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listsGroups").value(false))
                .andExpect(jsonPath("$.groups.length()").value(0))
                .andExpect(jsonPath("$.readAt").value(nullValue()));
    }

    @Test
    void givenNoConnector_whenTheBoardRetriesAGrant_thenItIsRefusedWithItsOwnTypeAndCode() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/access-grants/{id}/retry", UUID.randomUUID()).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-control-not-connected"))
                .andExpect(jsonPath("$.violations[0].code").value("access.control.notConnected"));
    }

    @Test
    void givenNoConnector_whenTheBoardAsksForAConnectionCheck_thenItIsRefusedWithItsOwnTypeAndCode() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/access-control/check").with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-control-not-connected"))
                .andExpect(jsonPath("$.violations[0].code").value("access.control.notConnected"));
    }

    @Test
    void givenNoConnector_whenTheBoardReadsTheConnectionCheck_thenThereIsNone() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/access-control/check"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checkedAt").value(nullValue()))
                .andExpect(jsonPath("$.checks.length()").value(0));
    }

    @Test
    void givenNoConnector_whenTheBoardAsksForAProbe_thenItIsRefusedWithItsOwnTypeAndCode() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/access-grants/probe").with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-control-not-connected"))
                .andExpect(jsonPath("$.violations[0].code").value("access.control.notConnected"));
    }
}
