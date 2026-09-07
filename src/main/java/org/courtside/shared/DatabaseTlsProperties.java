package org.courtside.shared;

import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.nio.file.Path;

@Validated
@ConfigurationProperties("courtside.database.tls")
record DatabaseTlsProperties(@NotNull Mode mode, Path rootCertificate) {

    enum Mode {
        PREFER,
        DISABLE,
        VERIFY_FULL
    }
}
