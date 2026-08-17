package org.courtside.shared;

import com.fasterxml.jackson.annotation.Nulls;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

// No array in the document declares its items nullable.
@Component
class RejectsNullElements implements JsonMapperBuilderCustomizer {

    @Override
    public void customize(JsonMapper.Builder builder) {
        builder.changeDefaultNullHandling(nulls -> nulls.withContentNulls(Nulls.FAIL));
    }
}
