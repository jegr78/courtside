package org.courtside.config.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.MissingResourceException;
import java.util.Optional;
import java.util.ResourceBundle;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
public class InstalledAppService {

    public static final String PAGE_COLOR = "#101713";
    public static final String ANY = "any";
    public static final String MASKABLE = "maskable";

    private static final List<Integer> SIZES = List.of(180, 192, 512);
    private static final List<Integer> MANIFEST_SIZES = List.of(192, 512);
    // Raise it whenever the rendering changes, so an immutable cached icon is not served stale.
    private static final String RENDERING = "app-icon-1";
    private static final String ICON_PATH = "/api/public/config/icon";

    private final ConfigService config;
    private final Map<String, byte[]> rendered = new ConcurrentHashMap<>();

    public InstalledAppManifest manifest() {
        ClubConfigurationSnapshot configuration = config.current();
        Optional<ClubLogo> logo = config.uploadedLogo();
        Locale locale = Locale.forLanguageTag(configuration.defaultLocale());
        String version = version(logo);
        List<InstalledAppManifest.Icon> icons = new ArrayList<>();
        icons.add(sourceIcon(configuration, logo));
        for (String purpose : List.of(ANY, MASKABLE)) {
            for (int size : MANIFEST_SIZES) {
                String query = "?size=" + size + (purpose.equals(MASKABLE) ? "&purpose=" + MASKABLE : "")
                        + "&v=" + version;
                icons.add(new InstalledAppManifest.Icon(ICON_PATH + query, size + "x" + size,
                        "image/png", purpose));
            }
        }
        return new InstalledAppManifest(
                configuration.clubName(),
                configuration.effectiveShortName(),
                message("description", locale).replace("{clubName}", configuration.clubName()),
                configuration.defaultLocale(),
                configuration.primaryColor(),
                PAGE_COLOR,
                List.copyOf(icons),
                List.of(new InstalledAppManifest.Shortcut(message("shortcut.courts", locale), "/courts"),
                        new InstalledAppManifest.Shortcut(message("shortcut.myBookings", locale),
                                "/my-bookings")));
    }

    public AppIcon icon(Integer size, String purpose) {
        if (size == null || !SIZES.contains(size)) {
            throw new UnsupportedAppIconException("size");
        }
        if (!ANY.equals(purpose) && !MASKABLE.equals(purpose)) {
            throw new UnsupportedAppIconException("purpose");
        }
        Optional<ClubLogo> logo = config.uploadedLogo();
        String version = version(logo);
        String key = version + "-" + size + "-" + purpose;
        rendered.keySet().removeIf(cached -> !cached.startsWith(version));
        byte[] content = rendered.computeIfAbsent(key, ignored -> logo
                .map(uploaded -> AppIconRenderer.logo(uploaded.decoded(), size, MASKABLE.equals(purpose)))
                .orElseGet(() -> AppIconRenderer.mark(size, MASKABLE.equals(purpose))));
        return new AppIcon(content, version);
    }

    private static InstalledAppManifest.Icon sourceIcon(ClubConfigurationSnapshot configuration,
                                                        Optional<ClubLogo> logo) {
        if (logo.isPresent()) {
            return new InstalledAppManifest.Icon(configuration.logoUrl(),
                    logo.get().width() + "x" + logo.get().height(), logo.get().mediaType(), ANY);
        }
        if (configuration.logoUrl() != null) {
            return new InstalledAppManifest.Icon(configuration.logoUrl(), ANY, null, ANY);
        }
        return new InstalledAppManifest.Icon("/icon.svg", ANY, "image/svg+xml", ANY);
    }

    // Without the no-fallback control a club writing English would read the JVM's default language.
    private static String message(String key, Locale locale) {
        try {
            return ResourceBundle.getBundle("manifest", locale,
                    ResourceBundle.Control.getNoFallbackControl(ResourceBundle.Control.FORMAT_PROPERTIES))
                    .getString(key);
        } catch (MissingResourceException e) {
            throw new IllegalStateException("The manifest texts are missing from the image", e);
        }
    }

    private static String version(Optional<ClubLogo> logo) {
        String source = RENDERING + ":" + logo.map(ClubLogo::digest).orElse("courtside-mark");
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(source.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }
}
