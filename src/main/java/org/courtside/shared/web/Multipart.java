package org.courtside.shared.web;

import jakarta.servlet.http.HttpServletRequest;
import org.apache.catalina.connector.ClientAbortException;
import org.apache.tomcat.util.http.fileupload.FileUploadException;
import org.apache.tomcat.util.http.fileupload.MultipartStream;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.util.Map;

final class Multipart {

    private Multipart() {
    }

    static boolean carriedBy(HttpServletRequest request) {
        return StringUtils.startsWithIgnoreCase(request.getContentType(), "multipart/");
    }

    // The parser reports a body it cannot read as its own exception; any other I/O failure beneath is the server's.
    static boolean failedOnTheServer(Throwable failure) {
        Throwable root = failure;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        return root instanceof IOException
                && !(root instanceof FileUploadException || root instanceof MultipartStream.MalformedStreamException
                || root instanceof ClientAbortException);
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
