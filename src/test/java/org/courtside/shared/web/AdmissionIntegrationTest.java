package org.courtside.shared.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.SqlStatementCounter;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = {
        "courtside.admission.address.burst=20",
        "courtside.admission.address.per-second=1"})
class AdmissionIntegrationTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private SqlStatementCounter queries;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @AfterEach
    void stopCounting() {
        queries.reset();
    }

    private static RequestPostProcessor from(String address) {
        return request -> {
            request.setRemoteAddr(address);
            return request;
        };
    }

    @Test
    void givenAnAddressThatSpentItsBudget_whenItRequestsAgain_thenItIsRefusedWithATypedProblemBeforeAnyQuery()
            throws Exception {
        // given
        for (int admitted = 0; admitted < 20; admitted++) {
            mockMvc.perform(get("/api/public/booking-grid").with(from("192.0.2.21"))).andExpect(status().isOk());
        }
        queries.reset();

        // when / then
        mockMvc.perform(get("/api/public/booking-grid").with(from("192.0.2.21")))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "1"))
                .andExpect(jsonPath("$.type").value("urn:courtside:error:request-rate-limited"))
                .andExpect(jsonPath("$.violations[0].code").value("admission.rateLimited"));
        assertThat(queries.snapshot().total()).as("a refused request must not reach the database").isZero();
    }

    @Test
    void givenADemandingOperation_whenAnAddressRequestsIt_thenItSpendsItsClassCost() throws Exception {
        // given
        for (int admitted = 0; admitted < 10; admitted++) {
            mockMvc.perform(get("/api/public/courts").with(from("192.0.2.22"))).andExpect(status().isOk());
        }

        // when / then
        mockMvc.perform(get("/api/public/courts").with(from("192.0.2.22")))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:request-rate-limited"));
        mockMvc.perform(get("/api/public/booking-grid").with(from("192.0.2.23")))
                .andExpect(status().isOk());
    }
}
