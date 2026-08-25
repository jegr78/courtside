package org.courtside.booking.internal;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration(proxyBeanMethods = false)
class BookingConfiguration {

    // A closure can reach every future booking on a court, and the board that pressed the button
    // must not wait for the last of them before its own page answers.
    @Bean
    @ConditionalOnMissingBean(name = "closureAnnouncementExecutor")
    TaskExecutor closureAnnouncementExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(2);
        executor.setThreadNamePrefix("closure-announcement-");
        executor.initialize();
        return executor;
    }
}
