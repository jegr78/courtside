package org.courtside.credit;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.credit.internal.CreditLedger;
import org.courtside.credit.testfixture.CreditTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.util.Currency;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class CreditLedgerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private UserDetailsService userDetails;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private ConfigTestFixture config;
    @Autowired
    private CreditTestFixture credit;
    @Autowired
    private CreditLedger ledger;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private Clock clock;
    @Autowired
    private TransactionTemplate transactions;

    private MockMvc mockMvc;
    private UUID johnAccount;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(john, "roe.john", Set.of(Role.EXTERNAL));
        UUID treasurer = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        identity.createEnabledAccount(treasurer, "miles.richard", Set.of(Role.MEMBER, Role.TREASURER));
    }

    @Test
    void givenATreasurer_whenTheyCreditAndThenPayOut_thenThePlayerSeesBothEntriesAndTheRemainingBalance()
            throws Exception {
        // when
        record("miles.richard", johnAccount, "CREDIT", 2000, "Cash for two hours", true)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amountMinor").value(2000))
                .andExpect(jsonPath("$.balanceAfterMinor").value(2000));
        record("miles.richard", johnAccount, "PAYOUT", 500, "Returned in cash", true)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amountMinor").value(-500))
                .andExpect(jsonPath("$.balanceAfterMinor").value(1500));

        // then
        mockMvc.perform(get("/api/my/credit").with(user(userDetails.loadUserByUsername("roe.john"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.balanceMinor").value(1500))
                .andExpect(jsonPath("$.currency").value("EUR"))
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[0].kind").value("PAYOUT"))
                .andExpect(jsonPath("$.items[0].note").value("Returned in cash"))
                .andExpect(jsonPath("$.items[0].balanceAfterMinor").value(1500))
                .andExpect(jsonPath("$.items[1].kind").value("CREDIT"))
                .andExpect(jsonPath("$.items[1].balanceAfterMinor").value(2000));
        List<String> audit = jdbc.sql("""
                        SELECT payload::text FROM domain_event WHERE event_type = 'credit.entry.recorded'
                        ORDER BY occurred_at
                        """).query(String.class).list();
        assertThat(audit).as("each entry is audited").hasSize(2);
        assertThat(String.join(" ", audit)).as("the audit names amount and kind, never the reason")
                .contains(johnAccount.toString()).contains("-500").contains("PAYOUT")
                .doesNotContain("Returned in cash").doesNotContain("Cash for two hours");
    }

    @Test
    void givenATakenPayPalRefund_whenThePlayerReadsTheirCredit_thenTheRefundNamesItsOrder() throws Exception {
        // given
        UUID booking = UUID.randomUUID();
        Currency euro = Currency.getInstance("EUR");
        transactions.executeWithoutResult(status -> {
            ledger.payByPayPal(johnAccount, booking, "ORDER-LEDGER-1", 1500, euro);
            ledger.refund(booking);
            ledger.takeForPayPalRefund(johnAccount, booking, "ORDER-LEDGER-1", 1500, euro);
        });

        // when / then
        mockMvc.perform(get("/api/my/credit").with(user(userDetails.loadUserByUsername("roe.john"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.balanceMinor").value(0))
                .andExpect(jsonPath("$.items[0].kind").value("PAYPAL_REFUND"))
                .andExpect(jsonPath("$.items[0].amountMinor").value(-1500))
                .andExpect(jsonPath("$.items[0].paypalOrderId").value("ORDER-LEDGER-1"))
                .andExpect(jsonPath("$.items[0].bookingId").value(booking.toString()));
    }

    @Test
    void givenABalance_whenThePayoutExceedsIt_thenItIsRefusedAndNothingIsWritten() throws Exception {
        // given
        credit.credit(johnAccount, 1000);

        // when / then
        record("miles.richard", johnAccount, "PAYOUT", 1001, "Too much", true)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:credit-insufficient"))
                .andExpect(jsonPath("$.violations[0].code").value("credit.insufficient"))
                .andExpect(jsonPath("$.violations[0].params.balanceMinor").value(1000));
        assertThat(entries(johnAccount)).as("a refused payout leaves no entry").isEqualTo(1);
    }

    @Test
    void givenAMemberAccount_whenTheTreasurerCreditsIt_thenOnlyAnExternalAccountReceivesCredit() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when / then
        record("miles.richard", janeAccount, "CREDIT", 1000, "Cash", true)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:credit-account-not-external"));
        assertThat(entries(janeAccount)).isZero();
    }

    @Test
    void givenNoRecentProof_whenTheTreasurerCredits_thenTheyMustProveItFirst() throws Exception {
        // when / then
        record("miles.richard", johnAccount, "CREDIT", 1000, "Cash", false)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:recent-authentication-required"));
        assertThat(entries(johnAccount)).isZero();
    }

    @Test
    void givenATreasurer_whenTheyRecordABookingRefundByHand_thenTheRequestIsRefused() throws Exception {
        // when / then
        record("miles.richard", johnAccount, "BOOKING_REFUND", 1000, "Refund", true)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("kind"));
        assertThat(entries(johnAccount)).as("only a booking writes its own payment and refund").isZero();
        assertThatThrownBy(() -> ledger.append(johnAccount, CreditEntryKind.BOOKING_REFUND, 1000, "Refund"))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void givenAnExternalPlayer_whenTheyCreditThemselves_thenTheTreasuryIsClosedToThem() throws Exception {
        // when / then
        record("roe.john", johnAccount, "CREDIT", 1000, "Free money", true).andExpect(status().isForbidden());
        assertThat(entries(johnAccount)).isZero();
    }

    @Test
    void givenABalanceCoveringOnlyOnePayout_whenASecondStartsBeforeTheFirstCommits_thenExactlyOneSucceeds()
            throws Exception {
        // given
        credit.credit(johnAccount, 1000);
        CountDownLatch firstWritten = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);

        // when
        try {
            Future<Boolean> first = pool.submit(() -> transactions.execute(status -> {
                credit.payOut(johnAccount, 800);
                firstWritten.countDown();
                await(releaseFirst);
                return true;
            }));
            assertThat(firstWritten.await(10, TimeUnit.SECONDS)).isTrue();
            Future<Boolean> second = pool.submit(() -> {
                try {
                    credit.payOut(johnAccount, 800);
                    return true;
                } catch (RuntimeException refused) {
                    return false;
                }
            });
            Thread.sleep(500);
            boolean secondWaited = !second.isDone();
            releaseFirst.countDown();

            // then
            assertThat(secondWaited).as("the second payout waits for the account lock").isTrue();
            assertThat(first.get(10, TimeUnit.SECONDS)).isTrue();
            assertThat(second.get(10, TimeUnit.SECONDS)).as("the second payout sees the reduced balance").isFalse();
        } finally {
            releaseFirst.countDown();
            pool.shutdownNow();
        }
        assertThat(ledger.page(johnAccount, null, 10).balanceMinor()).isEqualTo(200);
    }

    @Test
    void givenCreditForOneBooking_whenASecondDebitStartsBeforeTheFirstCommits_thenItWaitsAndIsNotCovered()
            throws Exception {
        // given
        credit.credit(johnAccount, 1000);
        Currency euro = Currency.getInstance("EUR");
        CountDownLatch firstWritten = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);

        // when
        try {
            Future<Boolean> first = pool.submit(() -> transactions.execute(status -> {
                boolean covered = ledger.debit(johnAccount, UUID.randomUUID(), 800, euro).covered();
                firstWritten.countDown();
                await(releaseFirst);
                return covered;
            }));
            assertThat(firstWritten.await(10, TimeUnit.SECONDS)).isTrue();
            Future<Boolean> second = pool.submit(() -> transactions.execute(status ->
                    ledger.debit(johnAccount, UUID.randomUUID(), 800, euro).covered()));
            Thread.sleep(500);
            boolean secondWaited = !second.isDone();
            releaseFirst.countDown();

            // then
            assertThat(secondWaited).as("the second debit waits for the account lock").isTrue();
            assertThat(first.get(10, TimeUnit.SECONDS)).isTrue();
            assertThat(second.get(10, TimeUnit.SECONDS)).as("the second debit sees the spent credit").isFalse();
        } finally {
            releaseFirst.countDown();
            pool.shutdownNow();
        }
        assertThat(ledger.page(johnAccount, null, 10).balanceMinor()).isEqualTo(200);
    }

    @Test
    void givenALedgerEntry_whenItIsChangedOrRemoved_thenTheDatabaseRefuses() {
        // given
        UUID entry = credit.credit(johnAccount, 1000);

        // when / then
        assertThatThrownBy(() -> jdbc.sql("UPDATE credit_entry SET amount_minor = 5000 WHERE id = :id")
                .param("id", entry).update()).hasMessageContaining("credit_entry_append_only");
        assertThatThrownBy(() -> jdbc.sql("DELETE FROM credit_entry WHERE id = :id").param("id", entry).update())
                .hasMessageContaining("credit_entry_append_only");
        assertThat(ledger.page(johnAccount, null, 10).balanceMinor()).isEqualTo(1000);
    }

    @Test
    void givenSeveralEntries_whenThePlayerPagesThroughThem_thenEachArrivesOnceWithItsRunningBalance()
            throws Exception {
        // given
        credit.credit(johnAccount, 100);
        credit.credit(johnAccount, 200);
        credit.credit(johnAccount, 300);
        UserDetails john = userDetails.loadUserByUsername("roe.john");

        // when
        String first = mockMvc.perform(get("/api/my/credit").param("limit", "2").with(user(john)))
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[0].balanceAfterMinor").value(600))
                .andExpect(jsonPath("$.items[1].balanceAfterMinor").value(300))
                .andReturn().getResponse().getContentAsString();
        String cursor = com.jayway.jsonpath.JsonPath.read(first, "$.nextCursor");

        // then
        mockMvc.perform(get("/api/my/credit").param("limit", "2").param("cursor", cursor).with(user(john)))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].balanceAfterMinor").value(100))
                .andExpect(jsonPath("$.nextCursor").doesNotExist());
    }

    @Test
    void givenHoldersAndOthers_whenTheTreasurerLists_thenOnlyBalancesShowAndASearchFindsExternalAccounts()
            throws Exception {
        // given
        credit.credit(johnAccount, 700);
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID maryAccount = identity.createEnabledAccount(mary, "major.mary", Set.of(Role.EXTERNAL));
        UserDetails treasurer = userDetails.loadUserByUsername("miles.richard");

        // when / then
        mockMvc.perform(get("/api/treasury/credit/accounts").with(user(treasurer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].accountId").value(johnAccount.toString()))
                .andExpect(jsonPath("$[0].balanceMinor").value(700));
        mockMvc.perform(search("MAJ", treasurer))
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].accountId").value(maryAccount.toString()))
                .andExpect(jsonPath("$[0].balanceMinor").value(0));
        mockMvc.perform(search("miles", treasurer))
                .andExpect(jsonPath("$", hasSize(0)));
        mockMvc.perform(search("%", treasurer))
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void givenAnUnknownAccount_whenTheTreasurerReadsItsLedger_thenNothingIsFound() throws Exception {
        // when / then
        mockMvc.perform(get("/api/treasury/credit/accounts/{id}/entries", UUID.randomUUID())
                        .with(user(userDetails.loadUserByUsername("miles.richard"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:credit-account-not-found"));
    }

    @Test
    void givenARecordedCredit_whenTheSameRequestIsSentAgainWithItsKey_thenTheFirstEntryAnswersAndNothingDoubles()
            throws Exception {
        // given
        String first = record("miles.richard", johnAccount, "CREDIT", 1500, "Cash at the clubhouse", true, "entry-1")
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        // when
        String again = record("miles.richard", johnAccount, "CREDIT", 1500, "Cash at the clubhouse", true, "entry-1")
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(again).as("the resubmission answers with the entry it repeats").isEqualTo(first);
        assertThat(entries(johnAccount)).as("a resubmitted cash credit is recorded once").isEqualTo(1);
        assertThat(ledger.page(johnAccount, null, 10).balanceMinor()).isEqualTo(1500);
    }

    @Test
    void givenAClientWithoutAKey_whenItRecordsTheSameCreditTwice_thenBothAreRecordedAsBefore() throws Exception {
        // when
        record("miles.richard", johnAccount, "CREDIT", 1500, "Cash at the clubhouse", true, null)
                .andExpect(status().isCreated());
        record("miles.richard", johnAccount, "CREDIT", 1500, "Cash at the clubhouse", true, null)
                .andExpect(status().isCreated());

        // then
        assertThat(entries(johnAccount)).as("without a key every request is a new entry").isEqualTo(2);
        assertThat(ledger.page(johnAccount, null, 10).balanceMinor()).isEqualTo(3000);
    }

    @Test
    void givenARecordedCredit_whenItsKeyComesBackWithAnotherReason_thenItIsRefusedAsAnotherRequest()
            throws Exception {
        // given
        record("miles.richard", johnAccount, "CREDIT", 1500, "Cash at the clubhouse", true, "entry-1")
                .andExpect(status().isCreated());

        // when / then
        record("miles.richard", johnAccount, "CREDIT", 1500, "Season refund", true, "entry-1")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:idempotency-key-reused"))
                .andExpect(jsonPath("$.violations[0].code").value("credit.idempotencyKey.reused"));
        assertThat(entries(johnAccount)).isEqualTo(1);
    }

    @Test
    void givenARecordedCredit_whenAnotherRequestReusesItsKey_thenItIsRefusedAndNothingIsRecorded() throws Exception {
        // given
        record("miles.richard", johnAccount, "CREDIT", 1500, "Cash at the clubhouse", true, "entry-1")
                .andExpect(status().isCreated());

        // when / then
        record("miles.richard", johnAccount, "CREDIT", 2000, "Cash at the clubhouse", true, "entry-1")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:idempotency-key-reused"))
                .andExpect(jsonPath("$.violations[0].code").value("credit.idempotencyKey.reused"));
        assertThat(entries(johnAccount)).isEqualTo(1);
    }

    private org.springframework.test.web.servlet.RequestBuilder search(String query, UserDetails treasurer) {
        return post("/api/treasury/credit/account-search").with(user(treasurer)).with(csrf())
                .contentType(MediaType.APPLICATION_JSON).content("{\"query\":\"%s\"}".formatted(query));
    }

    private ResultActions record(String username, UUID account, String kind, int amountMinor, String note,
                                 boolean recentlyProven) throws Exception {
        return record(username, account, kind, amountMinor, note, recentlyProven, UUID.randomUUID().toString());
    }

    private ResultActions record(String username, UUID account, String kind, int amountMinor, String note,
                                 boolean recentlyProven, String idempotencyKey) throws Exception {
        var request = post("/api/treasury/credit/accounts/{id}/entries", account)
                .with(user(userDetails.loadUserByUsername(username))).with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"%s\",\"amountMinor\":%d,\"note\":\"%s\"}".formatted(kind, amountMinor, note));
        if (recentlyProven) {
            request.sessionAttr("courtside.authenticated-at", clock.instant().toEpochMilli());
        }
        if (idempotencyKey != null) {
            request.header("Idempotency-Key", idempotencyKey);
        }
        return mockMvc.perform(request);
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    private long entries(UUID account) {
        return jdbc.sql("SELECT count(*) FROM credit_entry WHERE account_id = :id").param("id", account)
                .query(Long.class).single();
    }
}
