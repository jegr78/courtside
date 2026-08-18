package org.courtside.dataexchange.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.dataexchange.CanonicalField;
import org.courtside.dataexchange.ImportSourceService;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.net.URI;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ExternalReferenceAdminControllerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private ImportSourceService sources;

    @Autowired
    private PersonRepository persons;

    private MockMvc mockMvc;

    private UUID source;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        source = sources.create("roster-system", "Membership system",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME),
                Map.of(), Set.of(), 10).sourceId();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void whenARecordIsLinked_thenItIsAddressableAndAppearsInThePage() throws Exception {
        // given
        UUID jane = person("Jane", "Doe");

        // when
        mockMvc.perform(link("4711", jane))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location",
                        "/api/admin/import/sources/" + source + "/references/4711"))
                .andExpect(jsonPath("$.externalId").value("4711"))
                .andExpect(jsonPath("$.personId").value(jane.toString()))
                .andExpect(jsonPath("$.linkedAt").exists());

        // then
        mockMvc.perform(get("/api/admin/import/sources/{sourceId}/references", source))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.references.length()").value(1))
                .andExpect(jsonPath("$.references[0].externalId").value("4711"))
                .andExpect(jsonPath("$.nextCursor").doesNotExist());
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenMoreRecordsThanThePageHolds_whenPaging_thenTheCursorContinuesInMemberNumberOrder()
            throws Exception {
        // given
        mockMvc.perform(link("4711", person("Jane", "Doe"))).andExpect(status().isCreated());
        mockMvc.perform(link("4712", person("John", "Roe"))).andExpect(status().isCreated());

        // when
        String first = mockMvc.perform(get("/api/admin/import/sources/{sourceId}/references", source)
                        .param("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.references[0].externalId").value("4711"))
                .andReturn().getResponse().getContentAsString();

        // then
        String cursor = JsonPath.read(first, "$.nextCursor");
        mockMvc.perform(get("/api/admin/import/sources/{sourceId}/references", source)
                        .param("limit", "1").param("cursor", cursor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.references[0].externalId").value("4712"))
                .andExpect(jsonPath("$.nextCursor").doesNotExist());
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenACursorThisSourceDoesNotHold_whenPaging_thenItIsReportedRatherThanEndingTheList()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/import/sources/{sourceId}/references", source)
                        .param("cursor", UUID.randomUUID().toString()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:import-external-reference-not-found"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAMemberNumberHeldByOnePerson_whenLinkingItToAnother_thenTheConflictIsNamed()
            throws Exception {
        // given
        mockMvc.perform(link("4711", person("Jane", "Doe"))).andExpect(status().isCreated());

        // when / then
        mockMvc.perform(link("4711", person("John", "Roe")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:import-external-id-taken"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonThisSourceKnows_whenLinkingASecondMemberNumber_thenTheConflictIsNamed()
            throws Exception {
        // given
        UUID jane = person("Jane", "Doe");
        mockMvc.perform(link("4711", jane)).andExpect(status().isCreated());

        // when / then
        mockMvc.perform(link("4712", jane))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:import-person-already-linked"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonThisInstanceDoesNotHold_whenLinking_thenTheReasonIsNamed() throws Exception {
        // when / then
        mockMvc.perform(link("4711", UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:import-person-not-found"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenABlankMemberNumber_whenLinking_thenTheContractAnswersFirst() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/import/sources/{sourceId}/references", source)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"externalId\":\"   \",\"personId\":\""
                                + person("Jane", "Doe") + "\"}")
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("externalId"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenALinkedRecord_whenItIsUnlinked_thenTheReferenceIsGoneAndThePersonRemains()
            throws Exception {
        // given
        UUID jane = person("Jane", "Doe");
        mockMvc.perform(link("4711", jane)).andExpect(status().isCreated());

        // when
        mockMvc.perform(delete("/api/admin/import/sources/{sourceId}/references/{externalId}",
                        source, "4711").with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/admin/import/sources/{sourceId}/references", source))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.references.length()").value(0));
        assertThat(persons.findById(jane)).isPresent();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAMemberNumberCarryingASpace_whenItIsLinked_thenTheLocationAddressesIt()
            throws Exception {
        // given
        String location = mockMvc.perform(link("A 1234", person("Jane", "Doe")))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getHeader("Location");

        // when / then
        mockMvc.perform(delete(URI.create(location)).with(csrf()))
                .andExpect(status().isNoContent());
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAMemberNumberNoReferenceCanHold_whenUnlinking_thenItIsReportedAsNotFound()
            throws Exception {
        // when / then
        mockMvc.perform(delete(URI.create("/api/admin/import/sources/" + source
                        + "/references/%20")).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:import-external-reference-not-found"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenNoSuchReference_whenUnlinking_thenItIsReportedAsNotFound() throws Exception {
        // when / then
        mockMvc.perform(delete("/api/admin/import/sources/{sourceId}/references/{externalId}",
                        source, "4711").with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:import-external-reference-not-found"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenASourceARecordPointsAt_whenDeletingIt_thenTheConflictIsNamedAndTheLinkStands()
            throws Exception {
        // given
        mockMvc.perform(link("4711", person("Jane", "Doe"))).andExpect(status().isCreated());

        // when
        mockMvc.perform(delete("/api/admin/import/sources/{id}", source).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:import-source-in-use"));

        // then
        mockMvc.perform(get("/api/admin/import/sources/{sourceId}/references", source))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.references.length()").value(1));
    }

    @Test
    void givenNoSession_whenListingReferences_thenItIsUnauthenticated() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/import/sources/{sourceId}/references", source))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMemberSession_whenListingReferences_thenItIsDenied() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/import/sources/{sourceId}/references", source))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    private RequestBuilder link(String externalId, UUID personId) {
        return post("/api/admin/import/sources/{sourceId}/references", source)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"externalId\":\"" + externalId + "\",\"personId\":\"" + personId + "\"}")
                .with(csrf());
    }

    private UUID person(String firstName, String lastName) {
        return persons.save(new Person(firstName, lastName,
                firstName.toLowerCase() + "." + lastName.toLowerCase() + "@example.org")).getId();
    }
}
