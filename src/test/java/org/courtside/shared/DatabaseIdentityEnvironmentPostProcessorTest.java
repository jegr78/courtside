package org.courtside.shared;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.SpringApplication;
import org.springframework.mock.env.MockEnvironment;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DatabaseIdentityEnvironmentPostProcessorTest {

    @TempDir
    private Path temporaryDirectory;

    @Test
    void givenTheSharedMode_whenTheEnvironmentIsProcessed_thenTheExistingDatasourceIsUntouched() {
        // given
        MockEnvironment environment = new MockEnvironment()
                .withProperty("spring.datasource.username", "courtside")
                .withProperty("spring.datasource.password", "existing-secret");

        // when
        new DatabaseIdentityEnvironmentPostProcessor()
                .postProcessEnvironment(environment, new SpringApplication());

        // then
        assertThat(environment.getProperty("spring.datasource.username")).isEqualTo("courtside");
        assertThat(environment.getProperty("spring.datasource.password")).isEqualTo("existing-secret");
        assertThat(environment.getProperty("spring.flyway.enabled")).isNull();
    }

    @Test
    void givenAFileIdentityInputInSharedMode_whenTheEnvironmentIsProcessed_thenItRefusesThePartialMode() {
        // given
        MockEnvironment environment = new MockEnvironment()
                .withProperty("courtside.database.identity.runtime-password-file", "/run/secrets/runtime");

        // when / then
        assertThatThrownBy(() -> new DatabaseIdentityEnvironmentPostProcessor()
                .postProcessEnvironment(environment, new SpringApplication()))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("courtside.database.identity.mode");
    }

    @Test
    void givenAnUnknownIdentityMode_whenTheEnvironmentIsProcessed_thenItRefusesTheTypo() {
        // given
        MockEnvironment environment = new MockEnvironment()
                .withProperty("courtside.database.identity.mode", "seperate");

        // when / then
        assertThatThrownBy(() -> new DatabaseIdentityEnvironmentPostProcessor()
                .postProcessEnvironment(environment, new SpringApplication()))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("seperate")
                .hasMessageContaining("not shared or separate");
    }

    @Test
    void givenASeparateRuntimeIdentity_whenTheEnvironmentIsProcessed_thenOnlyItsFileConfiguresThePool()
            throws Exception {
        // given
        Path password = Files.writeString(temporaryDirectory.resolve("runtime-password"), "file-secret\n");
        MockEnvironment environment = separate(password);

        // when
        new DatabaseIdentityEnvironmentPostProcessor()
                .postProcessEnvironment(environment, new SpringApplication());

        // then
        assertThat(environment.getProperty("spring.datasource.username")).isEqualTo("courtside_runtime");
        assertThat(environment.getProperty("spring.datasource.password")).isEqualTo("file-secret");
        assertThat(environment.getProperty("spring.flyway.enabled")).isEqualTo("false");
        assertThat(environment.getProperty("spring.session.jdbc.initialize-schema")).isEqualTo("never");
        assertThat(environment.getProperty("spring.flyway.user")).isNull();
        assertThat(environment.getProperty("spring.flyway.password")).isNull();
    }

    @Test
    void givenAWindowsLineEndingInTheSecretFile_whenTheEnvironmentIsProcessed_thenItIsRemoved()
            throws Exception {
        // given
        Path password = Files.writeString(temporaryDirectory.resolve("runtime-password"),
                "file-secret\r\n");
        MockEnvironment environment = separate(password);

        // when
        new DatabaseIdentityEnvironmentPostProcessor()
                .postProcessEnvironment(environment, new SpringApplication());

        // then
        assertThat(environment.getProperty("spring.datasource.password")).isEqualTo("file-secret");
    }

    @Test
    void givenASeparateIdentityWithoutASecretPath_whenTheEnvironmentIsProcessed_thenItRefusesStartup() {
        // given
        MockEnvironment environment = new MockEnvironment()
                .withProperty("courtside.database.identity.mode", "separate")
                .withProperty("courtside.database.identity.runtime-username", "courtside_runtime");

        // when / then
        assertThatThrownBy(() -> new DatabaseIdentityEnvironmentPostProcessor()
                .postProcessEnvironment(environment, new SpringApplication()))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("runtime-password-file")
                .hasMessageContaining("names no file");
    }

    @Test
    void givenASeparateIdentityAndDirectCredentials_whenTheEnvironmentIsProcessed_thenItRefusesAmbiguity()
            throws Exception {
        // given
        Path password = Files.writeString(temporaryDirectory.resolve("runtime-password"), "file-secret\n");
        MockEnvironment environment = separate(password)
                .withProperty("spring.datasource.password", "environment-secret");

        // when / then
        assertThatThrownBy(() -> new DatabaseIdentityEnvironmentPostProcessor()
                .postProcessEnvironment(environment, new SpringApplication()))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("spring.datasource.password")
                .hasMessageNotContaining("environment-secret")
                .hasMessageNotContaining("file-secret");
    }

    @Test
    void givenAHikariCredentialOverride_whenTheEnvironmentIsProcessed_thenItIsRefused()
            throws Exception {
        // given
        Path password = Files.writeString(temporaryDirectory.resolve("runtime-password"), "file-secret\n");
        MockEnvironment environment = separate(password)
                .withProperty("spring.datasource.hikari.password", "override-secret");

        // when / then
        assertThatThrownBy(() -> new DatabaseIdentityEnvironmentPostProcessor()
                .postProcessEnvironment(environment, new SpringApplication()))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("spring.datasource.hikari.password")
                .hasMessageNotContaining("override-secret")
                .hasMessageNotContaining("file-secret");
    }

    @Test
    void givenAUrlCredentialOverride_whenTheEnvironmentIsProcessed_thenItIsRefused()
            throws Exception {
        // given
        Path password = Files.writeString(temporaryDirectory.resolve("runtime-password"), "file-secret\n");
        MockEnvironment environment = separate(password)
                .withProperty("spring.datasource.url",
                        "jdbc:postgresql://db:5432/courtside?user=owner&password=url-secret");

        // when / then
        assertThatThrownBy(() -> new DatabaseIdentityEnvironmentPostProcessor()
                .postProcessEnvironment(environment, new SpringApplication()))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("connection URL")
                .hasMessageNotContaining("url-secret")
                .hasMessageNotContaining("file-secret");
    }

    @Test
    void givenASeparateIdentityWithoutAUsername_whenTheEnvironmentIsProcessed_thenItNamesTheMissingInput()
            throws Exception {
        // given
        Path password = Files.writeString(temporaryDirectory.resolve("runtime-password"), "file-secret\n");
        MockEnvironment environment = new MockEnvironment()
                .withProperty("courtside.database.identity.mode", "separate")
                .withProperty("courtside.database.identity.runtime-password-file", password.toString());

        // when / then
        assertThatThrownBy(() -> new DatabaseIdentityEnvironmentPostProcessor()
                .postProcessEnvironment(environment, new SpringApplication()))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("courtside.database.identity.runtime-username");
    }

    @Test
    void givenASeparateIdentityWithoutAReadableFile_whenTheEnvironmentIsProcessed_thenItNamesThePath()
            throws Exception {
        // given
        Path absent = temporaryDirectory.resolve("absent-password");

        // when / then
        assertThatThrownBy(() -> new DatabaseIdentityEnvironmentPostProcessor()
                .postProcessEnvironment(separate(absent), new SpringApplication()))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining(absent.toString())
                .hasMessageContaining("does not exist or cannot be read");
    }

    @Test
    void givenAnEmptySecretFile_whenTheEnvironmentIsProcessed_thenItRefusesWithoutEchoingMaterial()
            throws Exception {
        // given
        Path password = Files.createFile(temporaryDirectory.resolve("empty-password"));

        // when / then
        assertThatThrownBy(() -> new DatabaseIdentityEnvironmentPostProcessor()
                .postProcessEnvironment(separate(password), new SpringApplication()))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("is empty");
    }

    @Test
    void givenAMultilineSecretFile_whenTheEnvironmentIsProcessed_thenItRefusesTheAmbiguousValue()
            throws Exception {
        // given
        Path password = Files.writeString(temporaryDirectory.resolve("multiline-password"),
                "first-line\nsecond-line\n");

        // when / then
        assertThatThrownBy(() -> new DatabaseIdentityEnvironmentPostProcessor()
                .postProcessEnvironment(separate(password), new SpringApplication()))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("more than one line")
                .hasMessageNotContaining("first-line")
                .hasMessageNotContaining("second-line");
    }

    private static MockEnvironment separate(Path password) {
        return new MockEnvironment()
                .withProperty("courtside.database.identity.mode", "separate")
                .withProperty("courtside.database.identity.runtime-username", "courtside_runtime")
                .withProperty("courtside.database.identity.runtime-password-file", password.toString());
    }
}
