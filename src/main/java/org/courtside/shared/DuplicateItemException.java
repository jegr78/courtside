package org.courtside.shared;

import tools.jackson.core.JsonParser;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.exc.MismatchedInputException;

// A MismatchedInputException so Jackson records the property path as it unwinds.
public class DuplicateItemException extends MismatchedInputException {

    public DuplicateItemException(DeserializationContext context, JsonParser parser, String element) {
        super(parser, "Duplicate entry in an array that must hold each value at most once: " + element);
    }
}
