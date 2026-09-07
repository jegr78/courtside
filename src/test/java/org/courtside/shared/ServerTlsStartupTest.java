package org.courtside.shared;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.Banner;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

// Registration is what makes a diagnosis reach an operator, and only a real start proves it.
@ExtendWith(OutputCaptureExtension.class)
class ServerTlsStartupTest {

    @Test
    void givenNoCertificate_whenTheApplicationStarts_thenTheReportNamesTheMissingMaterial(
            CapturedOutput output) {
        // when
        Throwable failure = catchThrowable(() ->
                new SpringApplicationBuilder(ServerTlsConfiguration.class)
                        .web(WebApplicationType.NONE)
                        .bannerMode(Banner.Mode.OFF)
                        .run("--courtside.server.tls.mode=serve"));

        // then
        assertThat(failure).isNotNull();
        assertThat(output.getOut())
                .contains("APPLICATION FAILED TO START")
                .contains("courtside.server.tls.certificate names no file")
                .contains("set courtside.server.tls.mode back to plaintext");
    }
}
