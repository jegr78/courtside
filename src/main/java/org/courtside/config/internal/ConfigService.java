package org.courtside.config.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.BookingGridSettings;
import org.courtside.config.ClubIdentity;
import org.courtside.config.CredentialValidity;
import org.courtside.shared.CredentialsRequested;
import org.courtside.shared.SupportedLanguages;
import org.courtside.config.BookingGridConstraint;
import org.courtside.config.BookingSlotDuration;
import org.courtside.config.CredentialLifetime;
import org.courtside.config.BookingGridCoordination;
import org.courtside.config.ClubTimeZone;
import org.courtside.config.ConfigEvent;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.time.ZoneId;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ConfigService implements BookingGridSettings, BookingGridCoordination, ClubTimeZone,
        CredentialValidity, ClubIdentity {

    private static final String RULE_SET_CONSTRAINT = "club_config_no_membership_type_rule_set";

    private final ClubConfigurationRepository configurations;
    private final RuleSetAssignabilityRepository assignableRuleSets;
    private final SupportedLanguages languages;
    private final List<BookingGridConstraint> bookingGridConstraints;
    private final ApplicationEventPublisher events;

    public ClubConfigurationSnapshot current() {
        return ClubConfigurationSnapshot.from(currentEntity());
    }

    private ClubConfiguration currentEntity() {
        return configurations.findById(ClubConfiguration.SINGLETON_ID)
                .orElseThrow(() -> new IllegalStateException(
                        "The club configuration row is missing"));
    }

    @Override
    public BookingSlotDuration slotDuration() {
        return new BookingSlotDuration(current().slotMinutes());
    }

    @Override
    public String clubName() {
        return current().clubName();
    }

    @Override
    public String defaultLocale() {
        return current().defaultLocale();
    }

    @Override
    public java.time.Duration validFor(CredentialsRequested.Reason reason) {
        ClubConfigurationSnapshot configuration = current();
        return new CredentialLifetime(reason == CredentialsRequested.Reason.NEW_ACCOUNT
                ? configuration.newAccountCredentialHours()
                : configuration.passwordResetCredentialHours()).toDuration();
    }

    @Override
    public ZoneId zoneId() {
        return ZoneId.of(current().timeZone());
    }

    @Override
    public void lock() {
        configurations.lockById(ClubConfiguration.SINGLETON_ID)
                .orElseThrow(() -> new IllegalStateException(
                        "The club configuration row is missing"));
    }

    @Transactional
    public ClubConfigurationSnapshot update(ChangeClubConfigurationCommand command) {
        languages.require(command.defaultLocale());
        ZoneId zoneId = ZoneId.of(command.timeZone());
        requireAnAssignableRuleSet(command.noMembershipTypeRuleSetId());
        lock();
        ClubConfiguration configuration = currentEntity();
        Changes changes = changesBetween(configuration, command);
        refuseAConflictingGrid(command, zoneId, changes);
        apply(configuration, command);
        writeOrRejectAnUnresolvableRuleSet(configuration);
        announce(configuration.getId(), command, changes);
        return ClubConfigurationSnapshot.from(configuration);
    }

    private void requireAnAssignableRuleSet(UUID ruleSetId) {
        if (ruleSetId != null && assignableRuleSets.isInactive(ruleSetId)) {
            throw new NoMembershipTypeRuleSetInactiveException(
                    "config.noMembershipTypeRuleSet.inactive",
                    Map.of("field", "noMembershipTypeRuleSetId"));
        }
    }

    // Flushed here rather than at commit: a reference the database refuses has to reach the board
    // as its own answer, and after the transaction closes there is nobody left to tell.
    private void writeOrRejectAnUnresolvableRuleSet(ClubConfiguration configuration) {
        try {
            configurations.saveAndFlush(configuration);
        } catch (DataIntegrityViolationException e) {
            String message = e.getMostSpecificCause().getMessage();
            if (message != null && message.contains(RULE_SET_CONSTRAINT)) {
                throw new NoMembershipTypeRuleSetInvalidException(
                        "config.noMembershipTypeRuleSet.unresolvable",
                        Map.of("field", "noMembershipTypeRuleSetId"), e);
            }
            throw e;
        }
    }

    private void refuseAConflictingGrid(ChangeClubConfigurationCommand command, ZoneId zoneId,
                                        Changes changes) {
        if (changes.timeZone()) {
            firstConflict(BookingGridConstraint::timeZoneConflictCode)
                    .ifPresent(code -> {
                        throw new TimeZoneConflictException(code, command.timeZone());
                    });
        }
        if (changes.slotDuration()) {
            firstConflict(constraint -> constraint.conflictCode(command.slotDuration(), zoneId))
                    .ifPresent(code -> {
                        throw new SlotDurationConflictException(code, command.slotDuration().minutes());
                    });
        }
    }

    private static Changes changesBetween(ClubConfiguration configuration,
                                          ChangeClubConfigurationCommand command) {
        List<String> fields = new ArrayList<>();
        addIfChanged(fields, "clubName", configuration.getClubName(), command.clubName());
        addIfChanged(fields, "primaryColor", configuration.getPrimaryColor(), command.primaryColor());
        addIfChanged(fields, "accentColor", configuration.getAccentColor(), command.accentColor());
        addIfChanged(fields, "logoUrl", configuration.getLogoUrl(), command.logoUrl());
        addIfChanged(fields, "imprintUrl", configuration.getImprintUrl(), command.imprintUrl());
        addIfChanged(fields, "newAccountCredentialHours",
                configuration.getNewAccountCredentialHours(), command.newAccountCredential().hours());
        addIfChanged(fields, "passwordResetCredentialHours",
                configuration.getPasswordResetCredentialHours(), command.passwordResetCredential().hours());
        addIfChanged(fields, "noMembershipTypeRuleSetId",
                configuration.getNoMembershipTypeRuleSetId(), command.noMembershipTypeRuleSetId());
        return new Changes(List.copyOf(fields),
                !Objects.equals(configuration.getDefaultLocale(), command.defaultLocale()),
                configuration.getSlotMinutes() != command.slotDuration().minutes(),
                !configuration.getTimeZone().equals(command.timeZone()));
    }

    private static void addIfChanged(List<String> fields, String name, Object current, Object wanted) {
        if (!Objects.equals(current, wanted)) {
            fields.add(name);
        }
    }

    private static void apply(ClubConfiguration configuration, ChangeClubConfigurationCommand command) {
        configuration.changeTo(command.clubName(), command.primaryColor(), command.accentColor(),
                command.logoUrl(), command.imprintUrl(), command.defaultLocale(),
                command.slotDuration().minutes(), command.timeZone());
        configuration.changeCredentialValidity(command.newAccountCredential().hours(),
                command.passwordResetCredential().hours());
        configuration.bindPeopleWithoutAMembershipTypeTo(command.noMembershipTypeRuleSetId());
    }

    private void announce(UUID configId, ChangeClubConfigurationCommand command, Changes changes) {
        if (!changes.fields().isEmpty()) {
            events.publishEvent(new ConfigEvent.ClubChanged(configId, changes.fields()));
        }
        if (changes.locale()) {
            events.publishEvent(new ConfigEvent.LocaleChanged(configId, command.defaultLocale()));
        }
        if (changes.slotDuration()) {
            events.publishEvent(new ConfigEvent.SlotDurationChanged(configId,
                    command.slotDuration().minutes()));
        }
        if (changes.timeZone()) {
            events.publishEvent(new ConfigEvent.TimeZoneChanged(configId, command.timeZone()));
        }
    }

    // The locale, the grid and the zone are announced on their own, so what changed is three
    // questions and a list rather than one.
    private record Changes(List<String> fields, boolean locale, boolean slotDuration, boolean timeZone) {
    }

    private Optional<String> firstConflict(
            Function<BookingGridConstraint, Optional<String>> question) {
        return bookingGridConstraints.stream()
                .map(question)
                .flatMap(Optional::stream)
                .findFirst();
    }
}
