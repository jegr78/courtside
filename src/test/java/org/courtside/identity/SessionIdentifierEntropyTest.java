package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.session.Session;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;

import java.util.Base64;
import java.util.HashSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class SessionIdentifierEntropyTest extends AbstractIntegrationTest {

    private static final String UUID_SHAPE =
            "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    private static final int REQUIRED_BITS = 128;

    @Autowired
    private JdbcIndexedSessionRepository sessions;

    @Test
    void whenASessionIsCreated_thenItsIdentifierIsNotAVersionFourUuid() {
        // when
        Session created = sessions.createSession();
        String identifier = created.getId();

        // then
        assertThat(identifier)
                .as("a UUID string is itself 36 base64url characters and decodes to 27 bytes, so"
                        + " counting decoded material passes on the generator this rejects; the"
                        + " shape is what tells the two apart")
                .doesNotMatch(UUID_SHAPE);
    }

    @Test
    void whenASessionIdentifierIsChanged_thenTheReplacementIsNotAVersionFourUuidEither() {
        // given
        Session session = sessions.createSession();
        String original = session.getId();

        // when
        String replacement = session.changeSessionId();

        // then
        assertThat(replacement)
                .as("rotation draws from the repository's generator, so a generator wired only for"
                        + " creation would leave every renewed identifier at the default")
                .doesNotMatch(UUID_SHAPE)
                .isNotEqualTo(original);
    }

    @Test
    void whenManyIdentifiersAreGenerated_thenEachCarriesTheRequiredMaterialAndNoneRepeats() {
        // given
        Set<String> generated = new HashSet<>();

        // when
        for (int draw = 0; draw < 500; draw++) {
            Session drawn = sessions.createSession();
            generated.add(drawn.getId());
        }

        // then
        assertThat(generated).as("a constant or a short cycle would collapse the draws").hasSize(500);
        for (String identifier : generated) {
            assertThat(Base64.getUrlDecoder().decode(identifier).length * 8)
                    .as("ASVS v5.0.0-7.2.3 asks for at least %d bits behind the identifier %s",
                            REQUIRED_BITS, identifier)
                    .isGreaterThanOrEqualTo(REQUIRED_BITS);
        }
    }
}
