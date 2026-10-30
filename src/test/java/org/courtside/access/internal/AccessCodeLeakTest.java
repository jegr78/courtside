package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;
import org.courtside.access.Scope;
import org.courtside.access.internal.ScriptedAccessControl.Call;
import org.courtside.access.internal.ScriptedAccessControl.Kind;
import org.courtside.access.internal.ScriptedAccessControl.Step;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

@ExtendWith(OutputCaptureExtension.class)
@WithMockUser(username = "admin", roles = "ADMIN")
class AccessCodeLeakTest extends AccessPassTestSupport {

    private static final Pattern LOG_METADATA = Pattern.compile(
            "\"(@timestamp|traceId|spanId)\":\"[^\"]*\"|\"pid\":\\d+");
    private static final Pattern UUID_TEXT = Pattern.compile(
            "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void anAdministrativeClient() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAConnectorThatEchoesTheCodeEverywhere_whenGrantsAreSentAndRetried_thenNoStoredRowLogOrBodyCarriesIt(
            CapturedOutput output) throws Exception {
        // given
        UUID refused = book(courts.get(0));
        UUID retried = book(courts.get(1));
        insertWithoutCalls();
        connector.alwaysFor(grantIdOf(refused), new Step.FailWithCode(code -> new IllegalStateException(
                "keycode " + code + " jammed")));
        connector.alwaysFor(grantIdOf(retried), new Step.FailWithCode(code -> new IllegalStateException(
                "keycode " + code + " unknown")));
        pass.runPassNow();
        connector.alwaysFor(grantIdOf(refused), new Step.Answer(new GrantOutcome.Accepted("remote-user")));
        connector.nextInstalls();
        connector.alwaysFor(grantIdOf(retried), new Step.Answer(new GrantOutcome.Accepted("remote-user")));
        passAt(START.plus(Duration.ofMinutes(1)));
        String echoed = connector.calls(Kind.GRANT).getFirst().code();
        connector.alwaysFor(grantIdOf(refused), new Step.Answer(new GrantOutcome.Refused(Scope.GRANT,
                "keycode " + echoed + " already taken")));
        connector.mapping(points -> "mapping-v2");
        passAt(START.plus(Duration.ofMinutes(2)));

        // when
        String overview = mockMvc.perform(get("/api/admin/access-grants")).andReturn().getResponse()
                .getContentAsString();
        String retry = mockMvc.perform(post("/api/admin/access-grants/{id}/retry", grantIdOf(refused)).with(csrf()))
                .andReturn().getResponse().getContentAsString();
        String refusal = mockMvc.perform(post("/api/admin/access-grants/{id}/retry", grantIdOf(retried))
                .with(csrf())).andReturn().getResponse().getContentAsString();

        // then
        List<String> codes = connector.calls().stream().map(Call::code).filter(code -> code != null).distinct()
                .toList();
        List<String> failures = jdbc.sql("SELECT last_failure FROM access_grant WHERE last_failure IS NOT NULL")
                .query(String.class).list();
        List<String> events = jdbc.sql("SELECT payload::text FROM domain_event").query(String.class).list();
        List<String> accessLogs = accessLogLines(output);
        assertThat(codes).isNotEmpty();
        assertThat(failures).as("the refusal that echoed the code is stored").isNotEmpty();
        for (String code : codes) {
            assertThat(failures).as("last_failure").noneMatch(failure -> failure.contains(code));
            assertThat(events).as("domain_event").noneMatch(payload -> payload.contains(code));
            assertThat(accessLogs).as("the access module's log").noneMatch(line -> line.contains(code));
            assertThat(List.of(overview, retry, refusal)).as("responses and problem bodies")
                    .noneMatch(body -> body.contains(code));
        }
    }

    @Test
    void givenARevokeRefusedWithTheCodeInItsReason_whenThePassRecordsIt_thenNeitherRowNorLogCarriesTheCode(
            CapturedOutput output) {
        // given
        UUID cancelled = book(courts.get(0));
        pass.runPassNow();
        String installed = connector.calls(Kind.GRANT).getFirst().code();
        cancel(cancelled);
        connector.nextRevokes(new Step.Answer(new GrantOutcome.Refused(Scope.GRANT,
                "code " + installed + " unknown")));

        // when
        passAt(START.plus(Duration.ofMinutes(1)));

        // then
        assertThat(connector.calls(Kind.REVOKE)).as("the revoke was sent").hasSize(1);
        assertThat(grantOf(cancelled).getLastFailure()).as("last_failure").isEqualTo("code **** unknown");
        assertThat(accessLogLines(output)).as("the access module's log").noneMatch(line -> line.contains(installed));
    }

    @Test
    void givenARevokeThatThrowsWithTheCodeInItsMessage_whenThePassLogsIt_thenNeitherRowNorLogCarriesTheCode(
            CapturedOutput output) {
        // given
        UUID cancelled = book(courts.get(0));
        pass.runPassNow();
        String installed = connector.calls(Kind.GRANT).getFirst().code();
        cancel(cancelled);
        connector.nextRevokes(new Step.Fail(new IllegalStateException("revoking " + installed + " failed")));

        // when
        passAt(START.plus(Duration.ofMinutes(1)));

        // then
        assertThat(connector.calls(Kind.REVOKE)).as("the revoke was sent").hasSize(1);
        assertThat(accessLogLines(output)).as("the access module's log names the failure")
                .anyMatch(line -> line.contains("revoking **** failed"))
                .noneMatch(line -> line.contains(installed));
        assertThat(jdbc.sql("SELECT last_failure FROM access_grant").query(String.class).list())
                .as("last_failure").noneMatch(failure -> failure != null && failure.contains(installed));
    }

    @Test
    void givenAConnectorThatEmbedsTheCodeInALongerNumber_whenThePassRecordsAndLogsIt_thenNeitherCarriesTheCode(
            CapturedOutput output) {
        // given
        UUID refused = book(courts.get(0));
        UUID thrown = book(courts.get(1));
        insertWithoutCalls();
        connector.alwaysFor(grantIdOf(refused), new Step.AnswerWithCode(code -> new GrantOutcome.Refused(Scope.GRANT,
                "ref 99" + code + "99")));
        connector.alwaysFor(grantIdOf(thrown), new Step.FailWithCode(code -> new IllegalStateException(
                "id=99" + code + "99 jammed")));

        // when
        pass.runPassNow();

        // then
        List<String> codes = connector.calls(Kind.GRANT).stream().map(Call::code).toList();
        assertThat(codes).as("both installs were sent").hasSize(2);
        assertThat(grantOf(refused).getLastFailure()).as("last_failure").isEqualTo("ref 99****99");
        assertThat(accessLogLines(output)).as("the access module's log names the failure")
                .anyMatch(line -> line.contains("id=99****99 jammed"));
        for (String code : codes) {
            assertThat(accessLogLines(output)).as("the access module's log").noneMatch(line -> line.contains(code));
        }
    }

    private static List<String> accessLogLines(CapturedOutput output) {
        return output.getOut().lines().filter(line -> line.contains("\"logger\":\"org.courtside.access"))
                .map(line -> UUID_TEXT.matcher(LOG_METADATA.matcher(line).replaceAll("")).replaceAll("<id>"))
                .toList();
    }
}
