package org.courtside.shared.web;

import jakarta.servlet.http.HttpServletRequest;
import org.apache.coyote.BadRequestException;
import org.apache.tomcat.util.http.fileupload.FileUploadException;
import org.apache.tomcat.util.http.fileupload.MultipartStream;
import org.apache.tomcat.util.http.fileupload.impl.IOFileUploadException;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.util.Map;

final class Multipart {

    private Multipart() {
    }

    static boolean carriedBy(HttpServletRequest request) {
        return StringUtils.startsWithIgnoreCase(request.getContentType(), "multipart/");
    }

    // A failure is the server's only when nothing on its way up came from the client or the parser.
    static boolean failedOnTheServer(Throwable failure) {
        Throwable link = failure;
        for (int depth = 0; depth < 16; depth++) {
            if (link instanceof BadRequestException
                    || link instanceof MultipartStream.MalformedStreamException
                    || (link instanceof FileUploadException && !(link instanceof IOFileUploadException))) {
                return false;
            }
            if (link.getCause() == null || link.getCause() == link) {
                return link instanceof IOException;
            }
            link = link.getCause();
        }
        return false;
    }

    static String firstRepeatedParameter(HttpServletRequest request) {
        for (Map.Entry<String, String[]> parameter : request.getParameterMap().entrySet()) {
            if (parameter.getValue().length > 1) {
                return parameter.getKey();
            }
        }
        return null;
    }
}
