package org.courtside;

import jakarta.validation.Constraint;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.lang.annotation.Annotation;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class ValidationMessageCoverageTest {

    // Every class in src/main exposing a getCode() accessor for a ProblemDetail's "code" — kept
    // in sync with the class name literals below by everyClassDeclaringGetCodeIsCoveredByAPattern.
    private static final List<String> CODE_CARRYING_EXCEPTION_SIMPLE_NAMES =
            List.of("ParticipantsInvalidException", "InvalidOpeningWindowException",
                    "RuleParameterInvalidException", "MembershipTypeRuleSetInvalidException",
                    "MembershipTypeRuleSetInactiveException", "MembershipTypeInactiveException",
                    "RosterCursorUnknownException");

    private static final List<String> GET_CODE_DECLARING_SIMPLE_NAMES =
            List.of("CodedDomainFailure", "InvalidOpeningWindowException");

    // Every construct in src/main that ends up as a ProblemDetail's "code": a constraint, a
    // RuleViolation, one of the getCode() carriers above, or a literal following a "code" key.
    private static final List<Pattern> CODE_LITERAL_PATTERNS = buildCodeLiteralPatterns();

    // What toMap's "validation." + AnnotationSimpleName can produce today. A new @Constraint
    // mints an unreviewed wire code until it is added here and to both bundles.
    private static final List<String> KNOWN_CONSTRAINT_ANNOTATION_SIMPLE_NAMES =
            List.of("DurationMin", "Email", "Max", "Min", "NotNull", "Pattern", "Size");

    private static List<Pattern> buildCodeLiteralPatterns() {
        List<Pattern> patterns = new ArrayList<>();
        patterns.add(Pattern.compile("new\\s+RuleViolation\\(\\s*\"([^\"]+)\""));
        CODE_CARRYING_EXCEPTION_SIMPLE_NAMES.forEach(name -> patterns.add(
                Pattern.compile("new\\s+" + name + "\\(\\s*\"([^\"]+)\"")));
        patterns.add(Pattern.compile("\"code\"\\s*,\\s*\"([^\"]+)\"(?!\\s*\\+)"));
        patterns.add(Pattern.compile("Optional\\.of\\(\\s*\"((?:booking|card|config|court|facility|"
                + "identity|membershipType|openingWindow|request|rule)\\.[^\"]+)\""));
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
    void everyCodeASpringValidatorRejectsWithHasAMessageKeyInBothBundles()
            throws IOException, URISyntaxException {
        // given — a cross-field rule names its code through rejectValue, which reaches the wire
        // like a constraint's simple name but is invisible to the annotation scan
        TreeSet<String> codes = new TreeSet<>();
        Pattern rejectValue = Pattern.compile("rejectValue\\(\\s*\"[^\"]+\",\\s*\"([^\"]+)\"");
        try (Stream<Path> sources = Files.walk(mainSourceDirectory())) {
            sources.filter(path -> path.toString().endsWith(".java")).forEach(path -> {
                try {
                    Matcher matcher = rejectValue.matcher(Files.readString(path));
                    matcher.results().forEach(result -> codes.add(result.group(1)));
                } catch (IOException e) {
                    throw new IllegalStateException("Cannot read " + path, e);
                }
            });
        }
        Properties english = loadBundle("/messages.properties");
        Properties german = loadBundle("/messages_de.properties");

        // when / then
        assertThat(codes)
                .as("at least one cross-field rule is expected to live in a Validator")
                .isNotEmpty();
        codes.forEach(code -> assertBothBundlesDefine(english, german,
                "validation." + code, "rejected by a Spring Validator in src/main"));
    }

    @Test
    void bothBundlesDefineTheSameKeys() throws IOException {
        // given — every other test here derives its keys; one written by hand into a single
        // bundle is derivable from nothing
        Properties english = loadBundle("/messages.properties");
        Properties german = loadBundle("/messages_de.properties");

        // when / then
        assertThat(german.stringPropertyNames())
                .as("messages_de.properties must define exactly the keys messages.properties does;"
                        + " a key present only in the English bundle silently falls back to English"
                        + " for a German-speaking member, and one present only in German is dead")
                .containsExactlyInAnyOrderElementsOf(english.stringPropertyNames());
    }

    @Test
    void everyClassDeclaringGetCodeIsCoveredByAPattern() throws IOException, URISyntaxException {
        // given
        TreeSet<String> getCodeClasses = new TreeSet<>();
        Set<String> generated = generatedTopLevelClassNames();
        Path classesRoot = classesDirectory();
        try (Stream<Path> files = Files.walk(classesRoot)) {
            files.filter(path -> path.toString().endsWith(".class"))
                    .forEach(path -> collectGetCodeClasses(classesRoot, path, generated, getCodeClasses));
        }

        // when / then — declared on CodedDomainFailure and inherited, plus on
        // InvalidOpeningWindowException, which carries a code but no params
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
        Set<String> generated = generatedTopLevelClassNames();
        TreeSet<String> resolved = new TreeSet<>();
        try (Stream<Path> files = Files.walk(classesRoot)) {
            files.filter(path -> path.toString().endsWith(".class"))
                    .forEach(path -> collectByGetCodeAccessibility(classesRoot, path, generated, resolved));
        }

        // when / then
        assertThat(resolved)
                .as("every name in CODE_CARRYING_EXCEPTION_SIMPLE_NAMES must be a class whose"
                        + " instances expose getCode(), declared or inherited")
                .containsAll(CODE_CARRYING_EXCEPTION_SIMPLE_NAMES);
    }

    // The generated error models answer getCode() without choosing a code. Read off disk so the
    // exemption is exactly what the generator wrote; constraint annotations stay in scope.
    private static Set<String> generatedTopLevelClassNames() throws IOException, URISyntaxException {
        Path root = classesDirectory().getParent()
                .resolve(Path.of("generated-sources", "openapi", "src", "main", "java"));
        assertThat(root).as("the OpenAPI generator's output directory").isDirectory();
        try (Stream<Path> sources = Files.walk(root)) {
            return sources.filter(path -> path.toString().endsWith(".java"))
                    .map(path -> root.relativize(path).toString())
                    .map(name -> name.substring(0, name.length() - ".java".length()))
                    .map(name -> name.replace(File.separatorChar, '.'))
                    .collect(Collectors.toCollection(TreeSet::new));
        }
    }

    private static boolean isGenerated(Set<String> generated, String className) {
        int nested = className.indexOf('$');
        return generated.contains(nested < 0 ? className : className.substring(0, nested));
    }

    private static void collectByGetCodeAccessibility(
            Path root, Path classFile, Set<String> generated, TreeSet<String> found) {
        String className = toClassName(root, classFile);
        if (isGenerated(generated, className)) {
            return;
        }
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

    private static void collectGetCodeClasses(
            Path root, Path classFile, Set<String> generated, TreeSet<String> getCodeClasses) {
        String className = toClassName(root, classFile);
        if (isGenerated(generated, className)) {
            return;
        }
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

    // Properties.load, not ResourceBundle: its containsKey searches the parent chain, so an
    // English-only key would satisfy the German assertion.
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
        // Both zones: a class-level constraint is as much a wire code as a field-level one, and
        // scanning fields alone let four ship without a bundle entry.
        collect(type.getAnnotations(), constraintNames);
        for (Field field : type.getDeclaredFields()) {
            collect(field.getAnnotations(), constraintNames);
        }
        // And on accessors: the generator annotates getters, so a field-and-type scan found
        // nothing at all in the generated models.
        for (Method method : type.getDeclaredMethods()) {
            collect(method.getAnnotations(), constraintNames);
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
