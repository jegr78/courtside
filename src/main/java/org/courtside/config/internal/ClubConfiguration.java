package org.courtside.config.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Entity
@Table(name = "club_config")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ClubConfiguration {

    static final UUID SINGLETON_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Id
    private UUID id;

    @Column(name = "club_name", nullable = false)
    private String clubName;

    @Column(name = "primary_color", nullable = false)
    private String primaryColor;

    @Column(name = "accent_color", nullable = false)
    private String accentColor;

    @Column(name = "logo_url")
    private String logoUrl;

    @Column(name = "imprint_url")
    private String imprintUrl;

    @Column(name = "privacy_url")
    private String privacyUrl;

    @Column(name = "default_locale", nullable = false)
    private String defaultLocale;

    @Column(name = "slot_minutes", nullable = false)
    private int slotMinutes;

    @Column(name = "time_zone", nullable = false)
    private String timeZone;

    @Column(name = "new_account_credential_hours", nullable = false)
    private int newAccountCredentialHours;

    @Column(name = "password_reset_credential_hours", nullable = false)
    private int passwordResetCredentialHours;

    @Column(name = "booking_reminder_hours", nullable = false)
    private int bookingReminderHours;

    @Column(name = "no_membership_type_rule_set_id")
    private UUID noMembershipTypeRuleSetId;

    public void changeTo(String clubName, String primaryColor, String accentColor,
                         String logoUrl, String imprintUrl, String privacyUrl,
                         String defaultLocale, int slotMinutes, String timeZone) {
        this.clubName = clubName;
        this.primaryColor = primaryColor;
        this.accentColor = accentColor;
        this.logoUrl = logoUrl;
        this.imprintUrl = imprintUrl;
        this.privacyUrl = privacyUrl;
        this.defaultLocale = defaultLocale;
        this.slotMinutes = slotMinutes;
        this.timeZone = timeZone;
    }

    public void changeCredentialValidity(int newAccountHours, int passwordResetHours) {
        this.newAccountCredentialHours = newAccountHours;
        this.passwordResetCredentialHours = passwordResetHours;
    }

    public void remindBookingsAfter(int hours) {
        this.bookingReminderHours = hours;
    }

    public void bindPeopleWithoutAMembershipTypeTo(UUID ruleSetId) {
        this.noMembershipTypeRuleSetId = ruleSetId;
    }
}
