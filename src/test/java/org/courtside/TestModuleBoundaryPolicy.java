package org.courtside;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

final class TestModuleBoundaryPolicy {

    private static final Path PRODUCTION_SOURCES = Path.of("src/main/java");
    private static final Pattern PACKAGE = Pattern.compile("package\\s+org\\.courtside\\.([a-z]+)(?:[.;])");
    private static final Pattern IMPORT = Pattern.compile(
            "import\\s+(?:static\\s+)?org\\.courtside\\.([a-z]+)\\.([A-Za-z0-9_.*]+);");
    private static final Set<String> REPOSITORY_MUTATIONS = Set.of(
            "delete", "deleteAll", "deleteAllById", "deleteAllInBatch", "deleteById",
            "flush", "save", "saveAll", "saveAllAndFlush", "saveAndFlush");

    private TestModuleBoundaryPolicy() {
    }

    static List<String> violationsIn(Path testSources) {
        try (Stream<Path> sources = Files.walk(testSources)) {
            return sources.filter(path -> path.toString().endsWith(".java"))
                    .sorted()
                    .flatMap(path -> violations(path, read(path)).stream())
                    .toList();
        } catch (IOException e) {
            throw new IllegalStateException("Cannot inspect test sources", e);
        }
    }

    static List<String> violations(Path sourcePath, String source) {
        String code = withoutLiteralsAndComments(source);
        Optional<String> sourceModule = moduleOf(code);
        if (sourceModule.isEmpty()) {
            return List.of();
        }

        List<ImportedType> foreignImports = importsOf(code).stream()
                .filter(imported -> !imported.module().equals(sourceModule.orElseThrow()))
                .toList();
        List<String> violations = new ArrayList<>();
        foreignImports.stream()
                .filter(imported -> imported.simpleName().equals("*"))
                .forEach(imported -> violations.add("%s uses a cross-module wildcard import %s"
                        .formatted(sourcePath, imported.qualifiedName())));
        foreignImports.stream()
                .filter(imported -> imported.qualifiedName().contains(".internal."))
                .forEach(imported -> violations.add("%s imports another module's internal type %s"
                        .formatted(sourcePath, imported.qualifiedName())));

        Set<String> entities = productionEntities();
        foreignImports.stream()
                .filter(imported -> entities.contains(imported.qualifiedName()))
                .filter(imported -> !isProductionDependency(sourceModule.orElseThrow(), imported))
                .filter(imported -> constructs(code, imported.simpleName()))
                .forEach(imported -> violations.add("%s constructs another module's entity %s"
                        .formatted(sourcePath, imported.qualifiedName())));

        foreignImports.stream()
                .filter(imported -> imported.simpleName().endsWith("Repository"))
                .filter(imported -> !isProductionDependency(sourceModule.orElseThrow(), imported))
                .forEach(imported -> repositoryMutations(code, imported.simpleName()).stream()
                        .forEach(mutation -> violations.add(
                                "%s mutates another module through %s.%s"
                                        .formatted(sourcePath, imported.simpleName(), mutation))));
        return violations;
    }

    private static Optional<String> moduleOf(String source) {
        Matcher matcher = PACKAGE.matcher(source);
        return matcher.find() ? Optional.of(matcher.group(1)) : Optional.empty();
    }

    private static List<ImportedType> importsOf(String source) {
        Matcher matcher = IMPORT.matcher(source);
        List<ImportedType> imports = new ArrayList<>();
        while (matcher.find()) {
            String remainder = matcher.group(2);
            String qualifiedName = "org.courtside." + matcher.group(1) + "." + remainder;
            imports.add(new ImportedType(matcher.group(1), qualifiedName,
                    remainder.substring(remainder.lastIndexOf('.') + 1)));
        }
        return imports;
    }

    private static boolean constructs(String source, String simpleName) {
        return Pattern.compile("\\bnew\\s+" + Pattern.quote(simpleName) + "\\s*\\(")
                .matcher(source).find();
    }

