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

    @Column(name = "default_locale", nullable = false)
    private String defaultLocale;

    public void changeTo(String clubName, String primaryColor, String accentColor,
                         String logoUrl, String imprintUrl, String defaultLocale) {
        this.clubName = clubName;
        this.primaryColor = primaryColor;
        this.accentColor = accentColor;
        this.logoUrl = logoUrl;
        this.imprintUrl = imprintUrl;
        this.defaultLocale = defaultLocale;
    }
}
