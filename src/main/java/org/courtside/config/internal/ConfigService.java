package org.courtside.config.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.BookingGridSettings;
import org.courtside.config.BookingGridConstraint;
import org.courtside.config.BookingSlotDuration;
import org.courtside.config.BookingGridCoordination;
import org.courtside.config.ClubTimeZone;
import org.courtside.config.ConfigEvent;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Function;
import java.time.ZoneId;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ConfigService implements BookingGridSettings, BookingGridCoordination, ClubTimeZone {

    private final ClubConfigurationRepository configurations;
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
    public ClubConfigurationSnapshot update(String clubName, String primaryColor, String accentColor,
                                            String logoUrl, String imprintUrl, String defaultLocale,
                                            int slotMinutes, String timeZone) {
        BookingSlotDuration slotDuration = new BookingSlotDuration(slotMinutes);
        ZoneId zoneId = ZoneId.of(timeZone);
        lock();
        ClubConfiguration configuration = currentEntity();

        if (!configuration.getTimeZone().equals(timeZone)) {
            firstConflict(constraint -> constraint.timeZoneConflictCode())
                    .ifPresent(code -> {
                        throw new TimeZoneConflictException(code, timeZone);
                    });
        }
        if (configuration.getSlotMinutes() != slotMinutes) {
            firstConflict(constraint -> constraint.conflictCode(slotDuration, zoneId))
                    .ifPresent(code -> {
                        throw new SlotDurationConflictException(code, slotMinutes);
                    });
        }

        List<String> changedFields = new ArrayList<>();
        if (!Objects.equals(configuration.getClubName(), clubName)) {
            changedFields.add("clubName");
        }
        if (!Objects.equals(configuration.getPrimaryColor(), primaryColor)) {
            changedFields.add("primaryColor");
        }
        if (!Objects.equals(configuration.getAccentColor(), accentColor)) {
            changedFields.add("accentColor");
        }
        if (!Objects.equals(configuration.getLogoUrl(), logoUrl)) {
            changedFields.add("logoUrl");
        }
        if (!Objects.equals(configuration.getImprintUrl(), imprintUrl)) {
            changedFields.add("imprintUrl");
        }
        boolean localeChanged = !Objects.equals(configuration.getDefaultLocale(), defaultLocale);
        boolean slotMinutesChanged = configuration.getSlotMinutes() != slotMinutes;
        boolean timeZoneChanged = !configuration.getTimeZone().equals(timeZone);

        configuration.changeTo(clubName, primaryColor, accentColor,
                logoUrl, imprintUrl, defaultLocale, slotMinutes, timeZone);

        if (!changedFields.isEmpty()) {
            events.publishEvent(new ConfigEvent.ClubChanged(configuration.getId(), List.copyOf(changedFields)));
        }
        if (localeChanged) {
            events.publishEvent(new ConfigEvent.LocaleChanged(configuration.getId(), defaultLocale));
        }
        if (slotMinutesChanged) {
            events.publishEvent(new ConfigEvent.SlotDurationChanged(configuration.getId(), slotMinutes));
        }
        if (timeZoneChanged) {
            events.publishEvent(new ConfigEvent.TimeZoneChanged(configuration.getId(), timeZone));
        }

        return ClubConfigurationSnapshot.from(configuration);
    }

    private Optional<String> firstConflict(
            Function<BookingGridConstraint, Optional<String>> question) {
        return bookingGridConstraints.stream()
                .map(question)
                .flatMap(Optional::stream)
                .findFirst();
    }
}
