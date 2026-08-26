package org.courtside.shared.web;

import org.apache.catalina.connector.Request;
import org.apache.catalina.connector.Response;
import org.apache.catalina.valves.ErrorReportValve;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.json.ProblemDetailJacksonMixin;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.Writer;

// Tomcat refuses a malformed request target at the connector, before any dispatch this application
// could answer, and the page it writes for that is HTML.
public class ProblemDetailErrorReportValve extends ErrorReportValve {

    private static final JsonMapper MAPPER = JsonMapper.builder()
            .addMixIn(ProblemDetail.class, ProblemDetailJacksonMixin.class)
            .build();

    @Override
    protected void report(Request request, Response response, Throwable throwable) {
        if (response.getContentWritten() > 0 || !response.setErrorReported()) {
            return;
        }
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        try (Writer writer = response.getReporter()) {
            if (writer != null) {
                writer.write(MAPPER.writeValueAsString(
                        ContainerErrorController.problemFor(
                                ContainerErrorController.resolve(response.getStatus()))));
            }
        } catch (IOException ignored) {
            // The client is gone, so there is nobody left to answer.
        }
    }
}
