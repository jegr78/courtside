package org.courtside.config.internal;

import javax.imageio.ImageIO;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Line2D;
import java.awt.geom.Rectangle2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;

final class AppIconRenderer {

    static final Color SHADE = new Color(0x17211D);
    static final Color LINE = new Color(0xFCFBF9);
    static final Color CLAY = new Color(0xAF5030);

    private static final double MARK_GRID = 64;
    // The mark's rounded outline reaches 0.628 of its side from the centre, so this keeps it in a 0.4 radius.
    private static final double MASKABLE_MARK_SIDE = 0.6;
    private static final double SAFE_ZONE_DIAMETER = 0.8;

    private AppIconRenderer() {
    }

    static byte[] mark(int size, boolean maskable) {
        BufferedImage icon = canvas(size);
        Graphics2D graphics = graphics(icon);
        if (maskable) {
            graphics.setColor(SHADE);
            graphics.fillRect(0, 0, size, size);
            double side = size * MASKABLE_MARK_SIDE;
            drawMark(graphics, (size - side) / 2, side);
        } else {
            drawMark(graphics, 0, size);
        }
        graphics.dispose();
        return png(icon);
    }

    static byte[] logo(BufferedImage logo, int size, boolean maskable) {
        BufferedImage icon = canvas(size);
        Graphics2D graphics = graphics(icon);
        double scale;
        if (maskable) {
            graphics.setColor(background(logo));
            graphics.fillRect(0, 0, size, size);
            scale = (size * SAFE_ZONE_DIAMETER - 2) / Math.hypot(logo.getWidth(), logo.getHeight());
        } else {
            scale = (double) size / Math.max(logo.getWidth(), logo.getHeight());
        }
        int width = Math.max(1, (int) Math.floor(logo.getWidth() * scale));
        int height = Math.max(1, (int) Math.floor(logo.getHeight() * scale));
        graphics.drawImage(scaled(logo, width, height), (size - width) / 2, (size - height) / 2, null);
        graphics.dispose();
        return png(icon);
    }

    private static void drawMark(Graphics2D graphics, double offset, double side) {
        Graphics2D mark = (Graphics2D) graphics.create();
        mark.translate(offset, offset);
        mark.scale(side / MARK_GRID, side / MARK_GRID);
        RoundRectangle2D tile = new RoundRectangle2D.Double(1.25, 1.25, 61.5, 61.5, 22, 22);
        mark.setColor(SHADE);
        mark.fill(tile);
        mark.setColor(CLAY);
        mark.fill(new Rectangle2D.Double(11, 9, 9, 46));
        mark.setColor(LINE);
        mark.setStroke(new BasicStroke(2.5f, BasicStroke.CAP_SQUARE, BasicStroke.JOIN_MITER));
        mark.draw(tile);
        mark.draw(new Rectangle2D.Double(11, 9, 42, 46));
        mark.draw(new Line2D.Double(20, 9, 20, 55));
        mark.draw(new Line2D.Double(20, 31, 53, 31));
        mark.draw(new Line2D.Double(36.5, 9, 36.5, 31));
        mark.dispose();
    }

    private static Color background(BufferedImage logo) {
        int corner = logo.getRGB(0, 0);
        return corner >>> 24 == 0xFF ? new Color(corner) : Color.WHITE;
    }

    // Halving in steps keeps a large logo from aliasing, which one bilinear pass would do.
    private static BufferedImage scaled(BufferedImage source, int width, int height) {
        BufferedImage current = source;
        while (current.getWidth() != width || current.getHeight() != height) {
            int nextWidth = current.getWidth() / 2 >= width ? current.getWidth() / 2 : width;
            int nextHeight = current.getHeight() / 2 >= height ? current.getHeight() / 2 : height;
            BufferedImage next = canvas(nextWidth, nextHeight);
            Graphics2D graphics = graphics(next);
            graphics.drawImage(current, 0, 0, nextWidth, nextHeight, null);
            graphics.dispose();
            current = next;
        }
        return current;
    }

    private static BufferedImage canvas(int size) {
        return canvas(size, size);
    }

    private static BufferedImage canvas(int width, int height) {
        return new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
    }

    private static Graphics2D graphics(BufferedImage image) {
        Graphics2D graphics = image.createGraphics();
        graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        graphics.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
        return graphics;
    }

    private static byte[] png(BufferedImage image) {
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            if (!ImageIO.write(image, "png", output)) {
                throw new IllegalStateException("This runtime cannot write PNG");
            }
            return output.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
