package org.courtside.shared.web;

import org.courtside.api.ApiSourceOffer;
import org.courtside.api.SourceApi;
import org.jspecify.annotations.Nullable;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.info.BuildProperties;
import org.springframework.boot.info.GitProperties;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.Set;

@RestController
class SourceOfferController implements SourceApi {

    private static final Set<String> SCHEMES_A_MEMBER_CAN_FOLLOW = Set.of("http", "https");

    private final BuildProperties build;
    private final GitProperties git;
    private final URI sourceUrl;

    SourceOfferController(BuildProperties build,
                          // Absent when the build had no repository to read, a source archive
                          // for one; the version is then all there is to go on.
                          @Nullable GitProperties git,
                          @Value("${courtside.source-url}") URI sourceUrl) {
        this.build = build;
        this.git = git;
        this.sourceUrl = requireAnOfferAMemberCanFollow(sourceUrl);
    }

    @Override
    public ResponseEntity<ApiSourceOffer> getSourceOffer() {
        return ResponseEntity.ok(new ApiSourceOffer(build.getVersion(), sourceUrl)
                .commit(git == null ? null : git.getCommitId()));
    }

    private static URI requireAnOfferAMemberCanFollow(URI sourceUrl) {
        if (sourceUrl.getScheme() == null
                || !SCHEMES_A_MEMBER_CAN_FOLLOW.contains(sourceUrl.getScheme().toLowerCase())
                || sourceUrl.getHost() == null) {
            throw new IllegalStateException(
                    "courtside.source-url must be an http or https address a member can open, "
                            + "because it is the offer of source AGPL section 13 asks for. Got: "
                            + sourceUrl);
        }
        return sourceUrl;
    }
}
