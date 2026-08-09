package org.courtside.shared;

import com.fasterxml.jackson.annotation.Nulls;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

// No array in the document declares its items nullable. Jackson would otherwise carry the null
// into the collection until something dereferences it, and answer 500 for the caller's mistake.
@Component
class RejectsNullElements implements JsonMapperBuilderCustomizer {

    @Override
    public void customize(JsonMapper.Builder builder) {
        builder.changeDefaultNullHandling(nulls -> nulls.withContentNulls(Nulls.FAIL));
    }
}
