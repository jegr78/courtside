package org.courtside.shared;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

// Registration is what makes a diagnosis reach an operator, and only a real start proves it.
@ExtendWith(OutputCaptureExtension.class)
class DatabaseTlsStartupTest {

    @Test
    void givenAMissingAnchor_whenTheApplicationStarts_thenTheReportNamesTheMissingMaterial(
            CapturedOutput output) {
        // when
        Throwable failure = catchThrowable(() -> new SpringApplicationBuilder(VerifiedPool.class)
                .web(WebApplicationType.NONE)
                .bannerMode(org.springframework.boot.Banner.Mode.OFF)
                .run("--courtside.database.tls.mode=verify-full"));

        // then
        assertThat(failure).isNotNull();
        assertThat(output.getOut())
                .contains("APPLICATION FAILED TO START")
                .contains("courtside.database.tls.root-certificate names no file")
                .contains("set courtside.database.tls.mode back to prefer");
    }

    @Configuration(proxyBeanMethods = false)
    @org.springframework.context.annotation.Import(DatabaseTlsConfiguration.class)
    static class VerifiedPool {

        @Bean
        HikariDataSource pool() {
            HikariDataSource dataSource = new HikariDataSource();
            dataSource.setJdbcUrl("jdbc:postgresql://db:5432/courtside");
            return dataSource;
        }
    }
}
