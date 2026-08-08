package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AdminAuthorizationTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenNoAuthentication_whenCallingAnAdminEndpoint_thenItIsUnauthorised() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/config"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.title").value("Not authenticated"))
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenARoleThatIsNotAdmin_whenCallingAnAdminEndpoint_thenItIsForbidden() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/config"))
                .andExpect(status().isForbidden());
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnAdmin_whenCallingAnAdminEndpoint_thenItIsServed() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/config"))
                .andExpect(status().isOk());
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAMember_whenCallingAnUnknownAdminPath_thenItIsForbiddenRatherThanNotFound()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/does-not-exist"))
                .andExpect(status().isForbidden());
    }

    @Test
    void givenNoAuthenticationAndNoCsrfToken_whenMutatingAnAdminEndpoint_thenCsrfIsCheckedBeforeAuthentication()
            throws Exception {
        // when / then — CsrfFilter runs before AuthorizationFilter, so an unauthenticated
        // mutation without a token is refused for the missing token, not the missing session
        mockMvc.perform(put("/api/admin/config").contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail").value("You are not allowed to perform this request"));
    }
}
