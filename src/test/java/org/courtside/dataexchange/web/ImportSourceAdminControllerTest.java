package org.courtside.dataexchange.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ImportSourceAdminControllerTest extends AbstractIntegrationTest {

    private static final String ACTIVE_TYPE = "cccccccc-0000-0000-0000-000000000001";

    private static final String COMPLETE = """
            {"sourceKey":"roster-system","displayName":"Membership system","separator":";",
             "columns":{"Member number":"EXTERNAL_ID","First name":"FIRST_NAME",
                        "Last name":"LAST_NAME","Email":"EMAIL"},
             "membershipTypes":{"A":"%s"},
             "defaultMembershipTypeId":"%s",
             "ownedFields":["FIRST_NAME","LAST_NAME"],
             "removalWarningPercent":10}
            """.formatted(ACTIVE_TYPE, ACTIVE_TYPE);

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void whenASourceIsCreated_thenItIsAddressableAndReadsBackWhole() throws Exception {
        // when
        String body = mockMvc.perform(create(COMPLETE))
                .andExpect(status().isCreated())
                .andExpect(header().exists("Location"))
                .andExpect(jsonPath("$.sourceKey").value("roster-system"))
                .andExpect(jsonPath("$.separator").value(";"))
                .andExpect(jsonPath("$.columns['Member number']").value("EXTERNAL_ID"))
                .andExpect(jsonPath("$.membershipTypes.A").value(ACTIVE_TYPE))
                .andExpect(jsonPath("$.ownedFields.length()").value(2))
                .andExpect(jsonPath("$.removalWarningPercent").value(10))
                .andReturn().getResponse().getContentAsString();

        // then
        String id = JsonPath.read(body, "$.id");
        mockMvc.perform(get("/api/admin/import/sources/{id}", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Membership system"))
                .andExpect(jsonPath("$.separator").value(";"));
        mockMvc.perform(get("/api/admin/import/sources"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenASourceConfiguredWrongly_whenEveryPartIsCorrected_thenTheAnswerCarriesTheCorrection()
            throws Exception {
        // given
        String id = JsonPath.read(mockMvc.perform(create(COMPLETE))
                .andReturn().getResponse().getContentAsString(), "$.id");

        // when / then
        mockMvc.perform(put("/api/admin/import/sources/{id}", id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"sourceKey":"club-registry","displayName":"The other system","separator":"\\t",
                                 "columns":{"No.":"EXTERNAL_ID","Given":"FIRST_NAME",
                                            "Family":"LAST_NAME","Mail":"EMAIL"},
                                 "membershipTypes":{},
                                 "defaultMembershipTypeId":"cccccccc-0000-0000-0000-000000000001",
                                 "ownedFields":["EMAIL"],
                                 "removalWarningPercent":25}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sourceKey").value("club-registry"))
                .andExpect(jsonPath("$.separator").value("\t"))
                .andExpect(jsonPath("$.columns.Mail").value("EMAIL"))
                .andExpect(jsonPath("$.membershipTypes.length()").value(0))
                .andExpect(jsonPath("$.ownedFields[0]").value("EMAIL"))
                .andExpect(jsonPath("$.removalWarningPercent").value(25));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAColumnMappingWithoutTheMemberNumber_whenCreatingASource_thenTheReasonIsNamed()
            throws Exception {
        // when / then
        mockMvc.perform(create("""
                        {"sourceKey":"roster-system","displayName":"Membership system","separator":";",
                         "columns":{"First name":"FIRST_NAME","Last name":"LAST_NAME"},
                         "defaultMembershipTypeId":"cccccccc-0000-0000-0000-000000000001",
                         "removalWarningPercent":10}
                        """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:import-source-invalid"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("import.source.columns.incomplete"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAKeyAnotherSourceHolds_whenCreatingASecond_thenTheConflictIsNamed() throws Exception {
        // given
        mockMvc.perform(create(COMPLETE)).andExpect(status().isCreated());

        // when / then
        mockMvc.perform(create(COMPLETE))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:import-source-key-taken"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAKeyTheContractRefuses_whenCreatingASource_thenTheContractAnswersFirst()
            throws Exception {
        // when / then
        mockMvc.perform(create(COMPLETE.replace("\"roster-system\"", "\"Roster System\"")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("sourceKey"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAThresholdAboveTheScale_whenCreatingASource_thenTheContractAnswersFirst()
            throws Exception {
        // when / then
        mockMvc.perform(create(COMPLETE.replace("\"removalWarningPercent\":10",
                        "\"removalWarningPercent\":101")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("removalWarningPercent"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Max"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUnknownSource_whenReadingIt_thenItIsReportedAsNotFound() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/import/sources/{id}", UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:import-source-not-found"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPathWithoutAUuid_whenReadingASource_thenTheParameterIsNamed() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/import/sources/{id}", "not-a-uuid"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:parameter-type-mismatch"))
                .andExpect(jsonPath("$.violations[0].params.parameter").value("id"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenASourceNothingHangsOff_whenItIsDeleted_thenItIsGone() throws Exception {
        // given
        String id = JsonPath.read(mockMvc.perform(create(COMPLETE))
                .andReturn().getResponse().getContentAsString(), "$.id");

        // when
        mockMvc.perform(delete("/api/admin/import/sources/{id}", id).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/admin/import/sources/{id}", id))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:import-source-not-found"));
    }

    @Test
    void givenNoSession_whenListingSources_thenItIsUnauthenticated() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/import/sources"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMemberSession_whenListingSources_thenItIsDenied() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/import/sources"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    private static org.springframework.test.web.servlet.RequestBuilder create(String body) {
        return post("/api/admin/import/sources")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .with(csrf());
    }
}
