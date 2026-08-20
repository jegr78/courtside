package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import java.nio.file.Files;
import java.nio.file.Path;
import static org.assertj.core.api.Assertions.assertThat;

class TestcontainersConfigurationTest {

    @Test
    void givenMultipleSpringContexts_whenRequestingPostgres_thenTheyShareOneJvmContainer() {
        // given
        TestcontainersConfiguration firstContext = new TestcontainersConfiguration();
        TestcontainersConfiguration secondContext = new TestcontainersConfiguration();

        // when
        Object first = TestcontainersConfiguration.sharedPostgres();
        Object second = TestcontainersConfiguration.sharedPostgres();

        // then
        assertThat(second).isSameAs(first);
        assertThat(firstContext.postgresConnectionDetails(new MockEnvironment()).getJdbcUrl())
                .isNotEqualTo(secondContext.postgresConnectionDetails(new MockEnvironment()).getJdbcUrl());
    }

    @Test
    void givenCachedSpringContexts_whenConfiguringTestPools_thenIdleConnectionsStayBounded() throws Exception {
        // given
        String configuration = Files.readString(Path.of("src/test/resources/application-test.yaml"));

        // when / then
        assertThat(configuration).contains("maximum-pool-size: 4", "minimum-idle: 0");
    }
}
