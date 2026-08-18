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
    private static final Pattern QUALIFIED_TYPE = Pattern.compile(
            "\\borg\\.courtside\\.([a-z]+)\\.((?:[a-z][A-Za-z0-9_]*\\.)*([A-Z][A-Za-z0-9_]*))\\b");
    private static final Set<String> REPOSITORY_MUTATIONS = Set.of(
            "delete", "deleteAll", "deleteAllById", "deleteAllByIdInBatch", "deleteAllInBatch",
            "deleteById", "deleteInBatch",
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
        Set<ImportedType> foreignTypes = typesOf(code).stream()
                .filter(type -> !type.module().equals(sourceModule.orElseThrow()))
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
        List<String> violations = new ArrayList<>();
        foreignImports.stream()
                .filter(imported -> imported.simpleName().equals("*"))
                .forEach(imported -> violations.add("%s uses a cross-module wildcard import %s"
                        .formatted(sourcePath, imported.qualifiedName())));
        foreignTypes.stream()
                .filter(type -> type.qualifiedName().contains(".internal."))
                .sorted(java.util.Comparator.comparing(ImportedType::qualifiedName))
                .forEach(type -> violations.add("%s references another module's internal type %s"
                        .formatted(sourcePath, type.qualifiedName())));

        Set<String> entities = productionEntities();
        foreignTypes.stream()
                .filter(type -> entities.contains(type.qualifiedName()))
                .filter(type -> constructs(code, type))
                .sorted(java.util.Comparator.comparing(ImportedType::qualifiedName))
                .forEach(type -> violations.add("%s constructs another module's entity %s"
                        .formatted(sourcePath, type.qualifiedName())));

        foreignTypes.stream()
                .filter(type -> type.simpleName().endsWith("Repository"))
                .sorted(java.util.Comparator.comparing(ImportedType::qualifiedName))
                .forEach(type -> repositoryMutations(code, type).stream()
                        .forEach(mutation -> violations.add(
                                "%s mutates another module through %s.%s"
                                        .formatted(sourcePath, type.simpleName(), mutation))));
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

    private static Set<ImportedType> typesOf(String source) {
        Set<ImportedType> types = new HashSet<>(importsOf(source));
        Matcher matcher = QUALIFIED_TYPE.matcher(source);
        while (matcher.find()) {
            types.add(new ImportedType(matcher.group(1), "org.courtside." + matcher.group(1) + "." + matcher.group(2),
                    matcher.group(3)));
        }
        return types;
    }

    private static boolean constructs(String source, ImportedType type) {
        return constructs(source, type.simpleName()) || constructs(source, type.qualifiedName());
    }

    private static boolean constructs(String source, String typeName) {
        return Pattern.compile("\\bnew\\s+" + Pattern.quote(typeName) + "\\s*\\(")
                .matcher(source).find();
    }

    private static List<String> repositoryMutations(String source, ImportedType repositoryType) {
        Set<String> mutations = new HashSet<>();
        mutations.addAll(repositoryMutations(source, repositoryType.simpleName()));
        mutations.addAll(repositoryMutations(source, repositoryType.qualifiedName()));
        return mutations.stream().sorted().toList();
    }

    private static Set<String> repositoryMutations(String source, String repositoryType) {
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
                if (REPOSITORY_MUTATIONS.contains(methods.group(1))
                        && !isMockitoStubbing(source, methods.start())) {
                    mutations.add(methods.group(1));
                }
            }
        }
        return mutations;
    }

    private static boolean isMockitoStubbing(String source, int invocationStart) {
        String prefix = source.substring(Math.max(0, invocationStart - 40), invocationStart);
        return Pattern.compile("\\bwhen\\s*\\(\\s*$").matcher(prefix).find();
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
