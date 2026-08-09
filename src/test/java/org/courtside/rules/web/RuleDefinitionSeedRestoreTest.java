package org.courtside.rules.web;

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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Ordered on purpose, as in MembershipTypeSeedRestoreTest: the second test needs the first to
// have changed the seeded definitions and deleted one of them.
@WithMockUser(username = "admin", roles = "ADMIN")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class RuleDefinitionSeedRestoreTest extends AbstractIntegrationTest {

    private static final String STANDARD_RULE_SET = "aaaaaaaa-0000-0000-0000-000000000001";

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    @Order(1)
    void givenTheSeededRuleSet_whenChangingOneDefinitionAndDeletingAnother_thenBothTakeEffect()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/rule-sets/" + STANDARD_RULE_SET + "/rules/ADVANCE_WINDOW")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"params": {"maxDays": 99}}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk());
        mockMvc.perform(delete("/api/admin/rule-sets/" + STANDARD_RULE_SET + "/rules/MAX_OPEN_BOOKINGS")
                        .with(csrf()))
                .andExpect(status().isNoContent());
    }

    @Test
    @Order(2)
    void givenTheSeededDefinitionsWereChangedByAnEarlierTest_whenListingThem_thenTheSeedIsBackInPlace()
            throws Exception {
        // when
        String body = mockMvc.perform(get("/api/admin/rule-sets/" + STANDARD_RULE_SET + "/rules"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // then
        List<Integer> maxDays = JsonPath.read(
                body, "$[?(@.ruleType=='ADVANCE_WINDOW')].params.maxDays");
        List<Integer> limit = JsonPath.read(
                body, "$[?(@.ruleType=='MAX_OPEN_BOOKINGS')].params.limit");
        assertThat(maxDays).containsExactly(7);
        assertThat(limit).containsExactly(2);
    }
}
