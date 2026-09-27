package org.courtside.uatseed;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Profile;

import java.time.Clock;

@SpringBootApplication
@Profile("uat-seed")
public class UatBookingSeedApplication {

    @Bean
    Clock seedClock() {
        return Clock.systemUTC();
    }

    public static void main(String[] args) {
        SpringApplication application = new SpringApplication(UatBookingSeedApplication.class);
        application.setWebApplicationType(WebApplicationType.NONE);
        application.setRegisterShutdownHook(false);
        try (ConfigurableApplicationContext context = application.run(args)) {
            UatBookingSeedReport report = context.getBean(UatBookingSeeder.class).seed();
            System.out.println(report.summary());
        }
    }
}