    private static List<String> repositoryMutations(String source, String repositoryType) {
        Pattern declaration = Pattern.compile("\\b" + Pattern.quote(repositoryType)
                + "\\s+([A-Za-z][A-Za-z0-9_]*)\\b");
        Matcher variables = declaration.matcher(source);
        Set<String> mutations = new HashSet<>();
        while (variables.find()) {
            String variable = variables.group(1);
            Pattern invocation = Pattern.compile("\\b" + Pattern.quote(variable)
                    + "\\s*\\.\\s*([A-Za-z][A-Za-z0-9_]*)\\s*\\(");
            Matcher methods = invocation.matcher(source);
            while (methods.find()) {
                if (REPOSITORY_MUTATIONS.contains(methods.group(1))) {
                    mutations.add(methods.group(1));
                }
            }
        }
        return mutations.stream().sorted().toList();
    }

    private static boolean isProductionDependency(String sourceModule, ImportedType imported) {
        Path moduleSources = PRODUCTION_SOURCES.resolve("org/courtside").resolve(sourceModule);
        if (!Files.isDirectory(moduleSources)) {
            return false;
        }
        String declaration = "import " + imported.qualifiedName() + ";";
        try (Stream<Path> sources = Files.walk(moduleSources)) {
            return sources.filter(path -> path.toString().endsWith(".java"))
                    .anyMatch(path -> read(path).contains(declaration));
        } catch (IOException e) {
            throw new IllegalStateException("Cannot inspect production module " + sourceModule, e);
        }
    }

    private static String withoutLiteralsAndComments(String source) {
        StringBuilder code = new StringBuilder(source.length());
        int index = 0;
        while (index < source.length()) {
            if (source.startsWith("\"\"\"", index)) {
                index = skipUntil(source, index + 3, "\"\"\"");
            } else if (source.startsWith("//", index)) {
                index = skipUntil(source, index + 2, "\n");
            } else if (source.startsWith("/*", index)) {
                index = skipUntil(source, index + 2, "*/");
            } else if (source.charAt(index) == '"') {
                index = skipQuoted(source, index + 1, '"');
            } else if (source.charAt(index) == '\'') {
                index = skipQuoted(source, index + 1, '\'');
            } else {
                code.append(source.charAt(index++));
            }
        }
        return code.toString();
    }

    private static int skipUntil(String source, int start, String terminator) {
        int end = source.indexOf(terminator, start);
        return end < 0 ? source.length() : end + terminator.length();
    }

    private static int skipQuoted(String source, int index, char quote) {
        while (index < source.length()) {
            if (source.charAt(index) == '\\') {
                index += 2;
            } else if (source.charAt(index++) == quote) {
                break;
            }
        }
        return index;
    }

    private static Set<String> productionEntities() {
        try (Stream<Path> sources = Files.walk(PRODUCTION_SOURCES)) {
            return sources.filter(path -> path.toString().endsWith(".java"))
                    .map(TestModuleBoundaryPolicy::entityName)
                    .flatMap(Optional::stream)
                    .collect(java.util.stream.Collectors.toUnmodifiableSet());
        } catch (IOException e) {
            throw new IllegalStateException("Cannot inspect production entities", e);
        }
    }

    private static Optional<String> entityName(Path source) {
        String content = read(source);
        if (!content.contains("@Entity")) {
            return Optional.empty();
        }
        Matcher packageMatcher = Pattern.compile("package\\s+([A-Za-z0-9_.]+);").matcher(content);
        if (!packageMatcher.find()) {
            throw new IllegalStateException("Cannot identify entity " + source);
        }
        String fileName = source.getFileName().toString();
        return Optional.of(packageMatcher.group(1) + "."
                + fileName.substring(0, fileName.length() - ".java".length()));
    }

    private static String read(Path source) {
        try {
            return Files.readString(source);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + source, e);
        }
    }

    private record ImportedType(String module, String qualifiedName, String simpleName) {
    }
}
