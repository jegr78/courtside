package org.courtside.shared.web;

import org.courtside.api.ApiSourceOffer;
import org.courtside.api.ApiSourceOffer.EnvironmentEnum;
import org.courtside.api.SourceApi;
import org.jspecify.annotations.Nullable;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.info.BuildProperties;
import org.springframework.boot.info.GitProperties;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;

@RestController
class SourceOfferController implements SourceApi {

    private static final Set<String> SCHEMES_A_MEMBER_CAN_FOLLOW = Set.of("http", "https");

    private final BuildProperties build;
    private final GitProperties git;
    private final URI sourceUrl;
    private final EnvironmentEnum environment;

    SourceOfferController(BuildProperties build,
                          // Absent when the build had no repository to read.
                          @Nullable GitProperties git,
                          @Value("${courtside.source-url}") URI sourceUrl,
                          @Value("${courtside.environment}") String environment) {
        this.build = build;
        this.git = git;
        this.sourceUrl = requireAnOfferAMemberCanFollow(sourceUrl);
        this.environment = requireKnownEnvironment(environment);
    }

    @Override
    public ResponseEntity<ApiSourceOffer> getSourceOffer() {
        return ResponseEntity.ok(new ApiSourceOffer(build.getVersion(), environment, sourceUrl)
                .commit(git == null ? null : git.getCommitId()));
    }

    private static EnvironmentEnum requireKnownEnvironment(String environment) {
        if (environment == null || environment.isBlank()) {
            throw new IllegalStateException(
                    "courtside.environment must be PRODUCTION, UAT, DEVELOPMENT, PERFORMANCE, or SECURITY");
        }
        String normalized = environment.toUpperCase(Locale.ROOT);
        return Arrays.stream(EnvironmentEnum.values())
                .filter(candidate -> candidate.getValue().equals(normalized))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        "courtside.environment must be PRODUCTION, UAT, DEVELOPMENT, PERFORMANCE, or SECURITY. Got: "
                                + environment));
    }

    private static URI requireAnOfferAMemberCanFollow(URI sourceUrl) {
        if (sourceUrl.getScheme() == null
                || !SCHEMES_A_MEMBER_CAN_FOLLOW.contains(sourceUrl.getScheme().toLowerCase())
                || sourceUrl.getHost() == null
                || sourceUrl.getUserInfo() != null) {
            throw new IllegalStateException(
                    "courtside.source-url must be an http or https address without credentials "
                            + "that a member can open, "
                            + "because it is the offer of source AGPL section 13 asks for");
        }
        return sourceUrl;
    }
}
