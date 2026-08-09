package org.courtside.shared;

import com.fasterxml.jackson.annotation.Nulls;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

// No array in the API document declares its items nullable, so a null inside one is a request the
// contract does not describe. Jackson's default is to put that null into the collection, where it
// travels on until something dereferences it — the caller then gets a 500 for an error they made.
//
// Rejected at the point it is read instead, it arrives as a failure carrying the property path,
// which the exception advice turns into the field a caller has to correct.
@Component
class RejectsNullElements implements JsonMapperBuilderCustomizer {

    @Override
    public void customize(JsonMapper.Builder builder) {
        builder.changeDefaultNullHandling(nulls -> nulls.withContentNulls(Nulls.FAIL));
    }
}
