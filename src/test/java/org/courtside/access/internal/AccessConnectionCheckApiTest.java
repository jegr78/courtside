package org.courtside.access.internal;

import org.courtside.access.CheckResult;
import org.courtside.access.ConnectionCheck;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
class AccessConnectionCheckApiTest extends AccessPassTestSupport {

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void anAdministrativeClient() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenNoCheckYet_whenTheBoardReadsIt_thenItIsEmptyWithoutATimeAndNothingIsCalled() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/access-control/check"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checkedAt").value(nullValue()))
                .andExpect(jsonPath("$.checks.length()").value(0));
        assertThat(connector.calls()).as("reading the check never calls the access-control system").isEmpty();
    }

    @Test
    void givenARequestedCheck_whenThePassHasRun_thenTheBoardReadsEachCheckWithItsCodeAndParameters()
            throws Exception {
        // given
        connector.checks(
                new ConnectionCheck("version", List.of(), () -> CheckResult.failed("access.check.version.tooOld",
                        Map.of("version", "14.2.5.9", "minimum", "14.2.5.16"))),
                new ConnectionCheck("keypad", List.of(), () -> CheckResult.manual("access.check.keypad.manual")));

        // when
        mockMvc.perform(post("/api/admin/access-control/check").with(csrf())).andExpect(status().isAccepted());
        boolean calledByTheRequest = !connector.calls().isEmpty() || connector.checkedAccessPoints() != null;
        passAt(START.plus(Duration.ofMinutes(1)));

        // then
        assertThat(calledByTheRequest).as("a request never takes the call thread").isFalse();
        mockMvc.perform(get("/api/admin/access-control/check"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checkedAt").value("2026-05-12T10:01:00Z"))
                .andExpect(jsonPath("$.checks[0].check").value("version"))
                .andExpect(jsonPath("$.checks[0].outcome").value("FAILED"))
                .andExpect(jsonPath("$.checks[0].code").value("access.check.version.tooOld"))
                .andExpect(jsonPath("$.checks[0].params.version").value("14.2.5.9"))
                .andExpect(jsonPath("$.checks[0].params.minimum").value("14.2.5.16"))
                .andExpect(jsonPath("$.checks[1].check").value("keypad"))
                .andExpect(jsonPath("$.checks[1].outcome").value("MANUAL"))
                .andExpect(jsonPath("$.checks[1].code").value("access.check.keypad.manual"));
        mockMvc.perform(get("/api/admin/access-grants"))
                .andExpect(jsonPath("$.probe.outcome").value("ANSWERED"))
                .andExpect(jsonPath("$.probe.checkedAt").value("2026-05-12T10:01:00Z"));
    }

    @Test
    void givenACheckThrowingWithCredentialsTokenAndCode_whenTheBoardReadsIt_thenNoneOfThemShows() throws Exception {
        // given
        connector.checks(new ConnectionCheck("login", List.of(), () -> {
            throw new IllegalStateException("GET https://user:secret@miniserver.example.org/x?autht=eyJtoken&code=4826"
                    + " password example-service-password failed");
        }));
        mockMvc.perform(post("/api/admin/access-control/check").with(csrf())).andExpect(status().isAccepted());
        pass.runPassNow();

        // when
        String body = mockMvc.perform(get("/api/admin/access-control/check"))
                .andExpect(jsonPath("$.checks[0].outcome").value("FAILED"))
                .andExpect(jsonPath("$.checks[0].code").value("access.check.failed"))
                .andExpect(jsonPath("$.checks[0].params").isEmpty())
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(body).doesNotContain("secret").doesNotContain("eyJ").doesNotContain("4826")
                .doesNotContain("password").doesNotContain("miniserver");
    }
}
