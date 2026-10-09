package org.courtside.shared;

import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.nio.file.Path;

@Validated
@ConfigurationProperties("courtside.server.tls")
public record ServerTlsProperties(@NotNull Mode mode, Path certificate, Path privateKey) {

    public enum Mode {
        PLAINTEXT,
        SERVE
    }
}
