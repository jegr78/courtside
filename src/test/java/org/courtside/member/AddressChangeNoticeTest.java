package org.courtside.member;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.Duration;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

@Import(IdentityTestFixture.class)
class AddressChangeNoticeTest extends AbstractIntegrationTest {

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private RosterService roster;

    @Autowired
    private JdbcClient jdbc;

    @BeforeEach
    void captureInsteadOfSending() {
        doNothing().when(sender).send(any(MimeMessage.class));
    }

    @Test
    void givenAnAccountHolder_whenTheBoardChangesTheirAddress_thenThePreviousAddressLearnsItWithoutTheNewOne()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID account = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when
        roster.changePerson(jane, "Jane", "Doe", "jane.major@example.org");

        // then
        MimeMessage notice = handedOver();
        assertThat(notice.getAllRecipients()[0].toString()).isEqualTo("jane.doe@example.org");
        assertThat(notice.getSubject()).contains("E-Mail-Adresse");
        assertThat(notice.getContent().toString()).contains("Hallo Jane")
                .as("the notice must not tell a previous holder where the account's mail now goes")
                .doesNotContain("jane.major", "example.org");
        assertTheAddressLeavesNoTrace(account);
    }

    @Test
    void givenAnAccountHolder_whenASynchronisationCorrectsTheirAddress_thenThePreviousAddressLearnsIt()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID account = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when
        roster.correctPerson(jane, null, null, "jane.major@example.org");

        // then
        assertThat(handedOver().getAllRecipients()[0].toString()).isEqualTo("jane.doe@example.org");
        assertTheAddressLeavesNoTrace(account);
    }

    @Test
    void givenAnAddressThatOnlyChangesCaseOrBelongsToNoAccount_whenChanged_thenNoNoticeIsQueued() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when
        roster.changePerson(jane, "Jane", "Doe", "Jane.Doe@example.org");
        roster.changePerson(mary, "Mary", "Major", "mary.roe@example.org");

        // then
        assertThat(notices()).as("the same mailbox or a person without an account is not notified").isZero();
    }

    private MimeMessage handedOver() {
        var messages = forClass(MimeMessage.class);
        verify(sender, timeout(10_000)).send(messages.capture());
        return messages.getValue();
    }

    private void assertTheAddressLeavesNoTrace(UUID account) {
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> assertThat(jdbc.sql("""
                        SELECT state || ' ' || parameters::text || ' ' || coalesce(previous_address, '-')
                        FROM message_record
                        WHERE account_id = :account AND kind = 'ACCOUNT_ADDRESS_CHANGED'
                        """).param("account", account).query(String.class).single())
                .as("a settled notice keeps no copy of the previous address").isEqualTo("HANDED_OVER {} -"));
        assertThat(jdbc.sql("""
                        SELECT parameters::text FROM notification
                        WHERE account_id = :account AND kind = 'ACCOUNT_ADDRESS_CHANGED'
                        """).param("account", account).query(String.class).single())
                .as("the notification centre never holds the previous address").isEqualTo("{}");
    }

    private long notices() {
        return jdbc.sql("SELECT count(*) FROM message_record WHERE kind = 'ACCOUNT_ADDRESS_CHANGED'")
                .query(Long.class).single();
    }
}
