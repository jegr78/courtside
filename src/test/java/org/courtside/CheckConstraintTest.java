package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.List;
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
                        INSERT INTO opening_hours (id, version_id, day_of_week, opens_at, closes_at)
                        VALUES (?, 'eeeeeeee-0000-0000-0000-000000000100', 8, '08:00', '22:00')
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
    void whenStoringAnInsecureRemoteLogo_thenTheDatabaseRefusesIt() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE club_config SET logo_url = 'http://images.example.org/logo.svg'
                WHERE id = '00000000-0000-0000-0000-000000000001'
                """).update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("club_config_logo_url_safe");
    }

    @Test
    void whenStoringIncompleteUploadedLogoMetadata_thenTheDatabaseRefusesIt() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE club_config SET logo_content = decode('89504e47', 'hex')
                WHERE id = '00000000-0000-0000-0000-000000000001'
                """).update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("club_config_logo_complete");
    }

    @Test
    void whenStoringAnUploadedLogoAboveTheLimit_thenTheDatabaseRefusesIt() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE club_config
                SET logo_content = decode(repeat('00', 1048577), 'hex'),
                    logo_media_type = 'image/png',
                    logo_digest = repeat('a', 64)
                WHERE id = '00000000-0000-0000-0000-000000000001'
                """).update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("club_config_logo_size");
    }

    @Test
    void whenStoringAPrivacyLinkThatCarriesAnActiveScheme_thenTheDatabaseRefusesIt() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE club_config SET privacy_url = 'javascript:alert(1)'
                WHERE id = '00000000-0000-0000-0000-000000000001'
                """).update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("club_config_privacy_url_safe");
    }

    @Test
    void whenStoringAPrivacyLinkABrowserWouldStripOffThisOrigin_thenTheDatabaseRefusesIt() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE club_config SET privacy_url = E'/\\t/evil.example'
                WHERE id = '00000000-0000-0000-0000-000000000001'
                """).update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("club_config_privacy_url_safe");
    }

    @Test
    void whenStoringADocumentationLinkThatCarriesAnActiveScheme_thenTheDatabaseRefusesIt() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE club_config SET documentation_url = 'javascript:alert(1)'
                WHERE id = '00000000-0000-0000-0000-000000000001'
                """).update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("club_config_documentation_url_safe");
    }

    @Test
    void whenStoringAShortNameThatCannotFitUnderAnIcon_thenTheDatabaseRefusesIt() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE club_config SET short_name = 'Example Tennis'
                WHERE id = '00000000-0000-0000-0000-000000000001'
                """).update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("club_config_short_name_fits_an_icon_label");
    }

    @Test
    void whenStoringABlankShortName_thenTheDatabaseRefusesIt() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE club_config SET short_name = '   '
                WHERE id = '00000000-0000-0000-0000-000000000001'
                """).update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("club_config_short_name_fits_an_icon_label");
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

    @Test
    void givenTheClosureCard_whenItIsUpdatedToGrantAccess_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                        UPDATE booking_card SET grants_access = true
                        WHERE id = '44444444-4444-4444-4444-444444444444'
                        """).update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("booking_card_closure_grants_no_access");
    }

    @Test
    void whenInsertingAnAccessPointWithANonDigitCode_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("INSERT INTO access_point (id, name, static_code) VALUES (?, ?, ?)")
                        .params(UUID.randomUUID(), "North gate", "12a456")
                        .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("access_point_static_code_digits");
    }

    @Test
    void whenInsertingAnAccessPointWithABlankName_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("INSERT INTO access_point (id, name) VALUES (?, ?)")
                        .params(UUID.randomUUID(), "   ")
                        .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("access_point_name_not_blank");
    }

    @Test
    void whenInsertingAnAccessPointOpenToMembersWithoutACode_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("INSERT INTO access_point (id, name, open_to_members) VALUES (?, ?, true)")
                        .params(UUID.randomUUID(), "Clubhouse door")
                        .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("access_point_open_to_members_has_code");
    }

    @Test
    void whenTheAccessSettingsLeaveTheirRanges_thenEachIsRejectedByItsOwnConstraint() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("UPDATE club_config SET access_lead_minutes = 241").update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("club_config_access_lead_minutes_range");
        assertThatThrownBy(() -> jdbc.sql("UPDATE club_config SET access_lag_minutes = -1").update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("club_config_access_lag_minutes_range");
        assertThatThrownBy(() -> jdbc.sql("UPDATE club_config SET access_code_length = 3").update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("club_config_access_code_length_range");
    }

    @Test
    void whenAnAccessCodeIsNotFourToEightDigits_thenItIsRejected() {
        // when / then
        for (String code : List.of("12a456", "123", "123456789")) {
            assertThatThrownBy(() -> jdbc.sql("INSERT INTO access_code (code) VALUES (?)").params(code).update())
                    .as("the code %s", code)
                    .isInstanceOf(DataIntegrityViolationException.class)
                    .hasMessageContaining("access_code_digits");
        }
    }

    @Test
    void givenAGrantsCurrentCode_whenItGetsAHoldOrASecondCode_thenEachIsRejectedByItsOwnConstraint() {
        // given
        UUID grant = insertAccessGrant();
        jdbc.sql("INSERT INTO access_code (code, grant_id) VALUES ('135790', ?)").params(grant).update();

        // when / then
        assertThatThrownBy(() -> jdbc.sql("UPDATE access_code SET until = now() WHERE code = '135790'").update())
                .as("a code a grant still holds is not on hold until a time")
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("access_code_held_only_when_detached");
        assertThatThrownBy(() -> jdbc.sql("INSERT INTO access_code (code, grant_id) VALUES ('246802', ?)")
                        .params(grant).update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("access_code_one_per_grant");
        assertThatThrownBy(() -> jdbc.sql("INSERT INTO access_code (code) VALUES ('135790')").update())
                .as("a code in use is never drawn a second time")
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("access_code_pkey");
    }

    @Test
    void givenAnAccessGrant_whenItsStateLeavesItsDomain_thenEachIsRejectedByItsOwnConstraint() {
        // given
        UUID grant = insertAccessGrant();

        // when / then
        assertConstraint(grant, "remote = 'REVOKED', exposed_until = now()", "access_grant_remote_known");
        assertConstraint(grant, "attempts = -1", "access_grant_attempts_not_negative");
        assertConstraint(grant, "rejections = -1", "access_grant_rejections_not_negative");
        assertConstraint(grant, "want_from = now(), want_until = now()", "access_grant_want_window_order");
        assertConstraint(grant, "remote_from = now(), remote_until = now() - interval '1 minute'",
                "access_grant_remote_window_order");
        assertConstraint(grant, "last_failure = repeat('x', 501)", "access_grant_last_failure_length");
        assertConstraint(grant, "external_reference = repeat('x', 201)", "access_grant_external_reference_length");
        assertConstraint(grant, "want_mapping = repeat('x', 201)", "access_grant_want_mapping_length");
        assertConstraint(grant, "remote_mapping = repeat('x', 201)", "access_grant_remote_mapping_length");
        assertThatThrownBy(() -> jdbc.sql("INSERT INTO access_grant (id, booking_id) SELECT ?, booking_id"
                        + " FROM access_grant WHERE id = ?").params(UUID.randomUUID(), grant).update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("access_grant_one_per_booking");
    }

    @Test
    void givenAnAccessGrant_whenAStateLacksTheColumnsItImplies_thenEachIsRejectedByItsOwnConstraint() {
        // given
        UUID grant = insertAccessGrant();
        String window = "now(), now() + interval '1 hour', ARRAY[gen_random_uuid()]";

        // when / then
        assertConstraint(grant, "wanted = true", "access_grant_wanted_has_demand");
        assertConstraint(grant, "wanted = true, (want_from, want_until) = (now(), now() + interval '1 hour')",
                "access_grant_wanted_has_demand");
        assertConstraint(grant, "remote = 'INSTALLED', exposed_until = now()", "access_grant_installed_has_window");
        assertConstraint(grant, "remote = 'INSTALLED', exposed_until = now(), (remote_from, remote_until)"
                + " = (now(), now() + interval '1 hour')", "access_grant_installed_has_window");
        assertConstraint(grant, "remote = 'MAYBE'", "access_grant_remote_exposed");
        assertConstraint(grant, "remote = 'INSTALLED', (remote_from, remote_until, remote_points) = (" + window + ")",
                "access_grant_remote_exposed");
        jdbc.sql("UPDATE access_grant SET wanted = true, (want_from, want_until, want_points) = (" + window + "),"
                + " remote = 'INSTALLED', exposed_until = now(), (remote_from, remote_until, remote_points) = ("
                + window + ") WHERE id = ?").params(grant).update();
    }

    private void assertConstraint(UUID grant, String assignment, String constraint) {
        assertThatThrownBy(() -> jdbc.sql("UPDATE access_grant SET " + assignment + " WHERE id = ?")
                        .params(grant).update())
                .as(assignment)
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining(constraint);
    }

    private UUID insertAccessGrant() {
        UUID grant = UUID.randomUUID();
        jdbc.sql("INSERT INTO access_grant (id, booking_id) VALUES (?, ?)").params(grant, UUID.randomUUID()).update();
        return grant;
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
