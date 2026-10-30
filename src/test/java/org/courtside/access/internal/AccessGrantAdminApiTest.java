package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;
import org.courtside.access.ProbeOutcome;
import org.courtside.access.Scope;
import org.courtside.access.internal.ScriptedAccessControl.Kind;
import org.courtside.access.internal.ScriptedAccessControl.Step;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
class AccessGrantAdminApiTest extends AccessPassTestSupport {

    private static final Step REFUSED = new Step.Answer(new GrantOutcome.Refused(Scope.GRANT, "keypad full"));

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void anAdministrativeClient() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenNoPassHasRunYet_whenTheBoardReadsTheOverview_thenThereIsNoProbeAndNothingIsCalled() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/access-grants"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.connector").value("simulated"))
                .andExpect(jsonPath("$.connected").value(true))
                .andExpect(jsonPath("$.probe").isEmpty())
                .andExpect(jsonPath("$.total").value(0));
        assertThat(connector.calls()).as("reading the overview never calls the access-control system").isEmpty();
    }

    @Test
    void givenAFailingAnInstalledAndARemovingGrant_whenTheBoardReadsTheOverview_thenFailingComesFirstWithoutACode()
            throws Exception {
        // given
        UUID installed = book(courts.get(0));
        UUID removing = book(courts.get(1));
        pass.runPassNow();
        cancel(removing);
        connector.everyRevoke(new Step.Answer(new GrantOutcome.RetryLater(Scope.GRANT, null, "busy")));
        passAt(START.plus(Duration.ofMinutes(1)));
        connector.nextInstalls(REFUSED);
        UUID failing = book(courts.get(0), new TimeSlot(EVENING.end(),
                EVENING.end().plus(Duration.ofHours(1))));
        passAt(START.plus(Duration.ofMinutes(2)));
        int callsBefore = connector.calls().size();
        String installedCode = currentCode(installed).orElseThrow();

        // when / then
        mockMvc.perform(get("/api/admin/access-grants"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(3))
                .andExpect(jsonPath("$.probe.reachable").value(true))
                .andExpect(jsonPath("$.probe.outcome").value("ANSWERED"))
                .andExpect(jsonPath("$.grants[0].bookingId").value(failing.toString()))
                .andExpect(jsonPath("$.grants[0].status").value("FAILING"))
                .andExpect(jsonPath("$.grants[0].lastFailure").value("keypad full"))
                .andExpect(jsonPath("$.grants[0].accessPoints[0]").value("North gate"))
                .andExpect(jsonPath("$.grants[0].courts[0].name").value("Court 1"))
                .andExpect(jsonPath("$.grants[1].bookingId").value(installed.toString()))
                .andExpect(jsonPath("$.grants[1].status").value("INSTALLED"))
                .andExpect(jsonPath("$.grants[2].bookingId").value(removing.toString()))
                .andExpect(jsonPath("$.grants[2].status").value("REMOVING"))
                .andExpect(content().string(not(containsString(installedCode))));
        assertThat(connector.calls()).hasSize(callsBefore);
    }

    @Test
    void givenAFailingGrant_whenTheBoardRetriesIt_thenTheRetryIsRecordedAuditedAndConsumedByTheNextPass()
            throws Exception {
        // given
        UUID booking = book(courts.get(0));
        connector.nextInstalls(REFUSED);
        pass.runPassNow();
        UUID grantId = grantIdOf(booking);

        // when
        mockMvc.perform(post("/api/admin/access-grants/{id}/retry", grantId).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(grantId.toString()))
                .andExpect(jsonPath("$.status").value("FAILING"));
        boolean requested = grantOf(booking).getRetryRequestedAt() != null;
        passAt(START.plus(Duration.ofMinutes(1)));

        // then
        assertThat(requested).isTrue();
        assertThat(jdbc.sql("SELECT count(*) FROM domain_event WHERE event_type = 'access.grant.retryRequested'"
                + " AND subject_id = ?").params(booking).query(Integer.class).single()).isOne();
        assertThat(grantOf(booking).isRefused()).as("the next pass consumes the retry").isFalse();
        assertThat(grantOf(booking).getRetryRequestedAt()).isNull();
    }

    @Test
    void givenAPassHoldingAFailingGrant_whenTheBoardRetriesIt_thenTheRetryWaitsAndKeepsWhatThePassWrote()
            throws Exception {
        // given
        UUID booking = book(courts.get(0));
        connector.nextInstalls(REFUSED);
        pass.runPassNow();
        UUID grantId = grantIdOf(booking);
        ExecutorService board = Executors.newSingleThreadExecutor();
        AtomicReference<Future<?>> retry = new AtomicReference<>();
        AtomicBoolean doneWhileLocked = new AtomicBoolean();

        // when
        try {
            inLockedRow(grantId, grant -> {
                jdbc.sql("UPDATE access_grant SET last_failure = 'written by the pass' WHERE id = ?")
                        .params(grantId).update();
                retry.set(board.submit(() -> mockMvc.perform(post("/api/admin/access-grants/{id}/retry", grantId)
                        .with(csrf()).with(user("admin").roles("ADMIN"))).andExpect(status().isOk())));
                pause(Duration.ofMillis(500));
                doneWhileLocked.set(retry.get().isDone());
            });
            retry.get().get(10, TimeUnit.SECONDS);
        } finally {
            board.shutdownNow();
        }

        // then
        assertThat(doneWhileLocked).as("the retry waits for the row lock").isFalse();
        assertThat(grantOf(booking).getLastFailure()).as("the retry does not overwrite the pass")
                .isEqualTo("written by the pass");
        assertThat(grantOf(booking).getRetryRequestedAt()).isNotNull();
    }

    private static void pause(Duration duration) {
        try {
            Thread.sleep(duration);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new AssertionError(interrupted);
        }
    }

    @Test
    void givenAGrantThatIsNotFailing_whenTheBoardRetriesIt_thenItIsRefusedWithItsOwnTypeAndCode() throws Exception {
        // given
        UUID booking = book(courts.get(0));
        pass.runPassNow();

        // when / then
        mockMvc.perform(post("/api/admin/access-grants/{id}/retry", grantIdOf(booking)).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-grant-not-failing"))
                .andExpect(jsonPath("$.violations[0].code").value("access.grant.notFailing"))
                .andExpect(jsonPath("$.violations[0].params.status").value("INSTALLED"));
        assertThat(grantOf(booking).getRetryRequestedAt()).isNull();
    }

    @Test
    void givenNoSuchGrant_whenTheBoardRetriesIt_thenItIsNotFoundWithItsOwnTypeAndCode() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/access-grants/{id}/retry", UUID.randomUUID()).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-grant-not-found"))
                .andExpect(jsonPath("$.violations[0].code").value("access.grant.notFound"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMember_whenTheyReadOrRetryAccessGrants_thenTheyAreForbidden() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/access-grants")).andExpect(status().isForbidden());
        mockMvc.perform(post("/api/admin/access-grants/{id}/retry", UUID.randomUUID()).with(csrf()))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/admin/access-grants/probe").with(csrf())).andExpect(status().isForbidden());
    }

    @Test
    void givenAProbeThatThrowsWithCredentialsInItsMessage_whenTheBoardReadsTheOverview_thenOnlyItsClassShows()
            throws Exception {
        // given
        book(courts.get(0));
        connector.nextProbes(new Step.Fail(new IllegalStateException(
                "GET https://user:secret@miniserver.example.org/x?token=y failed")));
        pass.runPassNow();

        // when
        String body = mockMvc.perform(get("/api/admin/access-grants"))
                .andExpect(jsonPath("$.probe.reachable").value(false))
                .andExpect(jsonPath("$.probe.outcome").value("UNREACHABLE"))
                .andExpect(jsonPath("$.probe.detail").isEmpty())
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(body).doesNotContain("secret").doesNotContain("token").doesNotContain("miniserver");
    }

    @Test
    void givenAProbeThatHangs_whenTheBoardReadsTheOverview_thenItShowsATimeout() throws Exception {
        // given
        book(courts.get(0));
        connector.nextProbes(new Step.Hang());
        pass.runPassNow();

        // when / then
        mockMvc.perform(get("/api/admin/access-grants"))
                .andExpect(jsonPath("$.probe.reachable").value(false))
                .andExpect(jsonPath("$.probe.outcome").value("TIMEOUT"))
                .andExpect(jsonPath("$.probe.detail").isEmpty());
    }

    @Test
    void givenNothingToSend_whenTheBoardAsksForAProbe_thenTheNextPassProbesAndTheOverviewShowsTheAnswer()
            throws Exception {
        // given
        connector.nextProbes(new Step.Probe(new ProbeOutcome.Refused("403 no user management")));

        // when
        mockMvc.perform(post("/api/admin/access-grants/probe").with(csrf())).andExpect(status().isAccepted());
        boolean calledByTheRequest = !connector.calls().isEmpty();
        passAt(START.plus(Duration.ofMinutes(1)));

        // then
        assertThat(calledByTheRequest).as("a request never takes the call thread").isFalse();
        assertThat(connector.calls()).extracting(ScriptedAccessControl.Call::kind).containsExactly(Kind.PROBE);
        mockMvc.perform(get("/api/admin/access-grants"))
                .andExpect(jsonPath("$.probe.reachable").value(false))
                .andExpect(jsonPath("$.probe.outcome").value("REFUSED"))
                .andExpect(jsonPath("$.probe.detail").value("403 no user management"))
                .andExpect(jsonPath("$.probe.checkedAt").value("2026-05-12T10:01:00Z"));
    }
}
