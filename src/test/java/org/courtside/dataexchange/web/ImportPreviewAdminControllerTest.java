package org.courtside.dataexchange.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.dataexchange.CanonicalField;
import org.courtside.dataexchange.ExternalReferenceService;
import org.courtside.dataexchange.ImportSourceService;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.MemberRepository;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({IdentityTestFixture.class, MemberTestFixture.class})
class ImportPreviewAdminControllerTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE_TYPE =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    private static final UUID MEMBERSHIP_TYPE_ID =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    private static final String THREE_ROWS = """
            Member number,First name,Last name,Email
            4711,Jane,Doe,jane.doe@example.org
            4712,John,Roe,john.roe@example.org
            4713,Mary,Major,mary.major@example.org
            """;

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private ImportSourceService sources;

    @Autowired
    private ExternalReferenceService references;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private MemberRepository members;

    @Autowired
    private MemberTestFixture memberFixture;

    private MockMvc mockMvc;

    private UUID source;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        source = sources.create("roster-system", "Membership system",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME,
                        "Email", CanonicalField.EMAIL),
                Map.of(), ACTIVE_TYPE, Set.of(CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME), 10).sourceId();
        UUID admin = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        identity.createAccount(admin, "admin", Set.of(Role.ADMIN));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAFileOfPeopleThisSourceHasNotSeen_whenPreviewing_thenEveryRowIsACreationAndNothingIsWritten()
            throws Exception {
        // when
        String body = mockMvc.perform(upload(THREE_ROWS, "FULL_SNAPSHOT"))
                .andExpect(status().isCreated())
                .andExpect(header().exists("Location"))
                .andExpect(jsonPath("$.rowCount").value(3))
                .andExpect(jsonPath("$.changes.length()").value(3))
                .andExpect(jsonPath("$.changes[0].kind").value("CREATE"))
                .andExpect(jsonPath("$.rowErrors.length()").value(0))
                .andExpect(jsonPath("$.removals.count").value(0))
                .andExpect(jsonPath("$.needsConfirmation").value(false))
                .andExpect(jsonPath("$.superseded").value(false))
                .andReturn().getResponse().getContentAsString();

        // then
        assertThatTheRosterIsUntouched();
        String previewId = JsonPath.read(body, "$.previewId");
        mockMvc.perform(get("/api/admin/import/previews/{id}", previewId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fileName").value("roster.csv"))
                .andExpect(jsonPath("$.changes.length()").value(3));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenTheSameFileTwice_whenPreviewing_thenBothPreviewsCarryTheSameHashAndTheOlderIsSuperseded()
            throws Exception {
        // given
        String first = mockMvc.perform(upload(THREE_ROWS, "FULL_SNAPSHOT"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        // when
        String second = mockMvc.perform(upload(THREE_ROWS, "FULL_SNAPSHOT"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        // then
        String hash = JsonPath.read(first, "$.fileHash");
        assertThat(JsonPath.<String>read(second, "$.fileHash"))
                .isEqualTo(hash);
        assertThat(JsonPath.<String>read(second, "$.previewId"))
                .isNotEqualTo(JsonPath.<String>read(first, "$.previewId"));
        mockMvc.perform(get("/api/admin/import/previews/{id}", JsonPath.<String>read(first, "$.previewId")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.superseded").value(true));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAHeaderWithoutTheMemberNumber_whenPreviewing_thenTheMissingFieldIsNamed()
            throws Exception {
        // when / then
        mockMvc.perform(upload("First name,Last name\nJane,Doe\n", "FULL_SNAPSHOT"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:import-snapshot-unreadable"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("import.snapshot.header.missingField"))
                .andExpect(jsonPath("$.violations[0].params.missing")
                        .value(org.hamcrest.Matchers.containsInAnyOrder("EXTERNAL_ID")));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnExportCarryingNoAddresses_whenPreviewing_thenTheFileIsStillResolved()
            throws Exception {
        // when / then
        mockMvc.perform(upload("Member number,First name,Last name\n4711,Jane,Doe\n",
                        "FULL_SNAPSHOT"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.rowErrors").isEmpty())
                .andExpect(jsonPath("$.changes[0].externalId").value("4711"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenARowThatCannotBeRead_whenPreviewing_thenTheOtherRowsStillResolve() throws Exception {
        // when / then
        mockMvc.perform(upload("""
                        Member number,First name,Last name,Email
                        4711,Jane
                        4712,John,Roe,john.roe@example.org
                        """, "FULL_SNAPSHOT"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.rowCount").value(1))
                .andExpect(jsonPath("$.changes.length()").value(1))
                .andExpect(jsonPath("$.rowErrors.length()").value(1))
                .andExpect(jsonPath("$.rowErrors[0].rowNumber").value(1))
                .andExpect(jsonPath("$.rowErrors[0].code").value("import.snapshot.row.cellsMissing"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenALinkedMemberTheFileNoLongerCarries_whenPreviewingAFullSnapshot_thenTheirMembershipWouldEnd()
            throws Exception {
        // given
        UUID jane = memberLinkedAs("4711", "Jane", "Doe");

        // when / then
        mockMvc.perform(upload("Member number,First name,Last name,Email\n4712,John,Roe,john.roe@example.org\n", "FULL_SNAPSHOT"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.removals.count").value(1))
                .andExpect(jsonPath("$.removals.currentlyLinked").value(1))
                .andExpect(jsonPath("$.removals.percent").value(100))
                .andExpect(jsonPath("$.needsConfirmation").value(true))
                .andExpect(jsonPath("$.changes[?(@.kind == 'END_MEMBERSHIP')].personId")
                        .value(jane.toString()))
                .andExpect(jsonPath("$.changes[?(@.kind == 'END_MEMBERSHIP')].personName")
                        .value("Jane Doe"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenARowThatWouldCreateSomebody_whenPreviewing_thenItNamesNoPersonBecauseThereIsNoneYet()
            throws Exception {
        // when / then
        mockMvc.perform(upload(THREE_ROWS, "UPDATE_ONLY"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.changes[0].kind").value("CREATE"))
                .andExpect(jsonPath("$.changes[0].personName")
                        .value(org.hamcrest.Matchers.nullValue()));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenTheSameAbsenceInAnUpdateOnlyUpload_whenPreviewing_thenNoMembershipWouldEnd()
            throws Exception {
        // given
        memberLinkedAs("4711", "Jane", "Doe");

        // when / then
        mockMvc.perform(upload("Member number,First name,Last name,Email\n4712,John,Roe,john.roe@example.org\n", "UPDATE_ONLY"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.removals.count").value(0))
                .andExpect(jsonPath("$.needsConfirmation").value(false));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenARowNamingSomebodyTheRosterHolds_whenPreviewing_thenItIsReportedAsAPossibleDuplicate()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        mockMvc.perform(upload("Member number,First name,Last name,Email\n4711,Jane,Doe,jane.doe@example.org\n", "FULL_SNAPSHOT"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.changes[0].kind").value("CREATE"))
                .andExpect(jsonPath("$.possibleDuplicates.length()").value(1))
                .andExpect(jsonPath("$.possibleDuplicates[0].personId").value(jane.toString()))
                .andExpect(jsonPath("$.possibleDuplicates[0].personName").value("Jane Doe"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAColumnThisSourceDoesNotMap_whenPreviewing_thenItIsListedRatherThanDroppedSilently()
            throws Exception {
        // when / then
        mockMvc.perform(upload("""
                        Member number,First name,Last name,Email,IBAN
                        4711,Jane,Doe,jane.doe@example.org,XX00
                        """, "FULL_SNAPSHOT"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.ignoredColumns.length()").value(1))
                .andExpect(jsonPath("$.ignoredColumns[0]").value("IBAN"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUnknownSource_whenPreviewing_thenItIsReportedAsNotFound() throws Exception {
        // when / then
        mockMvc.perform(multipart("/api/admin/import/sources/{sourceId}/previews", UUID.randomUUID())
                        .file(new MockMultipartFile("file", "roster.csv", "text/csv",
                                THREE_ROWS.getBytes(StandardCharsets.UTF_8)))
                        .param("mode", "FULL_SNAPSHOT")
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:import-source-not-found"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUploadThatNamesNoFile_whenPreviewing_thenTheReasonIsNamedRatherThanFailing()
            throws Exception {
        // when / then
        mockMvc.perform(multipart("/api/admin/import/sources/{sourceId}/previews", source)
                        .file(new MockMultipartFile("file", "   ", "text/csv",
                                THREE_ROWS.getBytes(StandardCharsets.UTF_8)))
                        .param("mode", "FULL_SNAPSHOT")
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:import-snapshot-file-name-invalid"))
                .andExpect(jsonPath("$.violations[0].code").value("import.snapshot.fileNameUnusable"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPreviewTakenUnderOneThreshold_whenTheThresholdMoves_thenThePreviewStillAnswersAsReviewed()
            throws Exception {
        // given
        memberLinkedAs("4711", "Jane", "Doe");
        memberLinkedAs("4712", "John", "Roe");
        String body = mockMvc.perform(upload("""
                        Member number,First name,Last name,Email
                        4711,Jane,Doe,jane.doe@example.org
                        """, "FULL_SNAPSHOT"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.removals.percent").value(50))
                .andExpect(jsonPath("$.needsConfirmation").value(true))
                .andReturn().getResponse().getContentAsString();

        // when
        sources.change(source, "roster-system", "Membership system",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME,
                        "Email", CanonicalField.EMAIL),
                Map.of(), ACTIVE_TYPE,
                Set.of(CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME), 90);

        // then
        mockMvc.perform(get("/api/admin/import/previews/{id}", (String) JsonPath.read(body, "$.previewId")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.needsConfirmation").value(true));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPreviewNobodyTook_whenReadingIt_thenItIsReportedAsNotFound() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/import/previews/{id}", UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:import-preview-not-found"));
    }

    @Test
    void givenNoSession_whenPreviewing_thenItIsUnauthenticated() throws Exception {
        // when / then
        mockMvc.perform(upload(THREE_ROWS, "FULL_SNAPSHOT"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMemberSession_whenPreviewing_thenItIsDenied() throws Exception {
        // when / then
        mockMvc.perform(upload(THREE_ROWS, "FULL_SNAPSHOT"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    private RequestBuilder upload(String content, String mode) {
        return multipart("/api/admin/import/sources/{sourceId}/previews", source)
                .file(new MockMultipartFile("file", "roster.csv", "text/csv",
                        content.getBytes(StandardCharsets.UTF_8)))
                .param("mode", mode)
                .with(csrf());
    }

    private UUID memberLinkedAs(String externalId, String firstName, String lastName) {
        UUID personId = identity.createPerson(firstName, lastName,
                firstName.toLowerCase() + "." + lastName.toLowerCase() + "@example.org");
        memberFixture.assignMembership(personId, MEMBERSHIP_TYPE_ID);
        references.link(source, externalId, personId);
        return personId;
    }

    private void assertThatTheRosterIsUntouched() {
        assertThat(members.findAll()).isEmpty();
        assertThat(persons.findAll())
                .allSatisfy(person -> org.assertj.core.api.Assertions
                        .assertThat(person.getLastName()).isEqualTo("Miles"));
    }
}
