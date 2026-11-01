package org.courtside.facility.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.access.testfixture.AccessTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.nullValue;
import static org.hamcrest.Matchers.emptyIterable;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
@Import({FacilityTestFixture.class, ConfigTestFixture.class, AccessTestFixture.class})
class AccessPointAdminControllerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private ConfigTestFixture config;

    @Autowired
    private AccessTestFixture access;

    private MockMvc mockMvc;
    private UUID courtOne;
    private UUID courtTwo;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        courtOne = facility.createCourt(1, "Court 1");
        courtTwo = facility.createCourt(2, "Court 2");
    }

    @Test
    void whenCreatingAnAccessPoint_thenItsLocationServesTheCourtsAndTheCode() throws Exception {
        // when
        MvcResult created = create("""
                {"name": "North gate", "courtIds": ["%s", "%s"], "staticCode": "123456"}
                """.formatted(courtOne, courtTwo))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.active").value(true))
                .andReturn();

        // then
        mockMvc.perform(get(created.getResponse().getHeader("Location")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("North gate"))
                .andExpect(jsonPath("$.courtIds", containsInAnyOrder(courtOne.toString(), courtTwo.toString())))
                .andExpect(jsonPath("$.staticCode").value("123456"));
        mockMvc.perform(get("/api/admin/access-points"))
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void givenAnAccessPoint_whenRenamingItAndReplacingCourtsAndCode_thenEveryFieldIsReplaced() throws Exception {
        // given
        String id = createdId("North gate", courtOne, "123456");

        // when
        change(id, """
                {"name": "South gate", "courtIds": ["%s"], "staticCode": "654321"}
                """.formatted(courtTwo))
                .andExpect(status().isOk());

        // then
        mockMvc.perform(get("/api/admin/access-points/" + id))
                .andExpect(jsonPath("$.name").value("South gate"))
                .andExpect(jsonPath("$.courtIds", containsInAnyOrder(courtTwo.toString())))
                .andExpect(jsonPath("$.staticCode").value("654321"));
    }

    @Test
    void givenAnAccessPointWithACode_whenChangedWithoutOne_thenTheCodeIsRemovedAndTheCourtsCanBeEmptied()
            throws Exception {
        // given
        String id = createdId("North gate", courtOne, "123456");

        // when
        change(id, """
                {"name": "North gate", "courtIds": []}
                """).andExpect(status().isOk());

        // then
        mockMvc.perform(get("/api/admin/access-points/" + id))
                .andExpect(jsonPath("$.staticCode").doesNotExist())
                .andExpect(jsonPath("$.courtIds", emptyIterable()));
    }

    @Test
    void givenAnAccessPoint_whenItIsDeactivatedAndActivatedAgain_thenTheFlagFollows() throws Exception {
        // given
        String id = createdId("North gate", courtOne, null);

        // when / then
        mockMvc.perform(put("/api/admin/access-points/" + id + "/active")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"active\": false}").with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));
        mockMvc.perform(put("/api/admin/access-points/" + id + "/active")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"active\": true}").with(csrf()))
                .andExpect(jsonPath("$.active").value(true));
    }

    @Test
    void givenAnUnknownCourt_whenCreatingAnAccessPoint_thenTheCourtIsNotFoundAndNothingIsStored() throws Exception {
        // when / then
        create("""
                {"name": "North gate", "courtIds": ["%s"]}
                """.formatted(UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:court-not-found"));
        mockMvc.perform(get("/api/admin/access-points"))
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void givenAnUnknownAccessPoint_whenReadingOrChangingIt_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/access-points/" + UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-point-not-found"));
        change(UUID.randomUUID().toString(), """
                {"name": "North gate", "courtIds": []}
                """)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-point-not-found"));
    }

    @Test
    void givenAnEmptyName_whenCreatingAnAccessPoint_thenTheFieldIsRefused() throws Exception {
        // when / then
        create("""
                {"name": "", "courtIds": []}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("name"));
    }

    @Test
    void givenANameOfUnicodeSpacesOnly_whenCreatingAnAccessPoint_thenTheServiceRefusesItByCode() throws Exception {
        // when / then
        create("""
                {"name": "%s", "courtIds": []}
                """.formatted("  "))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-point-rejected"))
                .andExpect(jsonPath("$.violations[0].code").value("facility.accessPoint.nameRequired"));
    }

    @Test
    void givenACodeOfTheWrongLength_whenCreatingAnAccessPoint_thenItIsRefusedWithoutEchoingTheCode()
            throws Exception {
        // when / then
        create("""
                {"name": "North gate", "courtIds": [], "staticCode": "13579"}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-point-rejected"))
                .andExpect(jsonPath("$.violations[0].code").value("facility.accessPoint.codeLength"))
                .andExpect(jsonPath("$.violations[0].params.digits").value(6))
                .andExpect(content().string(not(containsString("13579"))));
    }

    @Test
    void givenACodeWithALetter_whenCreatingAnAccessPoint_thenTheFieldIsRefused() throws Exception {
        // when / then
        create("""
                {"name": "North gate", "courtIds": [], "staticCode": "12a456"}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("staticCode"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"));
    }

    @Test
    void givenAStoredCode_whenTheClubShortensTheCodeLength_thenRenamingKeepsTheCodeButANewOneMustFit()
            throws Exception {
        // given
        String id = createdId("North gate", courtOne, "123456");
        config.requireAccessCodesOf(4);

        // when / then
        change(id, """
                {"name": "Main gate", "courtIds": ["%s"], "staticCode": "123456"}
                """.formatted(courtOne))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.staticCode").value("123456"));
        change(id, """
                {"name": "Main gate", "courtIds": ["%s"], "staticCode": "654321"}
                """.formatted(courtOne))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("facility.accessPoint.codeLength"))
                .andExpect(jsonPath("$.violations[0].params.digits").value(4));
        change(id, """
                {"name": "Main gate", "courtIds": ["%s"], "staticCode": "4321"}
                """.formatted(courtOne))
                .andExpect(status().isOk());
    }

    @Test
    void whenCreatingAnAccessPointWithACodeOpenToMembers_thenTheMarkIsStored() throws Exception {
        // when
        MvcResult created = create("""
                {"name": "Clubhouse door", "courtIds": [], "staticCode": "123456", "openToMembers": true}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.openToMembers").value(true))
                .andReturn();

        // then
        mockMvc.perform(get(created.getResponse().getHeader("Location")))
                .andExpect(jsonPath("$.openToMembers").value(true));
    }

    @Test
    void whenCreatingAnAccessPointOpenToMembersWithoutACode_thenItIsRefusedByName() throws Exception {
        // when / then
        create("""
                {"name": "Clubhouse door", "courtIds": [], "openToMembers": true}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-point-rejected"))
                .andExpect(jsonPath("$.violations[0].code").value("facility.accessPoint.openToMembersNeedsCode"))
                .andExpect(jsonPath("$.violations[0].params.field").value("openToMembers"));
    }

    @Test
    void givenAnAccessPointOpenToMembers_whenItsCodeIsCleared_thenItIsRefusedAndTheCodeStays() throws Exception {
        // given
        String id = JsonPath.read(create("""
                {"name": "Clubhouse door", "courtIds": [], "staticCode": "123456", "openToMembers": true}
                """).andReturn().getResponse().getContentAsString(), "$.id");

        // when / then
        change(id, """
                {"name": "Clubhouse door", "courtIds": [], "openToMembers": true}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("facility.accessPoint.openToMembersNeedsCode"));
        mockMvc.perform(get("/api/admin/access-points/" + id))
                .andExpect(jsonPath("$.staticCode").value("123456"))
                .andExpect(jsonPath("$.openToMembers").value(true));
    }

    @Test
    void whenCreatingAnAccessPointWithoutAStaticCodeButWithAnEmergencyCode_thenTheEmergencyCodeIsStored()
            throws Exception {
        // when
        MvcResult created = create("""
                {"name": "North gate", "courtIds": ["%s"], "emergencyCode": "975310"}
                """.formatted(courtOne))
                .andExpect(status().isCreated())
                .andReturn();

        // then
        mockMvc.perform(get(created.getResponse().getHeader("Location")))
                .andExpect(jsonPath("$.staticCode").doesNotExist())
                .andExpect(jsonPath("$.emergencyCode").value("975310"));
    }

    @Test
    void whenCreatingAnAccessPointWithAStaticAndAnEmergencyCode_thenTheEmergencyCodeIsRefusedByName()
            throws Exception {
        // when / then
        create("""
                {"name": "North gate", "courtIds": [], "staticCode": "123456", "emergencyCode": "975310"}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-point-rejected"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("facility.accessPoint.emergencyCodeNeedsDynamicCodes"))
                .andExpect(jsonPath("$.violations[0].params.field").value("emergencyCode"));
    }

    @Test
    void givenAStaticCodeElsewhere_whenAnEmergencyCodeRepeatsIt_thenItIsRefusedWithoutEchoingTheCode()
            throws Exception {
        // given
        createdId("Clubhouse door", courtTwo, "123456");

        // when / then
        create("""
                {"name": "North gate", "courtIds": [], "emergencyCode": "123456"}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-point-rejected"))
                .andExpect(jsonPath("$.violations[0].code").value("facility.accessPoint.emergencyCodeCollides"))
                .andExpect(jsonPath("$.violations[0].params.field").value("emergencyCode"))
                .andExpect(content().string(not(containsString("123456"))));
    }

    @Test
    void givenAnEmergencyCodeElsewhere_whenAStaticCodeRepeatsIt_thenTheStaticCodeIsRefused() throws Exception {
        // given
        create("""
                {"name": "North gate", "courtIds": [], "emergencyCode": "975310"}
                """).andExpect(status().isCreated());

        // when / then
        create("""
                {"name": "Clubhouse door", "courtIds": [], "staticCode": "975310"}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("facility.accessPoint.emergencyCodeCollides"))
                .andExpect(jsonPath("$.violations[0].params.field").value("staticCode"));
    }

    @Test
    void givenADynamicCodeADoorMayStillAccept_whenAnEmergencyCodeRepeatsIt_thenItIsRefusedWithoutEchoingTheCode()
            throws Exception {
        // given
        access.holdReleasedCode("975310", Instant.now().plus(1, ChronoUnit.HOURS));

        // when / then
        create("""
                {"name": "North gate", "courtIds": [], "emergencyCode": "975310"}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-point-rejected"))
                .andExpect(jsonPath("$.violations[0].code").value("facility.accessPoint.codeIssued"))
                .andExpect(jsonPath("$.violations[0].params.field").value("emergencyCode"))
                .andExpect(content().string(not(containsString("975310"))));
    }

    @Test
    void givenADynamicCodeADoorMayStillAccept_whenAChangedStaticCodeRepeatsIt_thenItIsRefused() throws Exception {
        // given
        String id = createdId("Clubhouse door", courtTwo, "123456");
        access.holdReleasedCode("246802", Instant.now().plus(1, ChronoUnit.HOURS));

        // when / then
        change(id, """
                {"name": "Clubhouse door", "courtIds": ["%s"], "staticCode": "246802"}
                """.formatted(courtTwo))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("facility.accessPoint.codeIssued"))
                .andExpect(jsonPath("$.violations[0].params.field").value("staticCode"));
    }

    @Test
    void givenAnEmergencyCode_whenItIsOfTheWrongLength_thenItIsRefusedByItsField() throws Exception {
        // when / then
        create("""
                {"name": "North gate", "courtIds": [], "emergencyCode": "97531"}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("facility.accessPoint.codeLength"))
                .andExpect(jsonPath("$.violations[0].params.field").value("emergencyCode"));
    }

    @Test
    void givenAnAccessPoint_whenCreatingAnotherWithTheSameName_thenItIsAConflict() throws Exception {
        // given
        createdId("North gate", courtOne, null);

        // when / then
        create("""
                {"name": "North gate", "courtIds": []}
                """)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-point-name-taken"));
    }

    @Test
    void givenALoxoneGroup_whenCreatingAndClearingIt_thenTheAccessPointCarriesItUntilNull() throws Exception {
        // given
        String id = JsonPath.read(create("""
                {"name": "North gate", "courtIds": [], "loxoneGroup": "0f1e2d3c-4b5a-6978-8796a5b4c3d2e1f0"}
                """).andExpect(status().isCreated())
                .andExpect(jsonPath("$.loxoneGroup").value("0f1e2d3c-4b5a-6978-8796a5b4c3d2e1f0"))
                .andReturn().getResponse().getContentAsString(), "$.id");

        // when
        change(id, """
                {"name": "North gate", "courtIds": [], "loxoneGroup": null}
                """).andExpect(status().isOk());

        // then
        mockMvc.perform(get("/api/admin/access-points/" + id))
                .andExpect(jsonPath("$.loxoneGroup").value(nullValue()));
    }

    @Test
    void givenAMalformedLoxoneGroup_whenCreatingAnAccessPoint_thenTheFieldIsRefusedBeforeTheDatabase() throws Exception {
        // when / then
        create("""
                {"name": "North gate", "courtIds": [], "loxoneGroup": "0F1E2D3C-4B5A-6978-8796A5B4C3D2E1F0"}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("loxoneGroup"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"));
        mockMvc.perform(get("/api/admin/access-points")).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMember_whenListingAccessPoints_thenItIsForbidden() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/access-points"))
                .andExpect(status().isForbidden());
    }

    private ResultActions create(String body) throws Exception {
        return mockMvc.perform(post("/api/admin/access-points")
                .contentType(MediaType.APPLICATION_JSON).content(body).with(csrf()));
    }

    private ResultActions change(String id, String body) throws Exception {
        return mockMvc.perform(put("/api/admin/access-points/" + id)
                .contentType(MediaType.APPLICATION_JSON).content(body).with(csrf()));
    }

    private String createdId(String name, UUID courtId, String code) throws Exception {
        String body = create("""
                {"name": "%s", "courtIds": ["%s"], "staticCode": %s}
                """.formatted(name, courtId, code == null ? "null" : "\"" + code + "\""))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.id");
    }
}
