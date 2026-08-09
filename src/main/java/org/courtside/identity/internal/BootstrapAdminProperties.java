package org.courtside.identity.internal;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("courtside.bootstrap-admin")
record BootstrapAdminProperties(String username, String password, String displayName) {
}
