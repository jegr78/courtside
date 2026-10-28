package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.Status;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;

class MfaKeysHealthTest {
    @Test
    void givenUnvalidatedKeyMaterial_whenPollingHealth_thenRestoreCannotMistakeTheListeningServerForAValidatedInstance() {
        // given
        MfaKeysHealth health = new MfaKeysHealth(mock(MfaSecrets.class));
        // when / then
        assertThat(health.health().getStatus()).isEqualTo(Status.OUT_OF_SERVICE);
    }

    @Test
    void givenSuccessfulKeyValidation_whenTheStartupRunnerFinishes_thenHealthMayReportSuccess() throws Exception {
        // given
        MfaSecrets secrets = mock(MfaSecrets.class);
        MfaKeysHealth health = new MfaKeysHealth(secrets);
        // when
        new MfaConfiguration().validateMfaKeys(secrets, health).run(new DefaultApplicationArguments());
        // then
        assertThat(health.health().getStatus()).isEqualTo(Status.UP);
    }

    @Test
    void givenMissingOrWrongKeys_whenTheStartupRunnerFails_thenHealthNeverReportsSuccess() {
        // given
        MfaSecrets secrets = mock(MfaSecrets.class);
        MfaKeysHealth health = new MfaKeysHealth(secrets);
        doThrow(new IllegalStateException("The matching MFA key is missing")).when(secrets).initialize();
        // when / then
        assertThatThrownBy(() -> new MfaConfiguration().validateMfaKeys(secrets, health).run(new DefaultApplicationArguments()))
                .isInstanceOf(IllegalStateException.class);
        assertThat(health.health().getStatus()).isEqualTo(Status.OUT_OF_SERVICE);
    }

    @Test
    void givenAValidatedInstance_whenItsKeyMaterialIsLostAtRuntime_thenHealthReportsDownWithTheReason() throws Exception {
        // given
        MfaSecrets secrets = mock(MfaSecrets.class);
        MfaKeysHealth health = new MfaKeysHealth(secrets);
        new MfaConfiguration().validateMfaKeys(secrets, health).run(new DefaultApplicationArguments());
        doThrow(new IllegalStateException("MFA instance key file is missing; restore the matching key material"))
                .when(secrets).verify();
        // when
        Health lost = health.health();
        // then
        assertThat(lost.getStatus()).as("lost key material must not stay UP").isEqualTo(Status.DOWN);
        assertThat(lost.getDetails()).as("the health result retains why the key material failed")
                .containsEntry("reason", "MFA instance key file is missing; restore the matching key material");
    }

    @Test
    void givenLostKeyMaterial_whenItIsRestored_thenHealthRecovers() throws Exception {
        // given
        MfaSecrets secrets = mock(MfaSecrets.class);
        MfaKeysHealth health = new MfaKeysHealth(secrets);
        new MfaConfiguration().validateMfaKeys(secrets, health).run(new DefaultApplicationArguments());
        doThrow(new IllegalStateException("MFA instance key file is missing")).when(secrets).verify();
        assertThat(health.health().getStatus()).isEqualTo(Status.DOWN);
        doNothing().when(secrets).verify();
        // when
        Health restored = health.health();
        // then
        assertThat(restored.getStatus()).as("restored key material reports UP again").isEqualTo(Status.UP);
    }
}
