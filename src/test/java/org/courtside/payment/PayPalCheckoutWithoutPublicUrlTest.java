package org.courtside.payment;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.payment.testfixture.PaymentTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({IdentityTestFixture.class, PaymentTestFixture.class})
class PayPalCheckoutWithoutPublicUrlTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private UserDetailsService userDetails;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private PaymentTestFixture payment;
    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        identity.createEnabledAccount(identity.createPerson("John", "Roe", "john.roe@example.org"), "roe.john",
                Set.of(Role.EXTERNAL));
        payment.storePayPalCredentials("SANDBOX", "client-sandbox", "paypal-secret-value");
    }

    @Test
    void givenNoPublicUrl_whenTheOrderIsCreated_thenPublicUrlMissingIsReported() throws Exception {
        // when
        mockMvc.perform(post("/api/payments/paypal/orders").with(csrf())
                        .with(user(userDetails.loadUserByUsername("roe.john")))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"bookingId\":\"" + UUID.randomUUID() + "\"}"))

                // then
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:paypal-public-url-missing"))
                .andExpect(jsonPath("$.violations[0].code").value("payment.paypal.publicUrlMissing"));
        assertThat(jdbc.sql("SELECT count(*) FROM paypal_order").query(Long.class).single()).isZero();
    }

    @Test
    void givenNoPublicUrl_whenTheBookerAsks_thenPayPalIsNotAvailable() throws Exception {
        // when
        mockMvc.perform(get("/api/payments/paypal/availability").with(user(userDetails.loadUserByUsername("roe.john"))))

                // then
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.available").value(false));
    }
}
