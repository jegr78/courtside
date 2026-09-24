package org.courtside.config.internal;

import java.util.List;

public record InstalledAppManifest(
        String name,
        String shortName,
        String description,
        String lang,
        String themeColor,
        String backgroundColor,
        List<Icon> icons,
        List<Shortcut> shortcuts) {

    public record Icon(String src, String sizes, String type, String purpose) {
    }

    public record Shortcut(String name, String url) {
    }
}
