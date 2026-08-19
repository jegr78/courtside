package org.courtside.securityassessment;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration(proxyBeanMethods = false)
@Profile("security")
@EnableConfigurationProperties(SecurityAssessmentProperties.class)
class SecurityAssessmentConfiguration {
}
