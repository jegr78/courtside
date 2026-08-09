package org.courtside.shared;

import tools.jackson.core.JsonParser;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.exc.MismatchedInputException;

// A MismatchedInputException so that Jackson records the property path as the failure unwinds:
// that path is what lets the advice name the field a client has to correct, instead of answering
// that the whole body was unreadable.
public class DuplicateItemException extends MismatchedInputException {

    public DuplicateItemException(DeserializationContext context, JsonParser parser, String element) {
        super(parser, "Duplicate entry in an array that must hold each value at most once: " + element);
    }
}
