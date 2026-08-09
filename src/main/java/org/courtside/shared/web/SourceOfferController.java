package org.courtside.shared.web;

import org.courtside.api.ApiSourceOffer;
import org.courtside.api.SourceApi;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.info.BuildProperties;
import org.springframework.boot.info.GitProperties;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;

// AGPL section 13 asks a club that modified Courtside to offer its members the source. Public,
// because the obligation runs to the people using the service.
@RestController
class SourceOfferController implements SourceApi {

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
        this.sourceUrl = sourceUrl;
    }

    @Override
    public ResponseEntity<ApiSourceOffer> getSourceOffer() {
        return ResponseEntity.ok(new ApiSourceOffer(build.getVersion(), sourceUrl)
                .commit(git == null ? null : git.getCommitId()));
    }
}
