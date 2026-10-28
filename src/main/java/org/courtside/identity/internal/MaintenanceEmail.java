package org.courtside.identity.internal;

import com.sun.security.auth.module.UnixSystem;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.OpenOption;
import java.nio.file.Path;
import java.nio.file.SecureDirectoryStream;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributeView;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFileAttributes;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

final class MaintenanceEmail {
    private MaintenanceEmail() { }

    static String read(Path supplied) {
        try {
            if (supplied == null || !supplied.isAbsolute()) throw refusal();
            Path file = supplied.normalize();
            if (!supplied.equals(file) || !file.equals(file.toRealPath())) throw refusal();
            long uid = new UnixSystem().getUid();
            List<Directory> chain = directories(file.getParent(), uid);
            List<DirectoryStream<Path>> opened = new ArrayList<>();
            try {
                DirectoryStream<Path> first = Files.newDirectoryStream(file.getRoot());
                opened.add(first);
                if (!(first instanceof SecureDirectoryStream<Path> secure)) throw refusal();
                SecureDirectoryStream<Path> parent = secure;
                for (int index = 0; index < chain.size(); index++) {
                    Directory directory = chain.get(index);
                    if (index > 0) {
                        parent = parent.newDirectoryStream(directory.path().getFileName(), LinkOption.NOFOLLOW_LINKS);
                        opened.add(parent);
                    }
                    if (!directory.fileKey().equals(parent.getFileAttributeView(BasicFileAttributeView.class)
                            .readAttributes().fileKey())) throw refusal();
                }
                return readFrom(parent, file, uid);
            } finally {
                for (int index = opened.size() - 1; index >= 0; index--) opened.get(index).close();
            }
        } catch (IOException | UnsupportedOperationException failure) {
            throw refusal();
        }
    }

    private static String readFrom(SecureDirectoryStream<Path> parent, Path file, long uid) throws IOException {
        var unix = Files.readAttributes(file, "unix:uid,nlink,fileKey", LinkOption.NOFOLLOW_LINKS);
        PosixFileAttributes attributes = parent.getFileAttributeView(file.getFileName(), PosixFileAttributeView.class,
                LinkOption.NOFOLLOW_LINKS).readAttributes();
        if (!attributes.isRegularFile() || attributes.size() > 255
                || !attributes.fileKey().equals(unix.get("fileKey"))
                || !attributes.permissions().equals(PosixFilePermissions.fromString("rw-------"))
                || ((Number) unix.get("uid")).longValue() != uid
                || ((Number) unix.get("nlink")).longValue() != 1) throw refusal();
        ByteBuffer bytes = ByteBuffer.allocate(256);
        try (var input = parent.newByteChannel(file.getFileName(), Set.<OpenOption>of(
                StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS))) {
            while (bytes.hasRemaining() && input.read(bytes) != -1) { }
            if (input.size() > 255 || !attributes.fileKey().equals(parent.getFileAttributeView(file.getFileName(),
                    BasicFileAttributeView.class, LinkOption.NOFOLLOW_LINKS).readAttributes().fileKey())) throw refusal();
        }
        int length = bytes.position();
        if (length > 0 && bytes.get(length - 1) == '\n') length--;
        if (length == 0 || length > 254) throw refusal();
        String value = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(Arrays.copyOf(bytes.array(), length))).toString();
        if (value.isBlank() || value.codePoints().anyMatch(Character::isISOControl)) throw refusal();
        return value;
    }

    private static List<Directory> directories(Path parent, long uid) throws IOException {
        List<Directory> result = new ArrayList<>();
        for (Path directory = parent; directory != null; directory = directory.getParent()) {
            var attributes = Files.readAttributes(directory, "unix:uid,mode,fileKey", LinkOption.NOFOLLOW_LINKS);
            int mode = ((Number) attributes.get("mode")).intValue();
            if ((mode & 0170000) != 0040000) throw refusal();
            result.addFirst(new Directory(directory, attributes.get("fileKey"),
                    ((Number) attributes.get("uid")).longValue(), mode));
        }
        for (int index = 0; index < result.size(); index++) {
            Directory directory = result.get(index);
            Directory child = index + 1 < result.size() ? result.get(index + 1) : null;
            if (!trustedDirectory(directory.owner(), directory.mode(), uid,
                    child == null ? -1 : child.owner(), child == null ? 0 : child.mode())) throw refusal();
        }
        return result;
    }

    static boolean trustedDirectory(long owner, int mode, long uid, long childOwner, int childMode) {
        if (owner != 0 && owner != uid) return false;
        if ((mode & 0022) == 0) return true;
        return owner == 0 && (mode & 01000) != 0 && childOwner == uid && (childMode & 0077) == 0;
    }

    private static IllegalStateException refusal() {
        return new IllegalStateException("Maintenance email requires a private owned regular UTF-8 file in trusted directories");
    }

    private record Directory(Path path, Object fileKey, long owner, int mode) { }
}
