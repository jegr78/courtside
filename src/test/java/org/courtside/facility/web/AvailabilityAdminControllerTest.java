package org.courtside.facility.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.Court;
import org.courtside.facility.internal.CourtRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.util.Arrays;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.anonymous;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AvailabilityAdminControllerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private CourtRepository courts;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnAdmin_whenAddingChangingAndRemovingAHoliday_thenTheGridFollowsEachStep() throws Exception {
        // when
        String created = mockMvc.perform(createPeriod("HOLIDAY", "Founding day", "2026-07-07", "2026-07-07",
                        week("10:00", "14:00")))
                .andExpect(status().isCreated())
                .andExpect(header().exists("Location"))
                .andExpect(jsonPath("$.kind").value("HOLIDAY"))
                .andExpect(jsonPath("$.days.length()").value(7))
                .andExpect(jsonPath("$.days[0].opensAt").value("10:00:00"))
                .andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(created, "$.id");

        // then
        mockMvc.perform(get("/api/public/booking-grid").param("from", "2026-06-01").param("to", "2026-07-31")
                        .with(anonymous()))
                .andExpect(jsonPath("$.openingPeriods.length()").value(1))
                .andExpect(jsonPath("$.openingPeriods[0].startsOn").value("2026-07-07"))
                .andExpect(jsonPath("$.courtClosures.length()").value(0));

        // when / then
        mockMvc.perform(json(put("/api/admin/opening-periods/" + id),
                        "{\"kind\": \"HOLIDAY\", " + period("Founding day", "2026-07-08", "2026-07-08", week(null, null)).substring(1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.startsOn").value("2026-07-08"))
                .andExpect(jsonPath("$.days[0].opensAt").doesNotExist());
        mockMvc.perform(get("/api/admin/opening-periods"))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].name").value("Founding day"));
        mockMvc.perform(delete("/api/admin/opening-periods/" + id).with(csrf()))
                .andExpect(status().isNoContent());
        mockMvc.perform(delete("/api/admin/opening-periods/" + id).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:availability-entry-not-found"))
                .andExpect(jsonPath("$.violations[0].code").value("facility.availability.notFound"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAHoliday_whenASecondOneOverlapsIt_thenTheExclusionIsTranslated() throws Exception {
        // given
        mockMvc.perform(createPeriod("HOLIDAY", "Founding day", "2026-07-07", "2026-07-08", week(null, null)))
                .andExpect(status().isCreated());

        // when / then
        mockMvc.perform(createPeriod("HOLIDAY", "Summer fair", "2026-07-08", "2026-07-09", week(null, null)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:availability-rejected"))
                .andExpect(jsonPath("$.violations[0].code").value("facility.availability.overlap"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPeriodWithoutAKind_whenCreatingIt_thenTheFieldIsNamed() throws Exception {
        // when / then
        mockMvc.perform(json(post("/api/admin/opening-periods"),
                        period("Founding day", "2026-07-07", "2026-07-07", week(null, null))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("kind"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAFirstDayInThePast_whenCreatingAClosure_thenItIsRefusedWithToday() throws Exception {
        // given
        Court court = courts.save(new Court(4, null));

        // when / then
        mockMvc.perform(createClosure(court.getId(), "Resurfacing", "2026-05-11", "2026-05-20"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:availability-rejected"))
                .andExpect(jsonPath("$.violations[0].code").value("facility.availability.startsInPast"))
                .andExpect(jsonPath("$.violations[0].params.today").value("2026-05-12"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnAdmin_whenClosingACourtAndCorrectingIt_thenTheClosureFollows() throws Exception {
        // given
        Court court = courts.save(new Court(4, null));

        // when
        String created = mockMvc.perform(createClosure(court.getId(), "Resurfacing", "2026-06-01", "2026-06-30"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.courtId").value(court.getId().toString()))
                .andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(created, "$.id");

        // then
        mockMvc.perform(json(put("/api/admin/court-closures/" + id),
                        "{\"courtId\": \"%s\", ".formatted(court.getId()) + closure("Lights", "2026-06-02", "2026-06-03").substring(1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Lights"));
        mockMvc.perform(get("/api/admin/court-closures"))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].endsOn").value("2026-06-03"));
        mockMvc.perform(get("/api/public/booking-grid").param("from", "2026-06-01").param("to", "2026-07-31")
                        .with(anonymous()))
                .andExpect(jsonPath("$.courtClosures[0].courtId").value(court.getId().toString()))
                .andExpect(jsonPath("$.courtClosures[0].name").doesNotExist());
        mockMvc.perform(delete("/api/admin/court-closures/" + id).with(csrf()))
                .andExpect(status().isNoContent());
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUnknownCourt_whenClosingIt_thenTheCourtIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(createClosure(UUID.randomUUID(), "Resurfacing", "2026-06-01", "2026-06-30"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:court-not-found"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMember_whenWritingAvailability_thenEveryWriteIsForbidden() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/opening-periods")).andExpect(status().isForbidden());
        mockMvc.perform(get("/api/admin/court-closures")).andExpect(status().isForbidden());
        mockMvc.perform(createPeriod("HOLIDAY", "Founding day", "2026-07-07", "2026-07-07", week(null, null)))
                .andExpect(status().isForbidden());
        mockMvc.perform(createClosure(UUID.randomUUID(), "Resurfacing", "2026-06-01", "2026-06-30"))
                .andExpect(status().isForbidden());
        mockMvc.perform(delete("/api/admin/opening-periods/" + UUID.randomUUID()).with(csrf()))
                .andExpect(status().isForbidden());
        mockMvc.perform(delete("/api/admin/court-closures/" + UUID.randomUUID()).with(csrf()))
                .andExpect(status().isForbidden());
    }

    private static MockHttpServletRequestBuilder createPeriod(String kind, String name, String startsOn,
                                                              String endsOn, String days) {
        String body = period(name, startsOn, endsOn, days);
        return json(post("/api/admin/opening-periods"),
                "{\"kind\": \"%s\", %s".formatted(kind, body.substring(1)));
    }

    private static MockHttpServletRequestBuilder createClosure(UUID courtId, String name, String startsOn,
                                                               String endsOn) {
        String body = closure(name, startsOn, endsOn);
        return json(post("/api/admin/court-closures"),
                "{\"courtId\": \"%s\", %s".formatted(courtId, body.substring(1)));
    }

    private static String period(String name, String startsOn, String endsOn, String days) {
        return "{\"name\": \"%s\", \"startsOn\": \"%s\", \"endsOn\": \"%s\", \"days\": [%s]}"
                .formatted(name, startsOn, endsOn, days);
    }

    private static String closure(String name, String startsOn, String endsOn) {
        return "{\"name\": \"%s\", \"startsOn\": \"%s\", \"endsOn\": \"%s\"}".formatted(name, startsOn, endsOn);
    }

    private static String week(String opensAt, String closesAt) {
        return Arrays.stream(DayOfWeek.values())
                .map(day -> "{\"dayOfWeek\": \"%s\", \"opensAt\": %s, \"closesAt\": %s}"
                        .formatted(day.name(), quoted(opensAt), quoted(closesAt)))
                .collect(Collectors.joining(","));
    }

    private static String quoted(String value) {
        return value == null ? "null" : "\"" + value + "\"";
    }

    private static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body).with(csrf());
    }
}
