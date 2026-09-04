package org.courtside.dataexchange;

import org.courtside.AbstractIntegrationTest;
import org.courtside.dataexchange.internal.ImportPreviewRepository;
import org.courtside.dataexchange.internal.ImportRunRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccountRepository;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({IdentityTestFixture.class, MemberTestFixture.class})
class ImportRecordSurvivalTest extends AbstractIntegrationTest {

    private static final UUID MEMBERSHIP_TYPE_ID =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    private static final String TWO_ROWS = """
            Member number,First name,Last name,Email
            4711,Janet,Doe,jane.doe@example.org
            4712,John,Roe,john.roe@example.org
            """;

    @Autowired
    private PreviewService previews;

    @Autowired
    private ExecutionService executions;

    @Autowired
    private ImportSourceService sources;

    @Autowired
    private ImportPreviewRepository storedPreviews;

    @Autowired
    private ImportRunRepository storedRuns;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private IdentityTestFixture identity;

    private UUID source;

    private UUID account;

    @BeforeEach
    void setUp() {
        source = sources.create("roster-system", "Membership system", ",", "UTF-8",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME,
                        "Email", CanonicalField.EMAIL),
                Map.of(), MEMBERSHIP_TYPE_ID,
                Set.of(CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME), 10).sourceId();
        UUID person = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        account = identity.createAccount(person, "admin", Set.of(Role.ADMIN));
    }

    @Test
    void givenAnImportSomebodyRan_whenTheirAccountIsRemoved_thenTheRunAndItsPreviewRemain() {
        // given
        UUID previewId = previews.create(source, SnapshotMode.FULL_SNAPSHOT, "UTF-8", "roster.csv",
                TWO_ROWS.getBytes(StandardCharsets.UTF_8), account).previewId();
        UUID runId = executions.execute(previewId, false, account).runId();

        // when
        accounts.deleteById(account);
        accounts.flush();

        // then
        assertThat(accounts.existsById(account)).isFalse();
        assertThat(storedRuns.findById(runId).orElseThrow().getExecutedByAccountId())
                .isEqualTo(account);
        assertThat(storedPreviews.findById(previewId).orElseThrow().getCreatedByAccountId())
                .isEqualTo(account);
    }
}
