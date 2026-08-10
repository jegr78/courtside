package org.courtside.demo;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("courtside.demo")
record DemoProperties(boolean confirmDisposable, String memberPassword) {
}
