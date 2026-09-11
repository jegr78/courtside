package org.courtside;

import org.courtside.facility.testfixture.FacilityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
@Import(FacilityTestFixture.class)
class RequestInputTypeSurfaceTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityTestFixture facilityFixture;

    private MockMvc mockMvc;
    private UUID courtId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        courtId = facilityFixture.createCourt(1, "Court 1");
    }

    @Test
    void givenAWholeNumberWrittenAsText_whenUpdatingACourt_thenTheTypeIsRefusedRatherThanRead()
            throws Exception {
        // when / then
        refusedAsATypeMismatch(court("{\"number\":\"3\"}"), "number");
    }

    @Test
    void givenAFractionalNumberForAWholeOne_whenUpdatingACourt_thenTheTypeIsRefusedRatherThanTruncated()
            throws Exception {
        // when / then
        refusedAsATypeMismatch(court("{\"number\":3.0}"), "number");
    }

    @Test
    void givenATruthWrittenAsText_whenSettingACourtActive_thenTheTypeIsRefusedRatherThanRead()
            throws Exception {
        // when / then
        refusedAsATypeMismatch(activeCourt("{\"active\":\"true\"}"), "active");
    }

    @Test
    void givenANumberForATruth_whenSettingACourtActive_thenTheTypeIsRefusedRatherThanRead()
            throws Exception {
        // when / then
        refusedAsATypeMismatch(activeCourt("{\"active\":1}"), "active");
    }

    @Test
    void givenTheTypesTheDocumentDeclares_whenUpdatingACourt_thenTheRequestIsAccepted() throws Exception {
        // when / then
        court("{\"number\":3,\"name\":\"Court 3\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.number").value(3))
                .andExpect(jsonPath("$.name").value("Court 3"));
        activeCourt("{\"active\":false}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));
    }

    private ResultActions court(String body) throws Exception {
        return mockMvc.perform(put("/api/admin/courts/" + courtId)
                .contentType(MediaType.APPLICATION_JSON).content(body).with(csrf()));
    }

    private ResultActions activeCourt(String body) throws Exception {
        return mockMvc.perform(put("/api/admin/courts/" + courtId + "/active")
                .contentType(MediaType.APPLICATION_JSON).content(body).with(csrf()));
    }

    private static void refusedAsATypeMismatch(ResultActions result, String field) throws Exception {
        result.andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value(field))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.TypeMismatch"));
    }
}
