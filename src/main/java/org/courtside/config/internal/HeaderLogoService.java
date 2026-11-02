package org.courtside.config.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
public class HeaderLogoService {

    static final int LONGEST_SIDE = 160;
    // Raise it whenever the rendering changes, so an immutable cached variant is not served stale.
    private static final String RENDERING = "header-logo-1";
    private static final String PATH = "/api/public/config/logo/header";

    private final ConfigService config;
    private final Map<String, byte[]> rendered = new ConcurrentHashMap<>();

    public AppIcon variant() {
        ClubLogo logo = config.logo();
        String version = version(logo.digest());
        rendered.keySet().removeIf(cached -> !cached.equals(version));
        byte[] content = rendered.computeIfAbsent(version,
                ignored -> AppIconRenderer.fitted(logo.decoded(), LONGEST_SIDE));
        return new AppIcon(content, version);
    }

    static String url(String digest) {
        return PATH + "?v=" + version(digest);
    }

    private static String version(String digest) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest((RENDERING + ":" + digest).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }
}
