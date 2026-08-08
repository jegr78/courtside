package org.courtside.member.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Ordered on purpose: the second test only proves anything if the first one has already run and
// left the seeded row deactivated. AbstractIntegrationTest.restoreMembershipTypes runs in both
// @BeforeEach and @AfterEach, so either boundary between these two methods would catch a
// regression to delete-only restore.
@WithMockUser(username = "admin", roles = "ADMIN")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class MembershipTypeSeedRestoreTest extends AbstractIntegrationTest {

    private static final String SEEDED_MEMBERSHIP_TYPE = "cccccccc-0000-0000-0000-000000000001";

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    @Order(1)
    void givenTheSeededMembershipType_whenDeactivatingItDirectly_thenItReportsInactive() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/membership-types/" + SEEDED_MEMBERSHIP_TYPE + "/active")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));
    }

    @Test
    @Order(2)
    void givenTheSeededMembershipTypeWasDeactivatedByAnEarlierTest_whenListingIt_thenItIsActiveAgain()
            throws Exception {
        // when
        String body = mockMvc.perform(get("/api/admin/membership-types"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // then
        List<Boolean> active = JsonPath.read(
                body, "$[?(@.id=='" + SEEDED_MEMBERSHIP_TYPE + "')].active");
        assertThat(active).containsExactly(true);
    }
}
