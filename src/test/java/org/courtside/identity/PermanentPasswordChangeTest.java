package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.text.Normalizer;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.identity.AccountFixtures.enabled;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class PermanentPasswordChangeTest extends AbstractIntegrationTest {

    private static final String CURRENT = "correct-horse-battery";
    private static final String REPLACEMENT = "lattice-scaffold-marmoset-vellum";

    @Autowired private WebApplicationContext context;
    @Autowired private PersonRepository persons;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder encoder;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        Person person = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        accounts.save(enabled(new UserAccount(person, "doe.jane", encoder.encode(CURRENT),
                Set.of(Role.MEMBER), "en")));
    }

    @Test
    void givenTwoActiveSessions_whenThePasswordIsReplaced_thenBothEndAndOnlyTheReplacementSignsIn()
            throws Exception {
        // given
        MockHttpSession otherSession = signIn(CURRENT);
        MockHttpSession session = signIn(CURRENT);

        // when
        mockMvc.perform(put("/api/account/password").session(session).with(csrf())
                        .contentType("application/json")
                        .content(change(CURRENT, REPLACEMENT)))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/session").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
        mockMvc.perform(get("/api/session").session(otherSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
        signIn(REPLACEMENT);
    }

    @Test
    void givenAWrongCurrentPassword_whenReplacementIsRequested_thenNothingChanges() throws Exception {
        // given
        MockHttpSession session = signIn(CURRENT);

        // when / then
        mockMvc.perform(put("/api/account/password").session(session).with(csrf())
                        .contentType("application/json")
                        .content(change("not-the-current-password", REPLACEMENT)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:reauthentication-failed"))
                .andExpect(jsonPath("$.violations[0].code").value("identity.reauthentication.failed"));

        // then
        mockMvc.perform(get("/api/session").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true));
        signIn(CURRENT);
    }

    @Test
    void givenALongUnicodePassphrase_whenItReplacesThePassword_thenItCanSignIn() throws Exception {
        // given
        String replacement = "Ωμαρμοζέτ-σκαφφολδ-βελλουμ-λαττικε-γρανιτε-παπυρος-κιθαρα-ταβερνα";
        assertThat(replacement).hasSizeGreaterThanOrEqualTo(64);
        MockHttpSession session = signIn(CURRENT);

        // when
        mockMvc.perform(put("/api/account/password").session(session).with(csrf())
                        .contentType("application/json").content(change(CURRENT, replacement)))
                .andExpect(status().isNoContent());

        // then
        signIn(replacement);
    }

    @Test
    void givenCanonicallyEquivalentPasswords_whenOneBecomesPermanent_thenOnlyItsExactBytesSignIn()
            throws Exception {
        // given
        String replacement = "Marmóset-Lattice-" + "vellum".repeat(20) + "-FinalZ";
        String normalizedVariant = Normalizer.normalize(replacement, Normalizer.Form.NFD);
        assertThat(normalizedVariant).isNotEqualTo(replacement);
        MockHttpSession session = signIn(CURRENT);

        // when
        mockMvc.perform(put("/api/account/password").session(session).with(csrf())
                        .contentType("application/json").content(change(CURRENT, replacement)))
                .andExpect(status().isNoContent());

        // then
        signIn(replacement);
        for (String changed : Set.of(normalizedVariant, replacement.toLowerCase(java.util.Locale.ROOT),
                replacement.substring(0, replacement.length() - 7))) {
            mockMvc.perform(post("/api/session")
                            .param("username", "doe.jane")
                            .param("password", changed)
                            .with(csrf()))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
        }
    }

    private MockHttpSession signIn(String password) throws Exception {
        return (MockHttpSession) mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane").param("password", password).with(csrf()))
                .andExpect(status().isOk())
                .andReturn().getRequest().getSession(false);
    }

    private static String change(String currentPassword, String replacement) {
        return "{\"currentPassword\":\"" + currentPassword
                + "\",\"newPassword\":\"" + replacement + "\"}";
    }
}
