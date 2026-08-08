package org.courtside;

import jakarta.validation.Constraint;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.lang.annotation.Annotation;
import java.lang.reflect.Field;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class ValidationMessageCoverageTest {

    // Every class in src/main exposing a getCode() accessor for a ProblemDetail's "code" — kept
    // in sync with the class name literals below by everyClassDeclaringGetCodeIsCoveredByAPattern.
    private static final List<String> CODE_CARRYING_EXCEPTION_SIMPLE_NAMES =
            List.of("ParticipantsInvalidException", "InvalidOpeningWindowException",
                    "RuleParameterInvalidException", "MembershipTypeRuleSetInvalidException",
                    "MembershipTypeRuleSetInactiveException");

    private static final List<String> GET_CODE_DECLARING_SIMPLE_NAMES =
            List.of("CodedDomainFailure", "InvalidOpeningWindowException");

    // Every construct in src/main that ends up as a ProblemDetail's "code": a Bean Validation
    // constraint (validation.<AnnotationSimpleName>, resolved dynamically), a RuleViolation, one
    // of the getCode()-carrying exceptions above, or a literal passed alongside a "code" key in a
    // Map or ProblemDetail property.
    private static final List<Pattern> CODE_LITERAL_PATTERNS = buildCodeLiteralPatterns();

    // The set SharedExceptionHandler.toMap's "validation." + AnnotationSimpleName concatenation can
    // actually produce today, kept in sync with reality by
    // everyConstraintAnnotationUsedInMainIsInTheKnownSet: a new @Constraint annotation mints an
    // unreviewed code on this frozen wire contract until it is added here and to both bundles.
    private static final List<String> KNOWN_CONSTRAINT_ANNOTATION_SIMPLE_NAMES =
            List.of("ChronologicalSeries", "ChronologicalSlot", "KnownRole", "Max", "Min",
                    "MoveChangesSomething", "NoDuplicates", "NotBlank", "NotEmpty", "NotNull",
                    "Pattern", "Positive", "SeriesEndsOnce", "Size");

    private static List<Pattern> buildCodeLiteralPatterns() {
        List<Pattern> patterns = new ArrayList<>();
        patterns.add(Pattern.compile("new\\s+RuleViolation\\(\\s*\"([^\"]+)\""));
        CODE_CARRYING_EXCEPTION_SIMPLE_NAMES.forEach(name -> patterns.add(
                Pattern.compile("new\\s+" + name + "\\(\\s*\"([^\"]+)\"")));
        patterns.add(Pattern.compile("\"code\"\\s*,\\s*\"([^\"]+)\"(?!\\s*\\+)"));
        return patterns;
    }

    @Test
    void everyConstraintAnnotationUsedInMainHasAMessageKeyInBothBundles() throws IOException, URISyntaxException {
        // given
        TreeSet<String> constraintNames = new TreeSet<>();
        Path classesRoot = classesDirectory();
        try (Stream<Path> files = Files.walk(classesRoot)) {
            files.filter(path -> path.toString().endsWith(".class"))
                    .forEach(path -> collectConstraintNames(classesRoot, path, constraintNames));
        }
        Properties english = loadBundle("/messages.properties");
        Properties german = loadBundle("/messages_de.properties");

        // when / then
        assertThat(constraintNames).isNotEmpty();
        constraintNames.forEach(name -> assertBothBundlesDefine(english, german,
                "validation." + name, "used in src/main"));
    }

    @Test
    void everyConstraintAnnotationUsedInMainIsInTheKnownSet() throws IOException, URISyntaxException {
        // given
        TreeSet<String> constraintNames = new TreeSet<>();
        Path classesRoot = classesDirectory();
        try (Stream<Path> files = Files.walk(classesRoot)) {
            files.filter(path -> path.toString().endsWith(".class"))
                    .forEach(path -> collectConstraintNames(classesRoot, path, constraintNames));
        }

        // when / then — an unlisted annotation would silently mint an unreviewed
        // validation.<AnnotationSimpleName> code on the frozen wire contract
        assertThat(constraintNames)
                .as("a new constraint annotation used in src/main must be added to "
                        + "KNOWN_CONSTRAINT_ANNOTATION_SIMPLE_NAMES, with a validation.<name> entry "
                        + "added to both message bundles")
                .containsExactlyInAnyOrderElementsOf(KNOWN_CONSTRAINT_ANNOTATION_SIMPLE_NAMES);
    }

    @Test
    void everyCodeLiteralPassedToASetPropertyCodeCallHasAMessageKeyInBothBundles() throws IOException, URISyntaxException {
        // given
        TreeSet<String> codes = new TreeSet<>();
        Path sourceRoot = mainSourceDirectory();
        try (Stream<Path> files = Files.walk(sourceRoot)) {
            files.filter(path -> path.toString().endsWith(".java"))
                    .forEach(path -> collectCodeLiterals(path, codes));
        }
        Properties english = loadBundle("/messages.properties");
        Properties german = loadBundle("/messages_de.properties");

        // when / then
        assertThat(codes).isNotEmpty();
        codes.forEach(code -> assertBothBundlesDefine(english, german,
                code, "passed as a problem code literal in src/main"));
    }

    @Test
    void everyClassDeclaringGetCodeIsCoveredByAPattern() throws IOException, URISyntaxException {
        // given
        TreeSet<String> getCodeClasses = new TreeSet<>();
        Path classesRoot = classesDirectory();
        try (Stream<Path> files = Files.walk(classesRoot)) {
            files.filter(path -> path.toString().endsWith(".class"))
                    .forEach(path -> collectGetCodeClasses(classesRoot, path, getCodeClasses));
        }

        // when / then — getCode() is declared once on CodedDomainFailure and inherited by its
        // subclasses, plus once on InvalidOpeningWindowException, which carries a code but no
        // params and so does not extend it
        assertThat(getCodeClasses)
                .as("a class declaring getCode() must be named in GET_CODE_DECLARING_SIMPLE_NAMES,"
                        + " and every concrete failure that carries a code must appear in"
                        + " CODE_CARRYING_EXCEPTION_SIMPLE_NAMES so"
                        + " everyCodeLiteralPassedToASetPropertyCodeCallHasAMessageKeyInBothBundles"
                        + " actually covers its code literals")
                .containsExactlyInAnyOrderElementsOf(GET_CODE_DECLARING_SIMPLE_NAMES);
    }

    @Test
    void everyCodeCarryingExceptionActuallyExposesGetCode() throws IOException, URISyntaxException {
        // given — the list above builds the "new X(\"literal\"" patterns; a name that no longer
        // names a code-carrying failure would silently stop matching anything at all
        Path classesRoot = classesDirectory();
        TreeSet<String> resolved = new TreeSet<>();
        try (Stream<Path> files = Files.walk(classesRoot)) {
            files.filter(path -> path.toString().endsWith(".class"))
                    .forEach(path -> collectByGetCodeAccessibility(classesRoot, path, resolved));
        }

        // when / then
        assertThat(resolved)
                .as("every name in CODE_CARRYING_EXCEPTION_SIMPLE_NAMES must be a class whose"
                        + " instances expose getCode(), declared or inherited")
                .containsAll(CODE_CARRYING_EXCEPTION_SIMPLE_NAMES);
    }

    private static void collectByGetCodeAccessibility(Path root, Path classFile, TreeSet<String> found) {
        String className = toClassName(root, classFile);
        Class<?> type;
        try {
            type = Class.forName(className, false, ValidationMessageCoverageTest.class.getClassLoader());
        } catch (Throwable ignored) {
            return;
        }
        try {
            type.getMethod("getCode");
            found.add(type.getSimpleName());
        } catch (NoSuchMethodException ignored) {
        }
    }

    private static void collectGetCodeClasses(Path root, Path classFile, TreeSet<String> getCodeClasses) {
        String className = toClassName(root, classFile);
        Class<?> type;
        try {
            type = Class.forName(className, false, ValidationMessageCoverageTest.class.getClassLoader());
        } catch (Throwable ignored) {
            return;
        }
        try {
            type.getDeclaredMethod("getCode");
            getCodeClasses.add(type.getSimpleName());
        } catch (NoSuchMethodException ignored) {
        }
    }

    private static void assertBothBundlesDefine(
            Properties english, Properties german, String key, String reason) {
        assertThat(english.containsKey(key))
                .as("messages.properties must define %s (%s)", key, reason)
                .isTrue();
        assertThat(german.containsKey(key))
                .as("messages_de.properties must define %s (%s)", key, reason)
                .isTrue();
    }

    // Properties.load, not ResourceBundle: ResourceBundle.containsKey searches the parent chain,
    // and messages_de's parent is messages — so any key present in the English bundle alone would
    // make the German assertion pass regardless of what messages_de.properties actually defines.
    private static Properties loadBundle(String resourceName) throws IOException {
        Properties properties = new Properties();
        try (InputStream in = ValidationMessageCoverageTest.class.getResourceAsStream(resourceName)) {
            assertThat(in).as("%s must be on the classpath", resourceName).isNotNull();
            properties.load(in);
        }
        return properties;
    }

    private static Path classesDirectory() throws URISyntaxException {
        return Path.of(CourtsideApplication.class.getProtectionDomain().getCodeSource().getLocation().toURI());
    }

    private static Path mainSourceDirectory() throws URISyntaxException {
        return classesDirectory().getParent().getParent().resolve(Path.of("src", "main", "java"));
    }

    private static void collectConstraintNames(Path root, Path classFile, TreeSet<String> constraintNames) {
        String className = toClassName(root, classFile);
        Class<?> type;
        try {
            type = Class.forName(className, false, ValidationMessageCoverageTest.class.getClassLoader());
        } catch (Throwable ignored) {
            return;
        }
        // Both zones: a constraint on the record itself (a cross-field rule such as "a booking
        // must end after it starts") is as much a wire code as one on a field, and scanning only
        // fields let four of them ship without a bundle entry.
        collect(type.getAnnotations(), constraintNames);
        for (Field field : type.getDeclaredFields()) {
            collect(field.getAnnotations(), constraintNames);
        }
    }

    private static void collect(Annotation[] annotations, TreeSet<String> constraintNames) {
        for (Annotation annotation : annotations) {
            if (annotation.annotationType().isAnnotationPresent(Constraint.class)) {
                constraintNames.add(annotation.annotationType().getSimpleName());
            }
        }
    }

    private static void collectCodeLiterals(Path javaFile, TreeSet<String> codes) {
        String source;
        try {
            source = Files.readString(javaFile);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        for (Pattern pattern : CODE_LITERAL_PATTERNS) {
            Matcher matcher = pattern.matcher(source);
            while (matcher.find()) {
                codes.add(matcher.group(1));
            }
        }
    }

    private static String toClassName(Path root, Path classFile) {
        String relative = root.relativize(classFile).toString();
        return relative.substring(0, relative.length() - ".class".length()).replace(File.separatorChar, '.');
    }
}
