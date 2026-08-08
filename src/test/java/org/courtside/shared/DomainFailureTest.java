package org.courtside.shared;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;

import java.net.URI;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class DomainFailureTest {

    private static final ProblemType PLAIN = new ProblemType(
            "court-not-found", HttpStatus.NOT_FOUND, "Court not found", "No such court");

    private static final ProblemType WITH_CODE = new ProblemType(
            "participants-invalid", HttpStatus.BAD_REQUEST,
            "Participants invalid", "The participants of this booking are not acceptable");

    private static final class PlainFailure extends DomainFailure {
        PlainFailure(String message) {
            super(message);
        }

        @Override
        public ProblemType problemType() {
            return PLAIN;
        }
    }

    private static final class CodeCarryingFailure extends DomainFailure {
        CodeCarryingFailure() {
            super("booking.participants.notTracked");
        }

        @Override
        public ProblemType problemType() {
            return WITH_CODE;
        }

        @Override
        protected Map<String, Object> properties() {
            return Map.of("code", "booking.participants.notTracked",
                    "params", Map.of("cardLabel", "Training"));
        }
    }

    @Test
    void givenAFailure_whenAskedForItsStatus_thenItComesFromItsProblemType() {
        // when / then
        assertThat(new PlainFailure("No court with id 7").getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void givenAFailure_whenAskedForItsBody_thenTypeTitleAndDetailComeFromItsProblemType() {
        // when
        ProblemDetail body = new PlainFailure("No court with id 7").getBody();

        // then
        assertThat(body.getType()).isEqualTo(URI.create("urn:courtside:error:court-not-found"));
        assertThat(body.getTitle()).isEqualTo("Court not found");
        assertThat(body.getDetail()).isEqualTo("No such court");
        assertThat(body.getStatus()).isEqualTo(HttpStatus.NOT_FOUND.value());
    }

    @Test
    void givenAFailureWhoseMessageNamesAnIdentifier_whenAskedForItsBody_thenTheMessageIsNotInIt() {
        // given — a message may carry an id or the caller's own input, and neither belongs in a
        // response body; the detail is the ProblemType's, always
        DomainFailure failure = new PlainFailure("No court with id 7f3a-secret");

        // when / then
        assertThat(failure.getBody().getDetail()).doesNotContain("7f3a-secret");
    }

    @Test
    void givenAFailureCarryingNoExtraProperties_whenAskedForItsBody_thenItHasNone() {
        // when / then
        assertThat(new PlainFailure("No court with id 7").getBody().getProperties()).isNull();
    }

    @Test
    void givenAFailureCarryingCodeAndParams_whenAskedForItsBody_thenBothAreInIt() {
        // when
        ProblemDetail body = new CodeCarryingFailure().getBody();

        // then
        assertThat(body.getProperties())
                .containsEntry("code", "booking.participants.notTracked")
                .containsEntry("params", Map.of("cardLabel", "Training"));
    }

    @Test
    void givenAFailure_whenAskedForItsHeaders_thenThereAreNone() {
        // given — no domain failure needs a header today; the hook exists because a 405 does
        // when / then
        assertThat(new PlainFailure("No court with id 7").getHeaders().isEmpty()).isTrue();
    }

    @Test
    void givenAFailure_whenItIsAskedTwiceForItsBody_thenTheSecondAnswerIsNotPollutedByTheFirst() {
        // given — getBody must build a fresh ProblemDetail; a cached, mutable one would let a
        // caller that sets a property on it change what a later caller sees
        DomainFailure failure = new CodeCarryingFailure();

        // when
        failure.getBody().setProperty("leaked", true);

        // then
        assertThat(failure.getBody().getProperties()).doesNotContainKey("leaked");
    }
}
