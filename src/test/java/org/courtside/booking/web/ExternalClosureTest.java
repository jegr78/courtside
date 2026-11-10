package org.courtside.booking.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;

class ExternalClosureTest extends AbstractIntegrationTest {

    private static final String ACCESS_DENIED = "urn:courtside:error:access-denied";
    private static final String ANY = "00000000-0000-0000-0000-00000000abcd";

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private UserDetailsService userDetails;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private MemberTestFixture members;

    private MockMvc mockMvc;

    record Call(HttpMethod method, String path, String body) {
        @Override
        public String toString() {
            return method + " " + path;
        }
    }

    static List<Call> memberOnlyCalls() {
        return List.of(
                new Call(HttpMethod.POST, "/api/public/participant-members", "{\"query\":\"Doe\"}"),
                new Call(HttpMethod.GET, "/api/public/participant-cards", null),
                new Call(HttpMethod.GET, "/api/partner-invitations", null),
                new Call(HttpMethod.POST, "/api/partner-invitations/" + ANY + "/acceptance", null),
                new Call(HttpMethod.PUT, "/api/my/bookings/" + ANY + "/partner-invitation", null),
                new Call(HttpMethod.DELETE, "/api/my/bookings/" + ANY + "/partner-invitation", null),
                new Call(HttpMethod.GET, "/api/my/dependants", null),
                new Call(HttpMethod.GET, "/api/my/dependants/" + ANY + "/bookings", null),
                new Call(HttpMethod.GET, "/api/my/waitlist", null),
                new Call(HttpMethod.POST, "/api/my/waitlist", "{}"),
                new Call(HttpMethod.DELETE, "/api/my/waitlist/" + ANY, null),
                new Call(HttpMethod.POST, "/api/my/waitlist/" + ANY + "/acceptance", null),
                new Call(HttpMethod.POST, "/api/booking-series-preview", "{}"),
                new Call(HttpMethod.POST, "/api/booking-series", "{}"),
                new Call(HttpMethod.POST, "/api/booking-series/" + ANY + "/move/preview", "{}"));
    }

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("memberOnlyCalls")
    void givenAnExternalAccountWithoutMembership_whenItCallsAMemberOnlyOperation_thenAccessIsDenied(Call call)
            throws Exception {
        // given
        UUID person = identity.createPerson("John", "Roe", "john.roe@example.org");
        identity.createEnabledAccount(person, "roe.john", Set.of(Role.EXTERNAL));

        // when
        MockHttpServletResponse response = perform(call, "roe.john");

        // then
        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(JsonPath.<String>read(response.getContentAsString(), "$.type")).isEqualTo(ACCESS_DENIED);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("memberOnlyCalls")
    void givenAnExternalAccountHoldingAMembership_whenItCallsAMemberOnlyOperation_thenItIsNotRefusedAsOutsider(
            Call call) throws Exception {
        // given
        UUID person = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        members.holdRunningMembership(person);
        identity.createEnabledAccount(person, "doe.jane", Set.of(Role.EXTERNAL));

        // when
        MockHttpServletResponse response = perform(call, "doe.jane");

        // then
        assertThat(response.getContentAsString()).as("a membership lifts the closure").doesNotContain(ACCESS_DENIED);
    }

    @Test
    void givenAnOutsiderAndAnExternalMember_whenEachReadsItsSession_thenOnlyTheMemberIsOfferedMemberFeatures()
            throws Exception {
        // given
        UUID outsider = identity.createPerson("John", "Roe", "john.roe@example.org");
        identity.createEnabledAccount(outsider, "roe.john", Set.of(Role.EXTERNAL));
        UUID member = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        members.holdRunningMembership(member);
        identity.createEnabledAccount(member, "doe.jane", Set.of(Role.EXTERNAL));

        // when
        String outsiderSession = perform(new Call(HttpMethod.GET, "/api/session", null), "roe.john").getContentAsString();
        String memberSession = perform(new Call(HttpMethod.GET, "/api/session", null), "doe.jane").getContentAsString();
        String anonymous = mockMvc.perform(request(HttpMethod.GET, "/api/session")).andReturn().getResponse()
                .getContentAsString();

        // then
        assertThat(JsonPath.<Boolean>read(outsiderSession, "$.memberFeatures")).isFalse();
        assertThat(JsonPath.<Boolean>read(memberSession, "$.memberFeatures")).isTrue();
        assertThat(JsonPath.<Boolean>read(anonymous, "$.memberFeatures")).isFalse();
    }

    private MockHttpServletResponse perform(Call call, String username) throws Exception {
        var builder = request(call.method(), call.path())
                .with(user(userDetails.loadUserByUsername(username))).with(csrf());
        if (call.body() != null) {
            builder.contentType(MediaType.APPLICATION_JSON).content(call.body());
        }
        return mockMvc.perform(builder).andReturn().getResponse();
    }
}
