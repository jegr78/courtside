package org.courtside.booking.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class ExistenceDisclosureTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    private MockMvc mockMvc;
    private UUID courtId;
    private UUID anAppointmentTheMemberMayNotManage;

    @BeforeEach
    void anAppointmentOnlyATrainerManages() throws Exception {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        courtId = facility.createCourt(1, "Court 1");
        account("Jane", "Doe", "doe.jane", Role.MEMBER);
        account("John", "Roe", "trainer.john", Role.TRAINER);
        anAppointmentTheMemberMayNotManage = UUID.fromString(JsonPath.read(
                mockMvc.perform(post("/api/bookings")
                                .header("Idempotency-Key", UUID.randomUUID().toString())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(trainingJson())
                                .with(user("trainer.john").roles("TRAINER"))
                                .with(csrf()))
                        .andReturn().getResponse().getContentAsString(), "$.id"));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void whenAMemberOpensAnAppointmentTheyMayNotManage_thenItAnswersAsThoughItDidNotExist()
            throws Exception {
        // when / then
        assertIndistinguishable(id -> get("/api/managed/bookings/{id}", id));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void whenAMemberCancelsABookingTheyMayNotManage_thenItAnswersAsThoughItDidNotExist()
            throws Exception {
        // when / then
        assertIndistinguishable(id -> delete("/api/bookings/{id}", id).with(csrf()));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void whenAMemberCancelsASeriesThroughABookingTheyMayNotManage_thenItAnswersAsThoughItDidNotExist()
            throws Exception {
        // when / then
        assertIndistinguishable(id -> delete("/api/booking-series/{series}", UUID.randomUUID())
                .param("fromBookingId", id.toString())
                .param("scope", "WHOLE_SERIES")
                .with(csrf()));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void whenAMemberPreviewsAMoveThroughABookingTheyMayNotManage_thenItAnswersAsThoughItDidNotExist()
            throws Exception {
        // when / then
        assertIndistinguishable(id -> movePost("/api/booking-series/{series}/move/preview", id));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void whenAMemberMovesASeriesThroughABookingTheyMayNotManage_thenItAnswersAsThoughItDidNotExist()
            throws Exception {
        // when / then
        assertIndistinguishable(id -> movePost("/api/booking-series/{series}/move", id));
    }

    // The series id is deliberately one nobody holds: the series is only ever spoken of after the
    // caller has proved they manage the booking, so an unauthorized caller never reaches it.
    private RequestBuilder movePost(String path, UUID fromBookingId) {
        return post(path, UUID.randomUUID())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"fromBookingId": "%s", "scope": "WHOLE_SERIES", "newStartTime": "19:00:00"}
                        """.formatted(fromBookingId))
                .with(csrf());
    }

    private void assertIndistinguishable(Function<UUID, RequestBuilder> operation) throws Exception {
        String forOneThatExists = answerTo(operation.apply(anAppointmentTheMemberMayNotManage));
        String forOneThatDoesNot = answerTo(operation.apply(UUID.randomUUID()));

        assertThat(forOneThatExists)
                .as("a caller holding an id may not learn from the answer whether it names a"
                        + " booking, so refusing one they may not reach has to read exactly like"
                        + " refusing one nobody has")
                .isEqualTo(forOneThatDoesNot)
                .as("and both have to be the refusal, not two matching answers of some other kind")
                .startsWith("404 ")
                .contains("\"type\":\"urn:courtside:error:booking-not-found\"");
    }

    // Only what a second request necessarily varies: the trace, and the path that carries the id
    // the caller asked about. detail stays in, because that is where a leaked message would show.
    private String answerTo(RequestBuilder request) throws Exception {
        var response = mockMvc.perform(request).andReturn().getResponse();
        String body = response.getContentAsString()
                .replaceAll("\"(traceId|spanId|instance)\":\"[^\"]*\"", "");
        return response.getStatus() + " " + body;
    }

    private String trainingJson() {
        return """
                {
                  "courtIds": ["%s"],
                  "cardId": "%s",
                  "startsAt": "2026-05-12T18:00:00+02:00",
                  "endsAt": "2026-05-12T19:00:00+02:00"
                }
                """.formatted(courtId, TRAINING_CARD);
    }

    private void account(String firstName, String lastName, String username, Role role) {
        identity.createEnabledAccount(
                identity.createPerson(firstName, lastName,
                        username.replace('.', '-') + "@example.org"),
                username, Set.of(role));
    }
}
