package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.EncryptedSecretHolder;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.context.WebApplicationContext;

import java.nio.file.Path;
import java.time.Clock;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class InstanceSecretHoldersTest extends AbstractIntegrationTest {

    @Autowired private WebApplicationContext context;
    @Autowired private UserDetailsService userDetails;
    @Autowired private IdentityTestFixture identity;
    @Autowired private JdbcClient jdbc;
    @Autowired private PlatformTransactionManager transactions;
    @Autowired private ObjectProvider<EncryptedSecretHolder> holders;
    @Autowired private Clock clock;
    @Value("${courtside.mfa.key-root:}") private String keyRoot;
    @Value("${courtside.mfa.key-file:}") private String keyFile;
    @TempDir private Path elsewhere;

    @Test
    void givenAPayPalSecretSavedThroughTheApi_whenTheInstanceStartsAgain_thenItNeedsTheSameKeyFile() throws Exception {
        // given
        jdbc.sql("UPDATE account_mfa SET totp_secret = NULL, pending_totp_secret = NULL").update();
        identity.createEnabledAccount(identity.createPerson("Richard", "Miles", "richard.miles@example.org"),
                "miles.richard", Set.of(Role.MEMBER, Role.TREASURER));
        MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build()
                .perform(put("/api/treasury/paypal").with(user(userDetails.loadUserByUsername("miles.richard")))
                        .with(csrf()).sessionAttr("courtside.authenticated-at", clock.instant().toEpochMilli())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientId\":\"client-1\",\"environment\":\"SANDBOX\",\"enabled\":true,"
                                + "\"secret\":\"paypal-secret-value\"}"))
                .andExpect(status().isOk());
        assertThat(holders.orderedStream().flatMap(holder -> holder.storedSecrets().stream()))
                .as("the stored PayPal secret is declared to the key ring").hasSize(1);

        // when / then
        secretsAt(MfaConfiguration.keyRoot(keyRoot, MfaConfiguration.IMAGE_KEY_ROOT),
                keyFile.isBlank() ? null : Path.of(keyFile)).initialize();
        assertThatThrownBy(() -> secretsAt(elsewhere, null).initialize())
                .as("without its key file the instance refuses to start")
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("key file is missing");
    }

    private MfaSecrets secretsAt(Path root, Path suppliedFile) {
        return new MfaSecrets(jdbc, transactions, root, suppliedFile, () -> holders.orderedStream().toList());
    }
}
