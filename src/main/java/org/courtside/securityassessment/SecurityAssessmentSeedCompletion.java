package org.courtside.securityassessment;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Profile;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

@Component
@Profile("security")
@ConditionalOnProperty(name = "courtside.security-assessment.seed-only", havingValue = "true")
@Order(Ordered.LOWEST_PRECEDENCE)
@RequiredArgsConstructor
class SecurityAssessmentSeedCompletion implements ApplicationRunner {

    private final ConfigurableApplicationContext context;

    // The scheduling threads are not daemons, so closing the context is not enough to end the process.
    @Override
    public void run(ApplicationArguments arguments) {
        System.exit(SpringApplication.exit(context));
    }
}
