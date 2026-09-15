package org.courtside.dataexchange;

import jakarta.persistence.Column;
import org.courtside.dataexchange.internal.ImportPreview;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

class ImportPreviewRetentionShapeTest {

    @Test
    void whenAPreviewIsStored_thenNothingInItCanHoldTheUploadedBytes() {
        // when
        var persisted = Arrays.stream(ImportPreview.class.getDeclaredFields())
                .filter(field -> field.isAnnotationPresent(Column.class))
                .toList();

        // then
        assertThat(persisted).isNotEmpty();
        assertThat(persisted).extracting(Field::getType).doesNotContain(byte[].class);
        assertThat(persisted).extracting(field -> field.getAnnotation(Column.class).name())
                .contains("file_name", "file_hash", "change_set")
                .doesNotContain("content", "snapshot", "bytes", "file");
    }
}
