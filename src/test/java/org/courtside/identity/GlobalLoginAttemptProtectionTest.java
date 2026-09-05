package org.courtside.identity;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.micrometer.core.instrument.MeterRegistry;
import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.InstanceOfAssertFactories.STRING;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = {
        "courtside.login-protection.address.max-failures=20",
        "courtside.login-protection.global.threshold=2"
})
class GlobalLoginAttemptProtectionTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private MeterRegistry meters;

    private final ListAppender<ILoggingEvent> recorded = new ListAppender<>();

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        recorded.start();
        observationLog().addAppender(recorded);
    }

    @AfterEach
    void tearDown() {
        observationLog().detachAppender(recorded);
        recorded.stop();
    }

    @Test
    void givenAttemptsWithDifferentAddressesAndUsernames_whenTheThresholdIsCrossed_thenLoginContinues()
            throws Exception {
        // given
        double observationsBefore = meters.counter("courtside.login.distributed.thresholds").count();
        mockMvc.perform(login("first", "192.0.2.61")).andExpect(status().isUnauthorized());
        mockMvc.perform(login("second", "192.0.2.62")).andExpect(status().isUnauthorized());

        // when / then
        mockMvc.perform(login("third-private-username", "192.0.2.63"))
                .andExpect(status().isUnauthorized());

        assertThat(meters.counter("courtside.login.distributed.thresholds").count())
                .isEqualTo(observationsBefore + 1);
        assertThat(recorded.list).filteredOn(event -> event.getLevel() == Level.WARN)
                .singleElement()
                .extracting(ILoggingEvent::getFormattedMessage)
                .asInstanceOf(STRING)
                .doesNotContain("third-private-username", "192.0.2.63");
    }

    @Test
    void givenTheGlobalThresholdWasCrossed_whenCheckingHealth_thenTheInstanceRemainsReady()
            throws Exception {
        // given
        mockMvc.perform(login("first", "192.0.2.71")).andExpect(status().isUnauthorized());
        mockMvc.perform(login("second", "192.0.2.72")).andExpect(status().isUnauthorized());

        // when / then
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }

    private static Logger observationLog() {
        return (Logger) LoggerFactory.getLogger(
                "org.courtside.identity.internal.LoginAttemptProtection");
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder login(
            String username, String address) {
        return post("/api/session")
                .param("username", username)
                .param("password", "wrong")
                .with(remoteAddress(address))
                .with(csrf());
    }

    private RequestPostProcessor remoteAddress(String address) {
        return request -> {
            request.setRemoteAddr(address);
            return request;
        };
    }
}
