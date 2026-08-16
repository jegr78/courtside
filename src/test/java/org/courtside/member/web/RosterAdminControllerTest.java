package org.courtside.member.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class RosterAdminControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBERSHIP_TYPE_ID = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

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
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount account = new UserAccount(jane, "jane.doe", "hash", Set.of(Role.MEMBER));
        account.enable();
        accounts.save(account);
        members.save(new Member(jane.getId(), MEMBERSHIP_TYPE_ID));
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));

        // when / then
        mockMvc.perform(get("/api/admin/roster"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries.length()").value(2))
                .andExpect(jsonPath("$.nextCursor").doesNotExist())
                .andExpect(jsonPath("$.entries[0].personId").value(jane.getId().toString()))
                .andExpect(jsonPath("$.entries[0].username").value("jane.doe"))
                .andExpect(jsonPath("$.entries[0].accountId").value(account.getId().toString()))
                .andExpect(jsonPath("$.entries[0].enabled").value(true))
                .andExpect(jsonPath("$.entries[0].membershipTypeId").value(MEMBERSHIP_TYPE_ID.toString()))
                .andExpect(jsonPath("$.entries[0].roles[0]").value("MEMBER"))
                .andExpect(jsonPath("$.entries[1].personId").value(mary.getId().toString()))
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
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        persons.save(new Person("Mary", "Major", "mary.major@example.org"));

        // when / then
        mockMvc.perform(get("/api/admin/roster").queryParam("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries.length()").value(1))
                .andExpect(jsonPath("$.entries[0].personId").value(jane.getId().toString()))
                .andExpect(jsonPath("$.nextCursor").value(jane.getId().toString()));
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
        persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

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
        // when / then — the padding is gone before the bound is checked, so a name that fits
        // once stripped is not refused for the whitespace around it
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

        // then — a paste from a word processor arrives padded with these, and the pattern already
        // calls every one of them whitespace
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
        // when / then — a name reaches email headers and templates, so a terminator a board can
        // type into it is a poor default to carry there
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
        // when / then — all three columns are text, so nothing downstream re-imposes the bound
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
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Email"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenABlankFirstName_whenChangingAPerson_thenTheContractNamesTheField() throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}", jane.getId())
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
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}", jane.getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(personBody("Jane", "Major", "jane.major@example.org"))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.personId").value(jane.getId().toString()))
                .andExpect(jsonPath("$.lastName").value("Major"))
                .andExpect(jsonPath("$.email").value("jane.major@example.org"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenPaddedDetails_whenChangingAPerson_thenTheyAreStoredWithoutThatPadding() throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        String noBreakSpace = Character.toString(0x00a0);

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}", jane.getId())
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
        // when / then — a 404 from a missing row and a 404 from an unmapped path are the same
        // number, so the type is what tells them apart
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
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}", jane.getId())
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
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));

        // when
        mockMvc.perform(post("/api/admin/roster/{personId}/account", mary.getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(accountBody("major.mary", "one-time-password", "MEMBER", "TRAINER"))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.personId").value(mary.getId().toString()))
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
    void givenATakenUsername_whenCreatingAnAccount_thenTheResponseCarriesItsOwnType() throws Exception {
        // given — a unique index and this task's own refusal both answer 409, so the type is
        // what tells a client which of the two it hit
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        accounts.save(new UserAccount(jane, "doe.jane", "hash", Set.of(Role.MEMBER)));

        // when / then
        mockMvc.perform(post("/api/admin/roster/{personId}/account", mary.getId())
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
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        accounts.save(new UserAccount(jane, "doe.jane", "hash", Set.of(Role.MEMBER)));

        // when / then
        mockMvc.perform(post("/api/admin/roster/{personId}/account", jane.getId())
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
        // given — the twelve-character floor is the one the bootstrap administrator is held to
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when / then
        mockMvc.perform(post("/api/admin/roster/{personId}/account", jane.getId())
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
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        accounts.save(new UserAccount(jane, "doe.jane", "hash", Set.of(Role.MEMBER, Role.ADMIN)));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/roles", jane.getId())
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
        // given — a person who exists and an account that does not are both 404, so only the
        // type says which of the two an administrator is looking at
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}/account/roles", jane.getId())
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
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount account = new UserAccount(jane, "doe.jane", "hash", Set.of(Role.MEMBER));
        account.enable();
        accounts.save(account);

        // when
        mockMvc.perform(put("/api/admin/roster/{personId}/account/active", jane.getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false));

        // then
        assertThat(accounts.findById(account.getId())).get()
                .satisfies(stored -> assertThat(stored.isEnabled()).isFalse());
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMemberSession_whenCreatingAnAccount_thenItIsDenied() throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when / then
        mockMvc.perform(post("/api/admin/roster/{personId}/account", jane.getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(accountBody("doe.jane", "one-time-password", "ADMIN"))
                        .with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
        assertThat(accounts.findByUsername("doe.jane")).isEmpty();
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
}
