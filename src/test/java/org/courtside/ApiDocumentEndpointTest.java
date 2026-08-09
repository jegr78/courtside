package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

class ApiDocumentEndpointTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Test
    void whenFetchingTheDocument_thenItIsByteForByteTheOneOnTheClasspath() throws Exception {
        MockMvc mockMvc = MockMvcBuilders.webAppContextSetup(context).build();

        byte[] served = mockMvc.perform(get("/api/openapi.yaml"))
                .andReturn().getResponse().getContentAsByteArray();

        assertThat(new String(served, StandardCharsets.UTF_8))
                .isEqualTo(new ClassPathResource("api/openapi.yaml")
                        .getContentAsString(StandardCharsets.UTF_8));
    }
}
