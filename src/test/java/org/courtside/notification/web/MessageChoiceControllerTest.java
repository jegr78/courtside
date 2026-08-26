package org.courtside.notification.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.notification.MessageKind;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;

import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import(IdentityTestFixture.class)
class MessageChoiceControllerTest extends AbstractIntegrationTest {

    private static final String USERNAME = "doe.jane";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;
    private UUID accountId;

    @BeforeEach
    void aSignedInMember() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        accountId = identity.createEnabledAccount(personId, USERNAME, Set.of(Role.MEMBER));
    }

    @Test
    void givenAMemberWhoChoseNothing_whenTheyReadTheirChoices_thenEveryKindIsOnAndSaysWhetherItMayGoOff()
            throws Exception {
        // when
        List<Choice> choices = choices();

        // then
        assertThat(choices).extracting(Choice::kind)
                .containsExactlyInAnyOrderElementsOf(Arrays.stream(MessageKind.values())
                        .map(Enum::name).toList());
        assertThat(choices).allMatch(Choice::enabled, "nothing is switched off before anybody chose");
        assertThat(declinable(choices)).containsExactlyInAnyOrder(
                "BOOKING_CONFIRMED", "BOOKING_PLAYER_WITHDREW", "BOOKING_REMINDER");
    }

    @Test
    void givenAMemberWhoSwitchesTwoKindsOff_whenTheyReadTheirChoicesAgain_thenBothAreOff()
            throws Exception {
        // when
        mockMvc.perform(put("/api/account/messages").with(member()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"declined\": [\"BOOKING_REMINDER\", \"BOOKING_CONFIRMED\"]}"))
                .andExpect(status().isNoContent());

        // then
        assertThat(switchedOff()).containsExactlyInAnyOrder("BOOKING_REMINDER", "BOOKING_CONFIRMED");
    }

    @Test
    void givenAKindSwitchedOff_whenItIsChosenAgain_thenItIsReceivedOnceMore() throws Exception {
        // given
        choose("[\"BOOKING_REMINDER\"]");

        // when
        choose("[]");

        // then
        assertThat(switchedOff()).isEmpty();
        assertThat(declinedRows()).isZero();
    }

    @Test
    void whenAMemberTriesToSwitchOffWhatTheClubMustSend_thenItIsRefusedNamingTheKind()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/account/messages").with(member()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"declined\": [\"BOOKING_DISPLACED\"]}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:message-not-declinable"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("notification.message.notDeclinable"))
                .andExpect(jsonPath("$.violations[0].params.kind").value("BOOKING_DISPLACED"));
        assertThat(declinedRows()).isZero();
    }

    @Test
    void whenTheRequestNamesNothingWhereAKindBelongs_thenItIsRefusedAsInvalid() throws Exception {
        // when / then
        mockMvc.perform(put("/api/account/messages").with(member()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"declined\": [null]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("declined[0]"));
        assertThat(declinedRows()).isZero();
    }

    @Test
    void whenNobodyIsSignedIn_thenTheChoicesAreNotServed() throws Exception {
        // when / then
        mockMvc.perform(get("/api/account/messages")).andExpect(status().isUnauthorized());
    }

    private List<Choice> choices() throws Exception {
        String body = mockMvc.perform(get("/api/account/messages").with(member()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return List.of(new ObjectMapper().readValue(body, Choice[].class));
    }

    private List<String> switchedOff() throws Exception {
        return choices().stream().filter(choice -> !choice.enabled()).map(Choice::kind).toList();
    }

    private static List<String> declinable(List<Choice> choices) {
        return choices.stream().filter(Choice::declinable).map(Choice::kind).toList();
    }

    private record Choice(String kind, boolean declinable, boolean enabled) {
    }

    private void choose(String declined) throws Exception {
        mockMvc.perform(put("/api/account/messages").with(member()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"declined\": " + declined + "}"))
                .andExpect(status().isNoContent());
    }

    private int declinedRows() {
        return jdbc.sql("SELECT count(*) FROM message_optout WHERE user_account_id = :id")
                .param("id", accountId)
                .query(Integer.class)
                .single();
    }

    private static org.springframework.test.web.servlet.request.RequestPostProcessor member() {
        return user(USERNAME).roles("MEMBER");
    }
}
