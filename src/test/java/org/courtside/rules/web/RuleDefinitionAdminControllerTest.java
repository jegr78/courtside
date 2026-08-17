package org.courtside.rules.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.BookingService;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.courtside.shared.TimeSlot;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.courtside.member.MemberFixtures.memberSince;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
class RuleDefinitionAdminControllerTest extends AbstractIntegrationTest {

    private static final UUID STANDARD_RULE_SET =
            UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID STANDARD_MEMBERSHIP =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID UNKNOWN_RULE_SET =
            UUID.fromString("aaaaaaaa-0000-0000-0000-000000000099");
    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private OpeningHoursRepository openingHours;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private MemberRepository members;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAFreshRuleSet_whenSettingAdvanceWindow_thenItIsStoredAndListed() throws Exception {
        // given
        String ruleSetId = createRuleSet("Trial");

        // when / then
        mockMvc.perform(put("/api/admin/rule-sets/" + ruleSetId + "/rules/ADVANCE_WINDOW")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"params": {"maxDays": 14}}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ruleType").value("ADVANCE_WINDOW"))
                .andExpect(jsonPath("$.params.maxDays").value(14));

        mockMvc.perform(get("/api/admin/rule-sets/" + ruleSetId + "/rules"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].ruleType").value("ADVANCE_WINDOW"))
                .andExpect(jsonPath("$[0].params.maxDays").value(14));
    }

    @Test
    void givenARuleAlreadySet_whenSettingItAgainWithADifferentValue_thenItIsChangedNotDuplicated()
            throws Exception {
        // given
        String ruleSetId = createRuleSet("Trial");
        setRule(ruleSetId, "ADVANCE_WINDOW", "maxDays", 14);

        // when
        setRule(ruleSetId, "ADVANCE_WINDOW", "maxDays", 21);

        // then
        mockMvc.perform(get("/api/admin/rule-sets/" + ruleSetId + "/rules"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].params.maxDays").value(21));
    }

    @Test
    void givenAMisspelledParameter_whenSettingIt_thenItIsRejectedWithACodeNotTheRawKey() throws Exception {
        // given
        String ruleSetId = createRuleSet("Trial");

        // when / then
        mockMvc.perform(put("/api/admin/rule-sets/" + ruleSetId + "/rules/ADVANCE_WINDOW")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"params": {"maxdays": 14}}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:rule-parameter-invalid"))
                .andExpect(jsonPath("$.violations[0].code").value("rule.parameters.unknownParameter"))
                .andExpect(jsonPath("$.violations[0].params.ruleType").value("ADVANCE_WINDOW"))
                .andExpect(jsonPath("$.detail").value(Matchers.not(Matchers.containsString("maxdays"))));
    }

    @Test
    void givenOpeningHours_whenSettingItPerRuleSet_thenItIsRejected() throws Exception {
        // given
        String ruleSetId = createRuleSet("Trial");

        // when / then
        mockMvc.perform(put("/api/admin/rule-sets/" + ruleSetId + "/rules/OPENING_HOURS")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"params": {}}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:rule-parameter-invalid"))
                .andExpect(jsonPath("$.violations[0].code").value("rule.parameters.typeNotConfigurable"))
                .andExpect(jsonPath("$.violations[0].params.ruleType").value("OPENING_HOURS"));
    }

    @Test
    void whenListingRuleTypes_thenTheirConfigurationContractIsExposed() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/rule-types"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(4))
                .andExpect(jsonPath("$[?(@.ruleType == 'OPENING_HOURS')].configurable").value(false))
                .andExpect(jsonPath("$[?(@.ruleType == 'OPENING_HOURS')].parameters.length()").value(0))
                .andExpect(jsonPath("$[?(@.ruleType == 'ADVANCE_WINDOW')].configurable").value(true))
                .andExpect(jsonPath("$[?(@.ruleType == 'ADVANCE_WINDOW')].parameters[0].name")
                        .value("maxDays"))
                .andExpect(jsonPath("$[?(@.ruleType == 'ADVANCE_WINDOW')].parameters[0].minimum")
                        .value(1))
                .andExpect(jsonPath("$[?(@.ruleType == 'ADVANCE_WINDOW')].parameters[0].maximum")
                        .value(365));
    }

    @Test
    void givenARule_whenDeletingIt_thenItIsRemovedAndDeletingAgainIsStillNoContent() throws Exception {
        // given
        String ruleSetId = createRuleSet("Trial");
        setRule(ruleSetId, "ADVANCE_WINDOW", "maxDays", 14);

        // when / then
        mockMvc.perform(delete("/api/admin/rule-sets/" + ruleSetId + "/rules/ADVANCE_WINDOW").with(csrf()))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/admin/rule-sets/" + ruleSetId + "/rules"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
        mockMvc.perform(delete("/api/admin/rule-sets/" + ruleSetId + "/rules/ADVANCE_WINDOW").with(csrf()))
                .andExpect(status().isNoContent());
    }

    @Test
    void givenAnUnknownRuleSet_whenSettingARule_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/rule-sets/" + UNKNOWN_RULE_SET + "/rules/ADVANCE_WINDOW")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"params": {"maxDays": 14}}
                                """)
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:rule-set-not-found"))
                .andExpect(jsonPath("$.title").value("Rule set not found"))
                .andExpect(jsonPath("$.detail").value("No such rule set"));
    }

    @Test
    void givenAnUnknownRuleSet_whenListingRules_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/rule-sets/" + UNKNOWN_RULE_SET + "/rules"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:rule-set-not-found"))
                .andExpect(jsonPath("$.title").value("Rule set not found"))
                .andExpect(jsonPath("$.detail").value("No such rule set"));
    }

    @Test
    void givenAnUnknownRuleSet_whenDeletingARule_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(delete("/api/admin/rule-sets/" + UNKNOWN_RULE_SET + "/rules/ADVANCE_WINDOW")
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:rule-set-not-found"))
                .andExpect(jsonPath("$.title").value("Rule set not found"))
                .andExpect(jsonPath("$.detail").value("No such rule set"));
    }

    @Test
    void givenAnAdvanceWindowChangedThroughTheAdminApi_whenBooking_thenTheNewWindowTakesEffect()
            throws Exception {
        // given
        UUID courtId = courts.save(new Court(1, "Court 1")).getId();
        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
        UUID personId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();
        members.save(memberSince(personId, STANDARD_MEMBERSHIP));
        Instant eightDaysOut = NOW.plus(8, ChronoUnit.DAYS);

        // when / then
        setRule(STANDARD_RULE_SET.toString(), "ADVANCE_WINDOW", "maxDays", 1);
        assertThatThrownBy(() -> book(courtId, personId, eightDaysOut))
                .isInstanceOf(BookingRulesViolatedException.class)
                .extracting("violations")
                .satisfies(violations -> assertThat((List<?>) violations)
                        .extracting("code")
                        .contains("booking.rule.advanceWindow.exceeded"));

        // when / then
        setRule(STANDARD_RULE_SET.toString(), "ADVANCE_WINDOW", "maxDays", 365);
        UUID bookingId = book(courtId, personId, eightDaysOut);
        assertThat(bookings.findWithAllocationsById(bookingId).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.CONFIRMED);
    }

    private UUID book(UUID courtId, UUID personId, Instant start) {
        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(start, start.plus(1, ChronoUnit.HOURS)),
                UUID.randomUUID(), personId, Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.guest("John Roe")), null));
    }

    private void setRule(String ruleSetId, String ruleType, String paramKey, int value) throws Exception {
        mockMvc.perform(put("/api/admin/rule-sets/" + ruleSetId + "/rules/" + ruleType)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"params": {"%s": %d}}
                                """.formatted(paramKey, value))
                        .with(csrf()))
                .andExpect(status().isOk());
    }

    private String createRuleSet(String name) throws Exception {
        String body = mockMvc.perform(post("/api/admin/rule-sets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "%s"}
                                """.formatted(name))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.id");
    }
}
