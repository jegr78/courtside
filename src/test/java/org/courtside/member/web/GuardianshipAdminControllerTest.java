package org.courtside.member.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasEntry;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import(IdentityTestFixture.class)
class GuardianshipAdminControllerTest extends AbstractIntegrationTest {

    private static final String INVALID = "urn:courtside:error:invalid-guardian-relationship";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private Clock clock;

    private MockMvc mockMvc;
    private UUID jane;
    private UUID john;
    private UUID janeAccount;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .defaultRequest(get("/").sessionAttr("courtside.authenticated-at",
                        clock.instant().toEpochMilli()))
                .apply(springSecurity())
                .build();
        jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        john = identity.createPerson("John", "Roe", "john.roe@example.org");
        janeAccount = identity.createEnabledAccount(jane, "jane.doe", Set.of(Role.MEMBER));
        identity.createEnabledAccount(john, "john.roe", Set.of(Role.MEMBER));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenTwoPeopleWithAccounts_whenTheBoardLinksThem_thenBothSeeTheRunningRelationshipFromToday()
            throws Exception {
        // when
        create(jane, request(jane, john, "[\"VIEW_BOOKINGS\",\"BOOK\"]", null))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.guardian.personId").value(jane.toString()))
                .andExpect(jsonPath("$.guardian.firstName").value("Jane"))
                .andExpect(jsonPath("$.dependant.lastName").value("Roe"))
                .andExpect(jsonPath("$.grants", containsInAnyOrder("VIEW_BOOKINGS", "BOOK")))
                .andExpect(jsonPath("$.startedOn").value("2026-05-12"))
                .andExpect(jsonPath("$", hasEntry("endedOn", null)))
                .andExpect(jsonPath("$.state").value("RUNNING"));

        // then
        for (UUID person : new UUID[] {jane, john}) {
            mockMvc.perform(get(guardianships(person)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.length()").value(1))
                    .andExpect(jsonPath("$[0].dependant.personId").value(john.toString()));
        }
        assertThat(identity.accountRoles(janeAccount)).as("a relationship grants no club role")
                .containsExactly(Role.MEMBER);
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenARelationship_whenTheBoardChangesItsGrantsAndEnd_thenBothAreWrittenWhole() throws Exception {
        // given
        String id = idOf(create(john, request(jane, john, "[\"VIEW_BOOKINGS\",\"BOOK\"]", null)));

        // when
        change(john, id, "{\"grants\":[\"CANCEL_BOOKINGS\"],\"endedOn\":\"2026-09-01\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.grants", containsInAnyOrder("CANCEL_BOOKINGS")))
                .andExpect(jsonPath("$.endedOn").value("2026-09-01"))
                .andExpect(jsonPath("$.state").value("RUNNING"));

        // then
        change(john, id, "{\"grants\":[\"CANCEL_BOOKINGS\"]}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasEntry("endedOn", null)));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenARunningRelationship_whenTheBoardEndsIt_thenItHasEndedTodayAndEndingAgainKeepsThatDay()
            throws Exception {
        // given
        String id = idOf(create(jane, request(jane, john, "[\"BOOK\"]", null)));

        // when
        end(jane, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.endedOn").value("2026-05-12"))
                .andExpect(jsonPath("$.state").value("ENDED"));

        // then
        end(jane, id).andExpect(status().isOk()).andExpect(jsonPath("$.endedOn").value("2026-05-12"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenARelationshipRecordedByMistake_whenTheBoardRemovesIt_thenNeitherPersonListsIt() throws Exception {
        // given
        String id = idOf(create(jane, request(jane, john, "[\"BOOK\"]", null)));

        // when
        mockMvc.perform(delete(guardianships(john) + "/" + id).with(csrf())).andExpect(status().isNoContent());

        // then
        mockMvc.perform(get(guardianships(jane))).andExpect(jsonPath("$.length()").value(0));
        mockMvc.perform(delete(guardianships(john) + "/" + id).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:guardian-relationship-not-found"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenARelationshipOfOtherPeople_whenAddressedThroughAThirdPerson_thenItIsNotFound() throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        String id = idOf(create(jane, request(jane, john, "[\"BOOK\"]", null)));

        // when / then
        end(mary, id)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:guardian-relationship-not-found"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenARunningRelationship_whenTheSamePairIsLinkedAgain_thenTheOverlapIsRefused() throws Exception {
        // given
        create(jane, request(jane, john, "[\"BOOK\"]", null)).andExpect(status().isCreated());

        // when / then
        create(john, request(jane, john, "[\"VIEW_BOOKINGS\"]", null))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:guardian-relationship-overlap"))
                .andExpect(jsonPath("$.violations[0].code").value("guardianship.overlaps"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnEndedRelationship_whenTheSamePairIsLinkedAgain_thenANewOneStarts() throws Exception {
        // given
        String id = idOf(create(jane, request(jane, john, "[\"BOOK\"]", null)));
        end(jane, id).andExpect(status().isOk());

        // when / then
        create(jane, request(jane, john, "[\"BOOK\"]", null)).andExpect(status().isCreated());
        mockMvc.perform(get(guardianships(jane))).andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenARunningRelationship_whenTheDependantIsMadeTheGuardiansGuardian_thenTheReversalIsRefused()
            throws Exception {
        // given
        create(jane, request(jane, john, "[\"BOOK\"]", null)).andExpect(status().isCreated());

        // when / then
        create(jane, request(john, jane, "[\"BOOK\"]", null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(INVALID))
                .andExpect(jsonPath("$.violations[0].code").value("guardianship.reversed"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAReversedRelationshipAfterAnEndedOne_whenTheEndedOneIsReopened_thenTheReversalIsRefused()
            throws Exception {
        // given
        String id = idOf(create(jane, request(jane, john, "[\"BOOK\"]", null)));
        end(jane, id).andExpect(status().isOk());
        create(jane, request(john, jane, "[\"BOOK\"]", null)).andExpect(status().isCreated());

        // when / then
        change(jane, id, "{\"grants\":[\"BOOK\"]}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(INVALID))
                .andExpect(jsonPath("$.violations[0].code").value("guardianship.reversed"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenUnusableRequests_whenCreating_thenEachIsRefusedWithItsOwnCode() throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when / then
        refused(create(jane, request(jane, jane, "[\"BOOK\"]", null)), "guardianship.self");
        refused(create(mary, request(jane, john, "[\"BOOK\"]", null)), "guardianship.notAParty");
        refused(create(jane, request(jane, mary, "[\"BOOK\"]", null)), "guardianship.accountRequired");
        refused(create(mary, request(mary, john, "[\"BOOK\"]", null)), "guardianship.accountRequired");
        refused(create(jane, request(jane, john, "[\"BOOK\"]", "2026-05-11")), "guardianship.endsBeforeItBegan");
        refused(create(jane, request(jane, john, "[\"BOOK\"]", "2026-05-12")), "guardianship.coversNoDay");
        mockMvc.perform(get(guardianships(jane))).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenNoGrant_whenCreatingOrChanging_thenTheRequestIsRefusedByTheContract() throws Exception {
        // given
        String id = idOf(create(jane, request(jane, john, "[\"BOOK\"]", null)));

        // when / then
        create(jane, request(jane, john, "[]", null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("grants"));
        change(jane, id, "{\"grants\":[]}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("grants"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnEndBeforeTheStart_whenChanging_thenItIsRefused() throws Exception {
        // given
        String id = idOf(create(jane, request(jane, john, "[\"BOOK\"]", null)));

        // when / then
        refused(change(jane, id, "{\"grants\":[\"BOOK\"],\"endedOn\":\"2026-05-01\"}"),
                "guardianship.endsBeforeItBegan");
        refused(change(jane, id, "{\"grants\":[\"BOOK\"],\"endedOn\":\"2026-05-12\"}"),
                "guardianship.coversNoDay");
        end(jane, id).andExpect(status().isOk()).andExpect(jsonPath("$.endedOn").value("2026-05-12"));
    }

    @Test
    @WithMockUser(username = "jane.doe", roles = "MEMBER")
    void givenAMember_whenReachingForTheRelationshipAdministration_thenEveryOperationIsForbidden()
            throws Exception {
        // when / then
        mockMvc.perform(get(guardianships(jane))).andExpect(status().isForbidden());
        create(jane, request(jane, john, "[\"BOOK\"]", null)).andExpect(status().isForbidden());
        UUID unknown = UUID.randomUUID();
        change(jane, unknown.toString(), "{\"grants\":[\"BOOK\"]}").andExpect(status().isForbidden());
        end(jane, unknown.toString()).andExpect(status().isForbidden());
        mockMvc.perform(delete(guardianships(jane) + "/" + unknown).with(csrf())).andExpect(status().isForbidden());
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAStaleSignIn_whenTheBoardWritesARelationship_thenEveryWriteAsksForAFreshProof() throws Exception {
        // given
        String id = idOf(create(jane, request(jane, john, "[\"BOOK\"]", null)));
        long stale = clock.instant().minus(Duration.ofHours(2)).toEpochMilli();

        // when / then
        for (MockHttpServletRequestBuilder write : List.of(
                post(guardianships(john)).contentType(MediaType.APPLICATION_JSON)
                        .content(request(john, jane, "[\"BOOK\"]", null)),
                put(guardianships(jane) + "/" + id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"grants\":[\"BOOK\",\"CANCEL_BOOKINGS\"]}"),
                post(guardianships(jane) + "/" + id + "/end"),
                delete(guardianships(jane) + "/" + id))) {
            mockMvc.perform(write.with(csrf()).sessionAttr("courtside.authenticated-at", stale))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.type").value("urn:courtside:error:recent-authentication-required"))
                    .andExpect(jsonPath("$.violations[0].code").value("identity.reauthentication.required"));
        }
        mockMvc.perform(get(guardianships(jane)))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].grants", containsInAnyOrder("BOOK")))
                .andExpect(jsonPath("$[0].state").value("RUNNING"));
    }

    private void refused(ResultActions result, String code) throws Exception {
        result.andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(INVALID))
                .andExpect(jsonPath("$.violations[0].code").value(code));
    }

    private ResultActions create(UUID person, String body) throws Exception {
        return mockMvc.perform(post(guardianships(person)).with(csrf())
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions change(UUID person, String id, String body) throws Exception {
        return mockMvc.perform(put(guardianships(person) + "/" + id).with(csrf())
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions end(UUID person, String id) throws Exception {
        return mockMvc.perform(post(guardianships(person) + "/" + id + "/end").with(csrf()));
    }

    private static String idOf(ResultActions result) throws Exception {
        return JsonPath.read(result.andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(),
                "$.id");
    }

    private static String request(UUID guardian, UUID dependant, String grants, String endedOn) {
        return "{\"guardianPersonId\":\"" + guardian + "\",\"dependantPersonId\":\"" + dependant
                + "\",\"grants\":" + grants + (endedOn == null ? "" : ",\"endedOn\":\"" + endedOn + "\"") + "}";
    }

    private static String guardianships(UUID person) {
        return "/api/admin/roster/" + person + "/guardianships";
    }
}
