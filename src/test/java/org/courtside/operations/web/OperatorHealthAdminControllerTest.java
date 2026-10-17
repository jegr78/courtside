package org.courtside.operations.web;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.MessageKind;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({IdentityTestFixture.class, NotificationTestFixture.class})
class OperatorHealthAdminControllerTest extends AbstractIntegrationTest {

    private static final Path EVIDENCE = evidenceDirectory().resolve("last-backup.json");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private NotificationTestFixture notifications;

    @Autowired
    private UserDetailsService users;

    @Autowired
    private MeterRegistry meters;

    @Autowired
    private Clock clock;

    private MockMvc mockMvc;
    private UserDetails administrator;
    private UserDetails member;
    private UUID memberAccount;

    @DynamicPropertySource
    static void operatorEvidence(DynamicPropertyRegistry properties) {
        properties.add("courtside.operations.backup-evidence-file", EVIDENCE::toString);
        properties.add("courtside.public-url", () -> "https://courts.example.org/");
    }

    @BeforeEach
    void setUp() throws IOException {
        Files.deleteIfExists(EVIDENCE);
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        UUID adminPerson = identity.createPerson("Mary", "Major", "mary.major@example.org");
        identity.createEnabledAccount(adminPerson, "mary.major", Set.of(Role.ADMIN));
        administrator = users.loadUserByUsername("mary.major");
        UUID memberPerson = identity.createPerson("John", "Roe", "john.roe@example.org");
        memberAccount = identity.createEnabledAccount(memberPerson, "john.roe", Set.of(Role.MEMBER));
        member = users.loadUserByUsername("john.roe");
    }

    @Test
    void givenARecordedBackupAndAHandedOverMessage_whenAnAdministratorReads_thenEveryCheckIsOk() throws Exception {
        // given
        Instant backedUp = clock.instant().minus(Duration.ofHours(2));
        Files.writeString(EVIDENCE, "{\"completedAt\":\"" + backedUp + "\"}");
        notifications.recordHandedOver(memberAccount, MessageKind.ACCOUNT_WELCOME, "<a@example.org>",
                clock.instant().minus(Duration.ofMinutes(5)));

        // when / then
        mockMvc.perform(get("/api/admin/operator-health").with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version.state").value("OK"))
                .andExpect(jsonPath("$.version.version").isString())
                .andExpect(jsonPath("$.migrations.state").value("OK"))
                .andExpect(jsonPath("$.migrations.pending").value(0))
                .andExpect(jsonPath("$.migrations.currentVersion").isString())
                .andExpect(jsonPath("$.mail.state").value("OK"))
                .andExpect(jsonPath("$.publicOrigin.state").value("OK"))
                .andExpect(jsonPath("$.publicOrigin.origin").value("https://courts.example.org"))
                .andExpect(jsonPath("$.backup.state").value("OK"))
                .andExpect(jsonPath("$.backup.ageSeconds").value(greaterThanOrEqualTo(7_200)));
    }

    @Test
    void givenNoBackupRecordAndAFailingRelay_whenAnAdministratorReads_thenTheBackupIsUnavailableAndMailFails()
            throws Exception {
        // given
        notifications.queueRetry(memberAccount, MessageKind.ACCOUNT_WELCOME, "<b@example.org>",
                clock.instant(), clock.instant().plus(Duration.ofDays(1)));

        // when / then
        mockMvc.perform(get("/api/admin/operator-health").with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.backup.state").value("UNAVAILABLE"))
                .andExpect(jsonPath("$.backup.reason").value("NOT_RECORDED"))
                .andExpect(jsonPath("$.backup.ageSeconds").doesNotExist())
                .andExpect(jsonPath("$.mail.state").value("FAILING"))
                .andExpect(jsonPath("$.mail.reason").value("HANDOVER_FAILING"))
                .andExpect(jsonPath("$.mail.location").value("localhost:2525"));
    }

    @Test
    void givenNoMessageEverSettled_whenAnAdministratorReads_thenMailIsUnavailable() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/operator-health").with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mail.state").value("UNAVAILABLE"))
                .andExpect(jsonPath("$.mail.reason").value("NOT_YET_OBSERVED"));
    }

    @Test
    void givenAMember_whenReading_thenAccessIsDenied() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/operator-health").with(user(member)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    @Test
    void givenNoSession_whenReading_thenAuthenticationIsRequired() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/operator-health"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void givenNoBackupRecord_whenTheMetersAreRead_thenTheBoundedGaugesCarryNoLabels() throws Exception {
        // given
        Gauge backupAge = meters.get("courtside.backup.age").gauge();
        Gauge pending = meters.get("courtside.events.pending").gauge();

        // when
        double unrecorded = backupAge.value();
        Files.writeString(EVIDENCE, "{\"completedAt\":\"" + clock.instant().minus(Duration.ofHours(1)) + "\"}");

        // then
        assertThat(unrecorded).as("a missing backup record must never read as a fresh backup").isNaN();
        assertThat(backupAge.value()).isGreaterThanOrEqualTo(3_600);
        assertThat(backupAge.getId().getTags()).as("the backup age carries no labels").isEmpty();
        assertThat(pending.value()).isGreaterThanOrEqualTo(0);
        assertThat(pending.getId().getTags()).as("pending publications carry no labels").isEmpty();
    }

    private static Path evidenceDirectory() {
        try {
            return Files.createTempDirectory("courtside-backup-evidence");
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
    }
}
