package org.courtside.member.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.courtside.member.MemberFixtures.MEMBER_SINCE;
import static org.courtside.member.MemberFixtures.memberSince;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import(IdentityTestFixture.class)
class RosterAdminControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBERSHIP_TYPE_ID = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID OTHER_MEMBERSHIP_TYPE_ID = UUID.fromString("cccccccc-0000-0000-0000-000000000002");

    private static final String EM_SPACE = Character.toString(0x2003);
    private static final String IDEOGRAPHIC_SPACE = Character.toString(0x3000);

    private static final String VALID_EMAIL = "mary.major@example.org";
    private static final String EMAIL_OF_121_CHARACTERS =
            "m".repeat(60) + "@" + "e".repeat(56) + ".org";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private MemberRepository members;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAMemberAndAChild_whenListingTheRoster_thenBothAppearAndOnlyTheMemberHasAnAccount()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID account = identity.createEnabledAccount(jane, "jane.doe", "hash", Set.of(Role.MEMBER));
        members.save(memberSince(jane, MEMBERSHIP_TYPE_ID));
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when / then
        mockMvc.perform(get("/api/admin/roster"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries.length()").value(2))
                .andExpect(jsonPath("$.nextCursor").doesNotExist())
                .andExpect(jsonPath("$.entries[0].personId").value(jane.toString()))
                .andExpect(jsonPath("$.entries[0].username").value("jane.doe"))
                .andExpect(jsonPath("$.entries[0].accountId").value(account.toString()))
                .andExpect(jsonPath("$.entries[0].enabled").value(true))
                .andExpect(jsonPath("$.entries[0].membershipTypeId").value(MEMBERSHIP_TYPE_ID.toString()))
                .andExpect(jsonPath("$.entries[0].roles[0]").value("MEMBER"))
                .andExpect(jsonPath("$.entries[1].personId").value(mary.toString()))
                .andExpect(jsonPath("$.entries[1].email").value("mary.major@example.org"))
                .andExpect(jsonPath("$.entries[1].username").doesNotExist())
                .andExpect(jsonPath("$.entries[1].accountId").doesNotExist())
                .andExpect(jsonPath("$.entries[1].enabled").value(false))
                .andExpect(jsonPath("$.entries[1].roles.length()").value(0));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenMorePeopleThanTheLimit_whenListingTheRoster_thenTheCursorNamesTheLastEntry()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when / then
        mockMvc.perform(get("/api/admin/roster").queryParam("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries.length()").value(1))
                .andExpect(jsonPath("$.entries[0].personId").value(jane.toString()))
                .andExpect(jsonPath("$.nextCursor").value(jane.toString()));
    }

    @Test
    void givenNoSession_whenListingTheRoster_thenItIsUnauthenticated() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/roster"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMemberSession_whenListingTheRoster_thenItIsDenied() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/roster"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenALimitAboveTheContractMaximum_whenListingTheRoster_thenItIsRejectedByTheContract()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/roster").queryParam("limit", "201"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("limit"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Max"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenACursorNamingSomebodyWhoIsGone_whenListingTheRoster_thenTheStaleCursorIsReported()
            throws Exception {
        // given
        identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        mockMvc.perform(get("/api/admin/roster").queryParam("cursor", UUID.randomUUID().toString()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:roster-cursor-unknown"))
                .andExpect(jsonPath("$.violations[0].code").value("roster.cursor.unknown"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAQueryLongerThanTheContractAllows_whenListingTheRoster_thenItIsRejectedByTheContract()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/roster").queryParam("query", "d".repeat(61)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("query"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Size"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void whenCreatingAPerson_thenTheResponseCarriesTheEntryAndItsLocation() throws Exception {
        // when
        MockHttpServletResponse response = mockMvc.perform(post("/api/admin/roster")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(personBody("Mary", "Major", VALID_EMAIL))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.firstName").value("Mary"))
                .andExpect(jsonPath("$.lastName").value("Major"))
                .andExpect(jsonPath("$.email").value("mary.major@example.org"))
                .andExpect(jsonPath("$.accountId").doesNotExist())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.roles.length()").value(0))
                .andReturn().getResponse();

        // then
        UUID personId = UUID.fromString(JsonPath.read(response.getContentAsString(), "$.personId"));
        assertThat(response.getHeader("Location")).isEqualTo("/api/admin/roster/" + personId);
        assertThat(persons.findById(personId)).get()
                .satisfies(person -> assertThat(person.getDisplayName()).isEqualTo("Mary Major"));
    }

    static Stream<Arguments> blankDetails() {
        return Stream.of(
                Arguments.of("firstName", personBody("   ", "Major", VALID_EMAIL)),
                Arguments.of("firstName", personBody(EM_SPACE, "Major", VALID_EMAIL)),
                Arguments.of("lastName", personBody("Mary", IDEOGRAPHIC_SPACE, VALID_EMAIL)),
                Arguments.of("email", personBody("Mary", "Major", "")));
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @MethodSource("blankDetails")
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAValueBlankByUnicodeOrEmpty_whenCreatingAPerson_thenTheContractNamesTheField(
            String field, String body) throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/roster")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value(field))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnEmailPaddedWithSpaces_whenCreatingAPerson_thenItIsAcceptedWithoutThatPadding()
            throws Exception {
        // when
        MockHttpServletResponse response = mockMvc.perform(post("/api/admin/roster")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(personBody("Mary", "Major", "  " + VALID_EMAIL + "  "))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.email").value(VALID_EMAIL))
                .andReturn().getResponse();

        // then
        UUID personId = UUID.fromString(JsonPath.read(response.getContentAsString(), "$.personId"));
        assertThat(persons.findById(personId)).get()
                .satisfies(person -> assertThat(person.getEmail()).isEqualTo(VALID_EMAIL));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenANameOfTheFullLengthAndPadding_whenCreatingAPerson_thenThePaddingIsNotCounted()
            throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/roster")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(personBody("M".repeat(60) + "  ", "Major", VALID_EMAIL))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.firstName").value("M".repeat(60)));
    }

    static Stream<Arguments> paddingTheStripperMustRemove() {
        return Stream.of(
                Arguments.of("noBreakSpace", Character.toString(0x00a0)),
                Arguments.of("figureSpace", Character.toString(0x2007)),
                Arguments.of("narrowNoBreakSpace", Character.toString(0x202f)),
                Arguments.of("byteOrderMark", Character.toString(0xfeff)),
                Arguments.of("emSpace", EM_SPACE),
                Arguments.of("ideographicSpace", IDEOGRAPHIC_SPACE));
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @MethodSource("paddingTheStripperMustRemove")
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenANamePaddedWithWhitespaceTheContractNames_whenCreatingAPerson_thenItIsRemoved(
            String label, String padding) throws Exception {
        // when
        MockHttpServletResponse response = mockMvc.perform(post("/api/admin/roster")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(personBody(padding + "Mary" + padding, "Major", VALID_EMAIL))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.firstName").value("Mary"))
                .andReturn().getResponse();

        // then
        UUID personId = UUID.fromString(JsonPath.read(response.getContentAsString(), "$.personId"));
        assertThat(persons.findById(personId)).get()
                .satisfies(person -> assertThat(person.getFirstName()).isEqualTo("Mary"));
    }

    static Stream<Arguments> namesHoldingALineBreak() {
        return Stream.of(
                Arguments.of("lineFeed", personBody("Mary\\nMajor", "Major", VALID_EMAIL)),
                Arguments.of("carriageReturn", personBody("Mary\\rMajor", "Major", VALID_EMAIL)));
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @MethodSource("namesHoldingALineBreak")
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenANameHoldingALineBreak_whenCreatingAPerson_thenTheContractRefusesIt(
            String label, String body) throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/roster")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("firstName"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"));
    }

    static Stream<Arguments> oversizedDetails() {
        return Stream.of(
                Arguments.of("firstName", personBody("M".repeat(61), "Major", VALID_EMAIL)),
                Arguments.of("lastName", personBody("Mary", "M".repeat(61), VALID_EMAIL)),
                Arguments.of("email", personBody("Mary", "Major", EMAIL_OF_121_CHARACTERS)));
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @MethodSource("oversizedDetails")
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAValueLongerThanTheContractAllows_whenCreatingAPerson_thenTheContractNamesTheField(
            String field, String body) throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/roster")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value(field))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Size"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnEmailWithoutAnAtSign_whenCreatingAPerson_thenTheContractNamesTheField()
            throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/roster")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(personBody("Mary", "Major", "nowhere"))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("email"))
                .andExpect(jsonPath("$.fieldErrors[0].code")
                        .value(org.hamcrest.Matchers.oneOf("validation.Email", "validation.Pattern")));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnAddressWithoutADottedDomain_whenAddingAPerson_thenTheContractAnswersFirst()
            throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/roster")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(personBody("Mary", "Major", "mary.major@localhost"))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("email"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenABlankFirstName_whenChangingAPerson_thenTheContractNamesTheField() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(personBody(EM_SPACE, "Doe", "jane.doe@example.org"))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("firstName"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPerson_whenChangingThem_thenTheResponseCarriesTheCorrection() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(personBody("Jane", "Major", "jane.major@example.org"))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.personId").value(jane.toString()))
                .andExpect(jsonPath("$.lastName").value("Major"))
                .andExpect(jsonPath("$.email").value("jane.major@example.org"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenPaddedDetails_whenChangingAPerson_thenTheyAreStoredWithoutThatPadding() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        String noBreakSpace = Character.toString(0x00a0);

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(personBody(noBreakSpace + "Jane", "Major ", "  jane.major@example.org  "))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.firstName").value("Jane"))
                .andExpect(jsonPath("$.lastName").value("Major"))
                .andExpect(jsonPath("$.email").value("jane.major@example.org"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUnknownPerson_whenChangingThem_thenTheResponseCarriesItsOwnType() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(personBody("Jane", "Doe", "jane.doe@example.org"))
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:person-not-found"));
    }

    @Test
    void givenNoSession_whenCreatingAPerson_thenItIsUnauthenticated() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/roster")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(personBody("Mary", "Major", VALID_EMAIL))
                        .with(csrf()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMemberSession_whenChangingAPerson_thenItIsDenied() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(personBody("Jane", "Major", "jane.major@example.org"))
                        .with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonWithoutAnAccount_whenCreatingOne_thenTheEntryCarriesItAndThePasswordIsNotStored()
            throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when
        mockMvc.perform(post("/api/admin/roster/{personId}/account", mary)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(accountBody("major.mary", "one-time-password", "MEMBER", "TRAINER"))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.personId").value(mary.toString()))
                .andExpect(jsonPath("$.username").value("major.mary"))
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.roles[0]").value("MEMBER"))
                .andExpect(jsonPath("$.roles[1]").value("TRAINER"));

        // then
        assertThat(accounts.findByUsername("major.mary")).get()
                .satisfies(account -> {
                    assertThat(account.isPasswordChangeRequired()).isTrue();
                    assertThat(account.getPasswordHash()).isNotEqualTo("one-time-password");
                });
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnAccountHoldingSeveralRoles_whenReadingIt_thenTheRolesAscendByName() throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when / then
        mockMvc.perform(post("/api/admin/roster/{personId}/account", mary)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(accountBody("major.mary", "one-time-password", "TRAINER", "ADMIN", "MEMBER"))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.roles[0]").value("ADMIN"))
                .andExpect(jsonPath("$.roles[1]").value("MEMBER"))
                .andExpect(jsonPath("$.roles[2]").value("TRAINER"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenATakenUsername_whenCreatingAnAccount_thenTheResponseCarriesItsOwnType() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        identity.createAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when / then
        mockMvc.perform(post("/api/admin/roster/{personId}/account", mary)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(accountBody("doe.jane", "one-time-password", "MEMBER"))
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:username-taken"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonHoldingAnAccount_whenCreatingASecondOne_thenTheResponseCarriesItsOwnType()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when / then
        mockMvc.perform(post("/api/admin/roster/{personId}/account", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(accountBody("doe.jane.second", "one-time-password", "MEMBER"))
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:person-account-exists"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUnknownPerson_whenCreatingAnAccount_thenTheResponseCarriesItsOwnType() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/roster/{personId}/account", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(accountBody("roe.john", "one-time-password", "MEMBER"))
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:person-not-found"));
    }

    static Stream<Arguments> accountsTheContractRefuses() {
        return Stream.of(
                Arguments.of("username", "validation.Pattern",
                        accountBody("Doe.Jane", "one-time-password", "MEMBER")),
                Arguments.of("username", "validation.Size",
                        accountBody("dj", "one-time-password", "MEMBER")),
                Arguments.of("oneTimePassword", "validation.Size",
                        accountBody("doe.jane", "eleven.char", "MEMBER")),
                Arguments.of("roles", "validation.SizeAtLeast",
                        accountBody("doe.jane", "one-time-password")));
    }

    @ParameterizedTest(name = "[{index}] {0} {1}")
    @MethodSource("accountsTheContractRefuses")
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnAccountTheContractRefuses_whenCreatingIt_thenTheContractNamesTheField(
            String field, String code, String body) throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        mockMvc.perform(post("/api/admin/roster/{personId}/account", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value(field))
                .andExpect(jsonPath("$.fieldErrors[0].code").value(code));
        assertThat(accounts.findByUsername("doe.jane")).isEmpty();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnAccount_whenItsRolesAreReplaced_thenTheEntryCarriesTheNewOnes() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createAccount(jane, "doe.jane", Set.of(Role.MEMBER, Role.ADMIN));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/roles", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"roles": ["MEMBER"]}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.roles.length()").value(1))
                .andExpect(jsonPath("$.roles[0]").value("MEMBER"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonWithoutAnAccount_whenChangingRoles_thenTheResponseCarriesItsOwnType()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/roles", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"roles": ["MEMBER"]}
                                """)
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:account-not-found"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnEnabledAccount_whenItIsDeactivated_thenTheEntryAndTheAccountSaySo() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID account = identity.createEnabledAccount(jane, "doe.jane", "hash", Set.of(Role.MEMBER));

        // when
        mockMvc.perform(put("/api/admin/roster/{personId}/account/active", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false));

        // then
        assertThat(accounts.findById(account)).get()
                .satisfies(stored -> assertThat(stored.isEnabled()).isFalse());
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenTheOnlyEnabledAdministrator_whenTheRoleIsTakenFromThem_thenTheInstanceKeepsIt()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID account = enabledAccount(jane, "doe.jane", Role.ADMIN);

        // when
        mockMvc.perform(put("/api/admin/roster/{personId}/account/roles", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"roles": ["MEMBER"]}
                                """)
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:last-administrator"))
                .andExpect(jsonPath("$.violations[0].code").value("roster.lastAdministrator"));

        // then
        assertThat(accounts.findById(account)).get()
                .satisfies(stored -> assertThat(stored.getRoles()).contains(Role.ADMIN));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenTheOnlyEnabledAdministrator_whenTheirAccountIsDisabled_thenTheInstanceKeepsThem()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID account = enabledAccount(jane, "doe.jane", Role.ADMIN);

        // when
        mockMvc.perform(put("/api/admin/roster/{personId}/account/active", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:last-administrator"))
                .andExpect(jsonPath("$.violations[0].code").value("roster.lastAdministrator"));

        // then
        assertThat(accounts.findById(account)).get()
                .satisfies(stored -> assertThat(stored.isEnabled()).isTrue());
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenASecondEnabledAdministrator_whenOneStepsDown_thenTheChangeStands() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID stepping = enabledAccount(jane, "doe.jane", Role.ADMIN);
        enabledAccount(mary, "major.mary", Role.ADMIN);

        // when
        mockMvc.perform(put("/api/admin/roster/{personId}/account/roles", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"roles": ["MEMBER"]}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.roles[0]").value("MEMBER"))
                .andExpect(jsonPath("$.roles.length()").value(1));

        // then
        assertThat(accounts.findById(stepping)).get()
                .satisfies(stored -> assertThat(stored.getRoles()).containsExactly(Role.MEMBER));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenADisabledSecondAdministrator_whenTheEnabledOneStepsDown_thenTheInstanceKeepsThem()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        enabledAccount(jane, "doe.jane", Role.ADMIN);
        identity.createAccount(mary, "major.mary", Set.of(Role.ADMIN));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/roles", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"roles": ["MEMBER"]}
                                """)
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:last-administrator"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMemberSession_whenCreatingAnAccount_thenItIsDenied() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        mockMvc.perform(post("/api/admin/roster/{personId}/account", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(accountBody("doe.jane", "one-time-password", "ADMIN"))
                        .with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
        assertThat(accounts.findByUsername("doe.jane")).isEmpty();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAMistypedUsername_whenItIsCorrected_thenTheEntryCarriesTheNewOne() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createAccount(jane, "doe.jaen", Set.of(Role.MEMBER));

        // when
        mockMvc.perform(put("/api/admin/roster/{personId}/account/username", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(usernameBody("doe.jane"))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.personId").value(jane.toString()))
                .andExpect(jsonPath("$.username").value("doe.jane"))
                .andExpect(jsonPath("$.roles[0]").value("MEMBER"));

        // then
        assertThat(accounts.findByUsername("doe.jaen")).isEmpty();
        assertThat(accounts.findByUsername("doe.jane")).isPresent();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenTheUsernameItAlreadyHolds_whenCorrectingIt_thenItIsAcceptedRatherThanConflicting()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/username", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(usernameBody("doe.jane"))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("doe.jane"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAUsernameAnotherAccountHolds_whenCorrectingIt_thenTheResponseCarriesItsOwnType()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        identity.createAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        identity.createAccount(mary, "major.mary", Set.of(Role.MEMBER));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/username", mary)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(usernameBody("doe.jane"))
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:username-taken"));
        assertThat(accounts.findByUsername("major.mary")).isPresent();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonWithoutAnAccount_whenCorrectingTheUsername_thenTheResponseCarriesItsOwnType()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/username", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(usernameBody("doe.jane"))
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:account-not-found"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUnknownPerson_whenCorrectingTheUsername_thenTheResponseCarriesItsOwnType()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/username", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(usernameBody("doe.jane"))
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:person-not-found"));
    }

    static Stream<Arguments> usernamesTheContractRefuses() {
        return Stream.of(
                Arguments.of("blank", "validation.Pattern", usernameBody("   ")),
                Arguments.of("unicodeBlank", "validation.Pattern", usernameBody(EM_SPACE.repeat(3))),
                Arguments.of("uppercase", "validation.Pattern", usernameBody("Doe.Jane")),
                Arguments.of("lineBreak", "validation.Pattern", usernameBody("doe.jane\\n")),
                Arguments.of("tooShort", "validation.Size", usernameBody("dj")),
                Arguments.of("tooLong", "validation.Size", usernameBody("d".repeat(61))),
                Arguments.of("absent", "validation.NotNull", "{}"));
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @MethodSource("usernamesTheContractRefuses")
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAUsernameTheContractRefuses_whenCorrectingIt_thenTheContractNamesTheField(
            String label, String code, String body) throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createAccount(jane, "doe.jaen", Set.of(Role.MEMBER));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/username", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("username"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value(code));
        assertThat(accounts.findByUsername("doe.jaen")).isPresent();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnAccount_whenItsPasswordIsReset_thenTheEntryCarriesItWithoutEchoingThePassword()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID account = identity.createEnabledAccount(jane, "doe.jane", "hash", Set.of(Role.MEMBER));

        // when
        String body = mockMvc.perform(put("/api/admin/roster/{personId}/account/password", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(passwordBody("second-one-time-password"))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("doe.jane"))
                .andExpect(jsonPath("$.enabled").value(true))
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(body)
                .as("the response is the roster entry and never carries the password back")
                .doesNotContain("second-one-time-password");
        assertThat(accounts.findById(account)).get()
                .satisfies(stored -> {
                    assertThat(stored.isPasswordChangeRequired()).isTrue();
                    assertThat(stored.getPasswordHash()).isNotEqualTo("hash");
                    assertThat(stored.getPasswordHash()).isNotEqualTo("second-one-time-password");
                });
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonWithoutAnAccount_whenResettingThePassword_thenTheResponseCarriesItsOwnType()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/password", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(passwordBody("second-one-time-password"))
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:account-not-found"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUnknownPerson_whenResettingThePassword_thenTheResponseCarriesItsOwnType()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/password", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(passwordBody("second-one-time-password"))
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:person-not-found"));
    }

    static Stream<Arguments> passwordsTheContractRefuses() {
        return Stream.of(
                Arguments.of("empty", "validation.Size", passwordBody("")),
                Arguments.of("elevenCharacters", "validation.Size", passwordBody("eleven.char")),
                Arguments.of("longerThanTheBound", "validation.Size", passwordBody("p".repeat(201))),
                Arguments.of("absent", "validation.NotNull", "{}"));
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @MethodSource("passwordsTheContractRefuses")
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPasswordTheContractRefuses_whenResettingIt_thenTheContractNamesTheField(
            String label, String code, String body) throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID account = identity.createAccount(jane, "doe.jane", "hash", Set.of(Role.MEMBER));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/password", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("oneTimePassword"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value(code));
        assertThat(accounts.findById(account)).get()
                .satisfies(stored -> assertThat(stored.getPasswordHash()).isEqualTo("hash"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMemberSession_whenCorrectingAUsername_thenItIsDenied() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createAccount(jane, "doe.jaen", Set.of(Role.MEMBER));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/username", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(usernameBody("doe.jane"))
                        .with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
        assertThat(accounts.findByUsername("doe.jaen")).isPresent();
    }

    @Test
    void givenNoSession_whenResettingAPassword_thenItIsUnauthenticated() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID account = identity.createAccount(jane, "doe.jane", "hash", Set.of(Role.MEMBER));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/password", jane)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(passwordBody("second-one-time-password"))
                        .with(csrf()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
        assertThat(accounts.findById(account)).get()
                .satisfies(stored -> assertThat(stored.getPasswordHash()).isEqualTo("hash"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonWithoutAMembership_whenOneIsAssigned_thenTheEntryAndTheRosterCarryIt()
            throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when
        mockMvc.perform(put("/api/admin/roster/{personId}/membership", mary)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(membershipBody(MEMBERSHIP_TYPE_ID.toString()))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.personId").value(mary.toString()))
                .andExpect(jsonPath("$.membershipTypeId").value(MEMBERSHIP_TYPE_ID.toString()));

        // then
        mockMvc.perform(get("/api/admin/roster"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].membershipTypeId")
                        .value(MEMBERSHIP_TYPE_ID.toString()));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonOnTheWrongType_whenAnotherIsAssigned_thenTheyHoldOnlyTheNewOne()
            throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        members.save(memberSince(mary, MEMBERSHIP_TYPE_ID));

        // when
        mockMvc.perform(put("/api/admin/roster/{personId}/membership", mary)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(membershipBody(OTHER_MEMBERSHIP_TYPE_ID.toString()))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membershipTypeId").value(OTHER_MEMBERSHIP_TYPE_ID.toString()));

        // then
        assertThat(members.findByPersonIdIn(List.of(mary)))
                .singleElement()
                .satisfies(member -> assertThat(member.getMembershipTypeId())
                        .isEqualTo(OTHER_MEMBERSHIP_TYPE_ID));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenADeactivatedMembershipType_whenAssigningIt_thenTheResponseCarriesItsOwnType()
            throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        mockMvc.perform(put("/api/admin/membership-types/{id}/active", MEMBERSHIP_TYPE_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk());

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/membership", mary)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(membershipBody(MEMBERSHIP_TYPE_ID.toString()))
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:membership-type-inactive"))
                .andExpect(jsonPath("$.violations[0].code").value("membershipType.inactive"))
                .andExpect(jsonPath("$.violations[0].params.field").value("membershipTypeId"));
        assertThat(members.findByPersonIdIn(List.of(mary))).isEmpty();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUnknownMembershipType_whenAssigningIt_thenTheResponseCarriesItsOwnType()
            throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/membership", mary)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(membershipBody(UUID.randomUUID().toString()))
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:membership-type-not-found"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUnknownPerson_whenAssigningAMembership_thenTheResponseCarriesItsOwnType()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/membership", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(membershipBody(MEMBERSHIP_TYPE_ID.toString()))
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:person-not-found"));
    }

    static Stream<Arguments> membershipsTheContractRefuses() {
        return Stream.of(
                Arguments.of("absent", "validation.NotNull", "{}"),
                Arguments.of("null", "validation.NotNull", membershipBody(null)),
                Arguments.of("notAUuid", "validation.TypeMismatch", membershipBody("nothing")),
                Arguments.of("blank", "validation.NotNull", membershipBody("   ")));
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @MethodSource("membershipsTheContractRefuses")
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAMembershipTypeIdTheContractRefuses_whenAssigningIt_thenTheContractNamesTheField(
            String label, String code, String body) throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/membership", mary)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("membershipTypeId"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value(code));
        assertThat(members.findByPersonIdIn(List.of(mary))).isEmpty();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonIdThatIsNotAUuid_whenAssigningAMembership_thenTheContractRefusesIt()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/membership", "nobody")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(membershipBody(MEMBERSHIP_TYPE_ID.toString()))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:parameter-type-mismatch"))
                .andExpect(jsonPath("$.violations[0].params.parameter").value("personId"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAMembership_whenItIsEnded_thenTheEntryReportsTheDateItEnded() throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        members.save(memberSince(mary, MEMBERSHIP_TYPE_ID));

        // when
        mockMvc.perform(delete("/api/admin/roster/{personId}/membership", mary)
                        .with(csrf()))
                .andExpect(status().isNoContent());

        // then
        assertThat(members.findByPersonIdIn(List.of(mary))).isNotEmpty();
        mockMvc.perform(get("/api/admin/roster"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].personId").value(mary.toString()))
                .andExpect(jsonPath("$.entries[0].membershipTypeId")
                        .value(MEMBERSHIP_TYPE_ID.toString()))
                .andExpect(jsonPath("$.entries[0].membershipStartedOn")
                        .value(MEMBER_SINCE.toString()))
                .andExpect(jsonPath("$.entries[0].membershipEndedOn").value("2026-05-12"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAMembership_whenItIsEndedOnAGivenDate_thenThatDateIsWhatTheEntryReports()
            throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        members.save(memberSince(mary, MEMBERSHIP_TYPE_ID));

        // when
        mockMvc.perform(put("/api/admin/roster/{personId}/membership", mary)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"membershipTypeId":"%s","startedOn":"2026-01-01","endedOn":"2026-03-31"}
                                """.formatted(MEMBERSHIP_TYPE_ID))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membershipStartedOn").value("2026-01-01"))
                .andExpect(jsonPath("$.membershipEndedOn").value("2026-03-31"));

        // then
        mockMvc.perform(put("/api/admin/roster/{personId}/membership", mary)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"membershipTypeId":"%s","startedOn":"2026-01-01","endedOn":"2026-04-30"}
                                """.formatted(MEMBERSHIP_TYPE_ID))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membershipEndedOn")
                        .value("2026-04-30"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAMembershipEndedBeforeItBegan_whenWritingIt_thenTheOrderingIsRefused()
            throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/membership", mary)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"membershipTypeId":"%s","startedOn":"2026-05-01","endedOn":"2026-04-30"}
                                """.formatted(MEMBERSHIP_TYPE_ID))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:invalid-membership-period"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("membershipPeriod.endsBeforeItBegan"));
        assertThat(members.findByPersonIdIn(List.of(mary))).isEmpty();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonWithoutAMembership_whenEndingIt_thenItIsTheStateTheRequestAsksFor()
            throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when / then
        mockMvc.perform(delete("/api/admin/roster/{personId}/membership", mary)
                        .with(csrf()))
                .andExpect(status().isNoContent());
        assertThat(persons.findById(mary))
                .as("only the membership goes; the person stays")
                .isPresent();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUnknownPerson_whenEndingAMembership_thenTheResponseCarriesItsOwnType()
            throws Exception {
        // when / then
        mockMvc.perform(delete("/api/admin/roster/{personId}/membership", UUID.randomUUID())
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:person-not-found"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMemberSession_whenAssigningAMembership_thenItIsDenied() throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/membership", mary)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(membershipBody(MEMBERSHIP_TYPE_ID.toString()))
                        .with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
        assertThat(members.findByPersonIdIn(List.of(mary))).isEmpty();
    }

    @Test
    void givenNoSession_whenEndingAMembership_thenItIsUnauthenticated() throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        members.save(memberSince(mary, MEMBERSHIP_TYPE_ID));

        // when / then
        mockMvc.perform(delete("/api/admin/roster/{personId}/membership", mary)
                        .with(csrf()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
        assertThat(members.findByPersonIdIn(List.of(mary))).isNotEmpty();
    }

    private static String membershipBody(String membershipTypeId) {
        return membershipTypeId == null
                ? """
                {"membershipTypeId": null}
                """
                : """
                {"membershipTypeId": "%s"}
                """.formatted(membershipTypeId);
    }

    private UUID enabledAccount(UUID personId, String username, Role... roles) {
        return identity.createEnabledAccount(personId, username, Set.of(roles));
    }

    private static String usernameBody(String username) {
        return """
                {"username": "%s"}
                """.formatted(username);
    }

    private static String passwordBody(String oneTimePassword) {
        return """
                {"oneTimePassword": "%s"}
                """.formatted(oneTimePassword);
    }

    private static String accountBody(String username, String oneTimePassword, String... roles) {
        String named = Stream.of(roles).map("\"%s\""::formatted).collect(Collectors.joining(", "));
        return """
                {"username": "%s", "oneTimePassword": "%s", "roles": [%s]}
                """.formatted(username, oneTimePassword, named);
    }

    private static String personBody(String firstName, String lastName, String email) {
        return """
                {"firstName": "%s", "lastName": "%s", "email": "%s"}
                """.formatted(firstName, lastName, email);
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonWithAnAccountAndAMembership_whenReadingThatPersonAlone_thenTheListEntryIsReturned()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID account = identity.createEnabledAccount(jane, "jane.doe", "hash", Set.of(Role.MEMBER));
        members.save(memberSince(jane, MEMBERSHIP_TYPE_ID));

        // when / then
        mockMvc.perform(get("/api/admin/roster/{personId}", jane))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.personId").value(jane.toString()))
                .andExpect(jsonPath("$.firstName").value("Jane"))
                .andExpect(jsonPath("$.lastName").value("Doe"))
                .andExpect(jsonPath("$.email").value("jane.doe@example.org"))
                .andExpect(jsonPath("$.accountId").value(account.toString()))
                .andExpect(jsonPath("$.username").value("jane.doe"))
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.membershipTypeId").value(MEMBERSHIP_TYPE_ID.toString()))
                .andExpect(jsonPath("$.membershipStartedOn").value(MEMBER_SINCE.toString()))
                .andExpect(jsonPath("$.roles[0]").value("MEMBER"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonWithoutAnAccount_whenReadingThatPersonAlone_thenTheAbsentAccountIsReported()
            throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when / then
        mockMvc.perform(get("/api/admin/roster/{personId}", mary))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.personId").value(mary.toString()))
                .andExpect(jsonPath("$.accountId").doesNotExist())
                .andExpect(jsonPath("$.username").doesNotExist())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.roles.length()").value(0));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenNoSuchPerson_whenReadingIt_thenTheProblemSaysWhichPersonIsMissing() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/roster/{personId}", UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:person-not-found"));
    }

}
