package org.courtside.config.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ConfigService {

    private final ClubConfigurationRepository configurations;

    public ClubConfiguration current() {
        return configurations.findById(ClubConfiguration.SINGLETON_ID)
                .orElseThrow(() -> new IllegalStateException(
                        "The club configuration row is missing"));
    }

    @Transactional
    public ClubConfiguration update(String clubName, String primaryColor, String accentColor,
                                    String logoUrl, String imprintUrl, String defaultLocale) {
        ClubConfiguration configuration = current();
        configuration.changeTo(clubName, primaryColor, accentColor,
                logoUrl, imprintUrl, defaultLocale);
        return configuration;
    }
}
