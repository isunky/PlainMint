import { describe, expect, it, vi } from "vitest";
import { resolveInitialSaveFolder } from "./saveFolderPolicy";
import type { DirectoryValidationResult } from "./types";

const validDirectory: DirectoryValidationResult = {
  valid: true,
  exists: true,
  isDirectory: true,
  readable: true,
  writable: true,
  availableBytes: 1024,
};

const unavailableDirectory: DirectoryValidationResult = {
  valid: false,
  exists: true,
  isDirectory: true,
  readable: true,
  writable: false,
  availableBytes: 0,
  errorCode: "not-writable",
};

describe("initial save folder policy", () => {
  it("prefers the cloud-synced folder for a new file", async () => {
    const validate = vi.fn().mockResolvedValue(validDirectory);

    await expect(resolveInitialSaveFolder({
      cloudSyncFolder: "C:\\OneDrive\\Notes",
      defaultSaveFolder: "C:\\Documents",
    }, 128, validate)).resolves.toEqual({ path: "C:\\OneDrive\\Notes", fallbackFrom: undefined });

    expect(validate).toHaveBeenCalledOnce();
    expect(validate).toHaveBeenCalledWith("C:\\OneDrive\\Notes", 128);
  });

  it("falls back to the default folder when the cloud folder is unavailable", async () => {
    const validate = vi.fn()
      .mockResolvedValueOnce(unavailableDirectory)
      .mockResolvedValueOnce(validDirectory);

    await expect(resolveInitialSaveFolder({
      cloudSyncFolder: "C:\\OneDrive\\Notes",
      defaultSaveFolder: "C:\\Documents",
    }, 256, validate)).resolves.toEqual({ path: "C:\\Documents", fallbackFrom: "cloud" });

    expect(validate).toHaveBeenNthCalledWith(1, "C:\\OneDrive\\Notes", 256);
    expect(validate).toHaveBeenNthCalledWith(2, "C:\\Documents", 256);
  });

  it("uses the system save location when no configured folder is available", async () => {
    const validate = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(resolveInitialSaveFolder({
      cloudSyncFolder: "C:\\OneDrive\\Notes",
      defaultSaveFolder: "C:\\Documents",
    }, 64, validate)).resolves.toEqual({ fallbackFrom: "cloud" });

    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("does not validate the same folder twice", async () => {
    const validate = vi.fn().mockResolvedValue(unavailableDirectory);

    await resolveInitialSaveFolder({
      cloudSyncFolder: "C:\\Shared",
      defaultSaveFolder: "C:\\Shared",
    }, 64, validate);

    expect(validate).toHaveBeenCalledOnce();
  });
});
