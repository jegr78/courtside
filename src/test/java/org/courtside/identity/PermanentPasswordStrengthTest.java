package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.nio.charset.StandardCharsets;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class PermanentPasswordStrengthTest extends AbstractIntegrationTest {

    private static final String ISSUED = "issued-credential-9RtQ";
    private static final String REFUSED = "urn:courtside:error:password-too-guessable";
    private static final String CODE = "identity.password.tooGuessable";
    private static final String REUSED = "urn:courtside:error:password-reuses-credential";
    private static final String REUSED_CODE = "identity.password.reusesCredential";

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private PersonRepository persons;
    @Autowired
    private UserAccountRepository accounts;
    @Autowired
    private PasswordEncoder passwordEncoder;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        UserAccount account = new UserAccount(mary, "major.mary",
                passwordEncoder.encode(ISSUED), Set.of(Role.MEMBER), "de");
        account.enable();
        account.requirePasswordChange();
        accounts.save(account);
    }

    @Test
    void givenACommonPassword_whenItIsChosenAsThePermanentOne_thenItIsRefused() throws Exception {
        // when / then
        choose("q1w2e3r4t5y6")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(REFUSED))
                .andExpect(jsonPath("$.violations[0].code").value(CODE));
    }

    @Test
    void givenAPasswordBelowTheProductMinimum_whenItIsChosen_thenTheFieldIsNamed() throws Exception {
        // when / then
        choose("only-eleven")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("password"));
    }

    @Test
    void givenAPasswordUsingOnlyPunctuation_whenItIsChosen_thenItIsAcceptedAndSignsIn()
            throws Exception {
        // given
        String password = "!@#$%^&*()_+{}[]";

        // when
        choose(password).andExpect(status().isNoContent());

        // then
        mockMvc.perform(post("/api/session")
                        .param("username", "major.mary")
                        .param("password", password)
                        .with(csrf()))
                .andExpect(status().isOk());
    }

    // The shipped list mixes case and the policy folds both sides, so a differently-cased spelling
    // of an entry has to be refused like the entry itself.
    @Test
    void givenACommonPasswordInAnotherCase_whenItIsChosen_thenItIsRefusedTheSameWay() throws Exception {
        // when / then
        choose("Q1W2E3R4T5Y6")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(REFUSED))
                .andExpect(jsonPath("$.violations[0].code").value(CODE));
    }

    // Whoever read the message knows this one, and re-typing what a form already gave you is what
    // a member does when asked for a password they have.
    @Test
    void givenTheIssuedCredential_whenItIsChosenAsThePermanentOne_thenItIsRefused() throws Exception {
        // when / then
        choose(ISSUED)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(REUSED))
                .andExpect(jsonPath("$.violations[0].code").value(REUSED_CODE));
    }

    // One context term is enough here: this proves the policy hangs on the endpoint and which
    // type answers. Which source a term came from is PasswordPolicyTest's to separate.
    @Test
    void givenAPasswordCarryingTheClubName_whenItIsChosen_thenItIsRefused() throws Exception {
        // when / then
        choose("lattice-Courtside-scaffold")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(REFUSED))
                .andExpect(jsonPath("$.violations[0].code").value(CODE));
    }

    // The counter-case: without it a policy that refused everything would look identical, and the
    // refusals above would prove nothing about the passwords a member is meant to keep.
    @Test
    void givenAPassphraseInNoList_whenItIsChosen_thenItIsAcceptedAndSignsIn() throws Exception {
        // when
        choose("lattice-scaffold-marmoset-vellum").andExpect(status().isNoContent());

        // then
        mockMvc.perform(post("/api/session")
                        .param("username", "major.mary")
                        .param("password", "lattice-scaffold-marmoset-vellum")
                        .with(csrf()))
                .andExpect(status().isOk());
    }

    // The document bounds the field, so the bound is what answers rather than the reverse proxy's
    // body limit, which the member would see as a failure with nothing to read.
    @Test
    void givenAPasswordBeyondTheLengthTheContractAllows_whenItIsChosen_thenTheFieldIsNamed()
            throws Exception {
        // when / then
        choose("lattice-scaffold-".repeat(16))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("password"));
    }

    // Neither length nor an alphabet outside ASCII is a reason to refuse: a passphrase a member
    // actually types has to survive the policy, or the policy pushes them back to a short one.
    @Test
    void givenAPassphraseOfSixtyFourCharactersOutsideAscii_whenItIsChosen_thenItIsAcceptedAndSignsIn()
            throws Exception {
        // given
        String passphrase = "Ωμαρμοζέτ-σκαφφολδ-βελλουμ-λαττικε-γρανιτε-παπυρος-κιθαρα-ταβερνα";
        assertThat(passphrase).hasSizeGreaterThanOrEqualTo(64);

        // when
        choose(passphrase).andExpect(status().isNoContent());

        // then
        mockMvc.perform(post("/api/session")
                        .param("username", "major.mary")
                        .param("password", passphrase)
                        .with(csrf()))
                .andExpect(status().isOk());
    }

    private ResultActions choose(String password) throws Exception {
        return mockMvc.perform(put("/api/account/initial-password")
                .session(signedIn())
                .with(csrf())
                .contentType("application/json")
                .content(("{\"password\":\"" + password + "\"}").getBytes(StandardCharsets.UTF_8)));
    }

    private MockHttpSession signedIn() throws Exception {
        return (MockHttpSession) mockMvc.perform(post("/api/session")
                        .param("username", "major.mary")
                        .param("password", ISSUED)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andReturn().getRequest().getSession(false);
    }
}
