package org.courtside;

import org.courtside.api.ApiCreateBookingRequest;
import org.courtside.api.ApiMembershipRequest;
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

import tools.jackson.databind.DatabindException;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
@Import(FacilityTestFixture.class)
class RequestInputTypeSurfaceTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private ObjectMapper mapper;

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
    void givenANumberForAText_whenUpdatingACourt_thenTheTypeIsRefusedRatherThanPrinted()
            throws Exception {
        // when / then
        refusedAsATypeMismatch(court("{\"number\":3,\"name\":7}"), "name");
    }

    @Test
    void givenAnInstantForAWallClockTime_whenSettingTheOpeningHours_thenTheTypeIsRefused()
            throws Exception {
        // when / then
        refusedAsATypeMismatch(openingHours(8), "days[0].opensAt");
    }

    @Test
    void givenAComponentArrayForAWallClockTime_whenSettingTheOpeningHours_thenTheTypeIsRefused()
            throws Exception {
        // when / then
        refusedAsATypeMismatch(openingHours("[8,0]"), "days[0].opensAt");
    }

    @Test
    void givenAComponentArrayForADate_whenReadingAMembershipRequest_thenTheTypeIsRefused() {
        // when / then
        assertThatThrownBy(() -> mapper.readValue(
                "{\"membershipTypeId\":\"11111111-1111-1111-1111-111111111111\","
                        + "\"startedOn\":[2026,1,1]}", ApiMembershipRequest.class))
                .isInstanceOf(DatabindException.class)
                .hasMessageContaining("java.time.LocalDate")
                .hasMessageContaining("startedOn");
    }

    @Test
    void givenANumberForAWeekdayName_whenSettingTheOpeningHours_thenTheValueIsRefused()
            throws Exception {
        // when / then
        weekday("2").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(content().string(containsString("dayOfWeek")));
    }

    @Test
    void givenAWeekdayNameTheDocumentDeclares_whenSettingTheOpeningHours_thenItIsAccepted()
            throws Exception {
        // when / then
        weekday("\"MONDAY\"").andExpect(status().isOk());
    }

    @Test
    void givenTheWallClockTimesTheDocumentDeclares_whenSettingTheOpeningHours_thenTheyAreAccepted()
            throws Exception {
        // when / then
        openingHours("\"08:00\"").andExpect(status().isOk());
    }

    @Test
    void givenAnEpochNumberForADateTime_whenReadingABookingRequest_thenTheTypeIsRefused() {
        // when / then
        assertThatThrownBy(() -> mapper.readValue(bookingRequest("1700000000000"),
                ApiCreateBookingRequest.class))
                .isInstanceOf(DatabindException.class)
                .hasMessageContaining("java.time.OffsetDateTime")
                .hasMessageContaining("startsAt");
    }

    @Test
    void givenTheDateTimeTheDocumentDeclares_whenReadingABookingRequest_thenItIsRead() {
        // when
        ApiCreateBookingRequest read =
                mapper.readValue(bookingRequest("\"2026-01-01T09:00:00Z\""), ApiCreateBookingRequest.class);

        // then
        assertThat(read.getStartsAt()).isEqualTo(OffsetDateTime.parse("2026-01-01T09:00:00Z"));
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

    private static String bookingRequest(String startsAt) {
        return "{\"courtIds\":[\"11111111-1111-1111-1111-111111111111\"],"
                + "\"cardId\":\"22222222-2222-2222-2222-222222222222\",\"startsAt\":" + startsAt
                + ",\"endsAt\":\"2026-01-01T10:00:00Z\"}";
    }

    private ResultActions weekday(String monday) throws Exception {
        StringBuilder days = new StringBuilder();
        for (java.time.DayOfWeek day : java.time.DayOfWeek.values()) {
            days.append(days.isEmpty() ? "" : ",")
                    .append("{\"dayOfWeek\":")
                    .append(day == java.time.DayOfWeek.MONDAY ? monday : "\"" + day.name() + "\"")
                    .append(",\"opensAt\":\"08:00\",\"closesAt\":\"22:00\"}");
        }
        return mockMvc.perform(put("/api/admin/opening-hours")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"days\":[" + days + "]}").with(csrf()));
    }

    private ResultActions openingHours(Object opensAt) throws Exception {
        StringBuilder days = new StringBuilder();
        for (java.time.DayOfWeek day : java.time.DayOfWeek.values()) {
            days.append(days.isEmpty() ? "" : ",")
                    .append("{\"dayOfWeek\":\"").append(day.name()).append("\",\"opensAt\":")
                    .append(day == java.time.DayOfWeek.MONDAY ? opensAt : "\"08:00\"")
                    .append(",\"closesAt\":\"22:00\"}");
        }
        return mockMvc.perform(put("/api/admin/opening-hours")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"days\":[" + days + "]}").with(csrf()));
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
