import "@testing-library/jest-dom/vitest";

Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
