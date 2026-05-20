import { describe, expect, it } from "vitest";
import {
  baseName,
  clampZoom,
  ensureD2FileName,
  fileNameFromPath,
  getDiagramViewBox,
  normalizeSvgSize,
  routePath,
} from "./utils";

describe("utils", () => {
  it("builds SVG path data from diagram route points", () => {
    expect(routePath([])).toBe("");
    expect(
      routePath([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
      ]),
    ).toBe("M 1 2 L 3 4 L 5 6");
  });

  it("normalizes D2 file names and paths", () => {
    expect(baseName("diagram.d2")).toBe("diagram");
    expect(baseName("archive.diagram.d2")).toBe("archive.diagram");
    expect(fileNameFromPath("/workspace/diagrams/main.d2")).toBe("main.d2");
    expect(fileNameFromPath("C:\\workspace\\main.d2")).toBe("main.d2");
    expect(fileNameFromPath("")).toBe("untitled.d2");
    expect(ensureD2FileName("main")).toBe("main.d2");
    expect(ensureD2FileName("main.d2")).toBe("main.d2");
  });

  it("clamps zoom to the supported range with two decimal precision", () => {
    expect(clampZoom(0)).toBe(0.1);
    expect(clampZoom(1.234)).toBe(1.23);
    expect(clampZoom(20)).toBe(10);
  });

  it("adds explicit dimensions from a root SVG viewBox", () => {
    expect(normalizeSvgSize('<svg viewBox="0 0 10.2 20.1"><g /></svg>')).toBe(
      '<svg viewBox="0 0 10.2 20.1" width="11" height="21"><g /></svg>',
    );
  });

  it("leaves SVG markup alone when size data cannot be inferred", () => {
    const withWidth = '<svg width="100" viewBox="0 0 10 20"></svg>';
    const withoutViewBox = "<svg><g /></svg>";
    const invalidViewBox = '<svg viewBox="0 0 nope 20"></svg>';

    expect(normalizeSvgSize(withWidth)).toBe(withWidth);
    expect(normalizeSvgSize(withoutViewBox)).toBe(withoutViewBox);
    expect(normalizeSvgSize(invalidViewBox)).toBe(invalidViewBox);
  });

  it("prefers the inner D2 SVG viewBox when present", () => {
    const svg =
      '<svg viewBox="0 0 800 600"><svg class="d2-svg" viewBox="10 20 300 200"></svg></svg>';

    expect(getDiagramViewBox(svg)).toBe("10 20 300 200");
    expect(getDiagramViewBox('<svg viewBox="1 2 3 4"></svg>')).toBe("1 2 3 4");
    expect(getDiagramViewBox("<svg></svg>")).toBe("0 0 800 600");
  });
});
