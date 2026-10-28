package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.health.contributor.Status;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;

class MfaKeysHealthTest {
    @Test
    void givenUnvalidatedKeyMaterial_whenPollingHealth_thenRestoreCannotMistakeTheListeningServerForAValidatedInstance() {
        // given
        MfaKeysHealth health = new MfaKeysHealth();
        // when / then
        assertThat(health.health().getStatus()).isEqualTo(Status.OUT_OF_SERVICE);
    }

    @Test
    void givenSuccessfulKeyValidation_whenTheStartupRunnerFinishes_thenHealthMayReportSuccess() throws Exception {
        // given
        MfaKeysHealth health = new MfaKeysHealth();
        MfaSecrets secrets = mock(MfaSecrets.class);
        // when
        new MfaConfiguration().validateMfaKeys(secrets, health).run(new DefaultApplicationArguments());
        // then
        assertThat(health.health().getStatus()).isEqualTo(Status.UP);
    }

    @Test
    void givenMissingOrWrongKeys_whenTheStartupRunnerFails_thenHealthNeverReportsSuccess() {
        // given
        MfaKeysHealth health = new MfaKeysHealth();
        MfaSecrets secrets = mock(MfaSecrets.class);
        doThrow(new IllegalStateException("The matching MFA key is missing")).when(secrets).initialize();
        // when / then
        assertThatThrownBy(() -> new MfaConfiguration().validateMfaKeys(secrets, health).run(new DefaultApplicationArguments()))
                .isInstanceOf(IllegalStateException.class);
        assertThat(health.health().getStatus()).isEqualTo(Status.OUT_OF_SERVICE);
    }
}
