package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CheckConstraintTest extends AbstractIntegrationTest {

    @Autowired
    private JdbcClient jdbc;

    @Test
    void whenInsertingACourtWithANonPositiveNumber_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("INSERT INTO court (id, number) VALUES (?, ?)")
                        .params(UUID.randomUUID(), 0)
                        .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("court_number_positive");
    }

    @Test
    void whenInsertingABookingCardWithABlankLabel_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> insertBookingCard("   ", "#c8a415"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("booking_card_label_not_blank");
    }

    @Test
    void whenInsertingABookingCardWithANonHexColor_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> insertBookingCard("Odd card", "red"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("booking_card_color_hex");
    }

    @Test
    void whenInsertingABookingCardWithANonPositiveAllowedPlayerCount_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                        INSERT INTO booking_card
                            (id, label, color, allowed_player_counts, counts_against_limits, guest_allowed)
                        VALUES (?, ?, ?, '{0}', false, false)
                        """)
                        .params(UUID.randomUUID(), "Odd card", "#c8a415")
                        .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("booking_card_allowed_player_counts_positive");
    }

    @Test
    void whenInsertingARuleSetWithABlankName_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("INSERT INTO rule_set (id, name) VALUES (?, ?)")
                        .params(UUID.randomUUID(), "   ")
                        .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("rule_set_name_not_blank");
    }

    @Test
    void whenInsertingAMembershipTypeWithABlankName_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("INSERT INTO membership_type (id, name) VALUES (?, ?)")
                        .params(UUID.randomUUID(), "   ")
                        .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("membership_type_name_not_blank");
    }

    @Test
    void whenInsertingAParticipantCardWithABlankLabel_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("INSERT INTO participant_card (id, label) VALUES (?, ?)")
                        .params(UUID.randomUUID(), "   ")
                        .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("participant_card_label_not_blank");
    }

    @Test
    void whenInsertingOpeningHoursWithAnOutOfRangeDayOfWeek_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                        INSERT INTO opening_hours (id, day_of_week, opens_at, closes_at)
                        VALUES (?, 8, '08:00', '22:00')
                        """)
                        .params(UUID.randomUUID())
                        .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("opening_hours_day_of_week_range");
    }

    @Test
    void whenInsertingABookingSeriesWithAnOutOfRangeWeekday_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                        INSERT INTO booking_series
                            (id, card_id, starts_on, start_time,
                             duration_minutes, interval_weeks, weekdays, occurrence_count)
                        VALUES (?, '11111111-1111-1111-1111-111111111111',
                                '2026-05-12', '18:00', 60, 1, '{8}', 1)
                        """)
                        .params(UUID.randomUUID())
                        .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("booking_series_weekdays_range");
    }

    @Test
    void whenInsertingAUserAccountWhoseLocaleIsNotALanguageTag_thenItIsRejected() {
        // given
        UUID personId = insertPerson();

        // when / then — which languages exist is the image's answer, so the column checks the shape
        assertThatThrownBy(() -> jdbc.sql("""
                        INSERT INTO user_account (id, person_id, username, password_hash, locale)
                        VALUES (?, ?, 'doe.jane', 'irrelevant', 'not a tag')
                        """)
                        .params(UUID.randomUUID(), personId)
                        .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("user_account_locale_well_formed");
    }

    @Test
    void whenInsertingAUserAccountWithNoLocaleAtAll_thenItIsRejected() {
        // given
        UUID personId = insertPerson();

        // when / then — the column carries no default, so a caller that forgets it cannot land German
        assertThatThrownBy(() -> jdbc.sql("""
                        INSERT INTO user_account (id, person_id, username, password_hash)
                        VALUES (?, ?, 'doe.jane', 'irrelevant')
                        """)
                        .params(UUID.randomUUID(), personId)
                        .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("locale");
    }

    @Test
    void whenInsertingAUserAccountRoleThatIsNotAKnownRole_thenItIsRejected() {
        // given
        UUID userAccountId = insertUserAccount();

        // when / then
        assertThatThrownBy(() -> jdbc.sql("INSERT INTO user_account_role (user_account_id, role) VALUES (?, ?)")
                        .params(userAccountId, "PRESIDENT")
                        .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("user_account_role_role_known");
    }

    @Test
    void whenStoringABlankTimeZone_thenTheDatabaseRefusesIt() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE club_config SET time_zone = '   '
                WHERE id = '00000000-0000-0000-0000-000000000001'
                """).update())
                .hasMessageContaining("club_config_time_zone_not_blank");
    }

    @Test
    void whenStoringAnUnknownTimeZone_thenTheDatabaseRefusesIt() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE club_config SET time_zone = 'Moon/Tranquility'
                WHERE id = '00000000-0000-0000-0000-000000000001'
                """).update())
                .hasMessageContaining("club_config_time_zone_known");
    }

    @Test
    void whenInsertingARuleDefinitionThatIsNotAKnownRuleType_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                        INSERT INTO rule_definition (id, rule_set_id, rule_type)
                        VALUES (?, 'aaaaaaaa-0000-0000-0000-000000000001', 'DOUBLE_BOOKING_ALLOWED')
                        """)
                        .params(UUID.randomUUID())
                        .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("rule_definition_rule_type_known");
    }

    private UUID insertPerson() {
        UUID id = UUID.randomUUID();
        jdbc.sql("INSERT INTO person (id, first_name, last_name, email) VALUES (?, 'Jane', 'Doe', 'jane.doe@example.org')")
                .params(id)
                .update();
        return id;
    }

    private UUID insertUserAccount() {
        UUID id = UUID.randomUUID();
        UUID personId = insertPerson();
        jdbc.sql("""
                        INSERT INTO user_account (id, person_id, username, password_hash, locale)
                        VALUES (?, ?, 'doe.jane', 'irrelevant', 'de')
                        """)
                .params(id, personId)
                .update();
        return id;
    }

    private void insertBookingCard(String label, String color) {
        jdbc.sql("""
                        INSERT INTO booking_card
                            (id, label, color, counts_against_limits, guest_allowed)
                        VALUES (?, ?, ?, false, false)
                        """)
                .params(UUID.randomUUID(), label, color)
                .update();
    }
}
