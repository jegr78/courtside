package org.courtside.demo;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration(proxyBeanMethods = false)
@Profile("demo")
@EnableConfigurationProperties(DemoProperties.class)
class DemoConfiguration {
}
