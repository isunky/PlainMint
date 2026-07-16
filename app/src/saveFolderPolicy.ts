import type { DirectoryValidationResult, UserSettings } from "./types";

export type SaveFolderSource = "cloud" | "default";

interface SaveFolderCandidate {
  path: string;
  source: SaveFolderSource;
}

export interface InitialSaveFolderResolution {
  path?: string;
  fallbackFrom?: SaveFolderSource;
}

type DirectoryValidator = (path: string, requiredBytes: number) => Promise<DirectoryValidationResult>;

function initialSaveFolderCandidates(
  settings: Pick<UserSettings, "cloudSyncFolder" | "defaultSaveFolder">,
): SaveFolderCandidate[] {
  const candidates = [
    settings.cloudSyncFolder ? { path: settings.cloudSyncFolder, source: "cloud" as const } : undefined,
    settings.defaultSaveFolder ? { path: settings.defaultSaveFolder, source: "default" as const } : undefined,
  ].filter((candidate): candidate is SaveFolderCandidate => Boolean(candidate));

  return candidates.filter((candidate, index) => (
    candidates.findIndex(({ path }) => path === candidate.path) === index
  ));
}

export async function resolveInitialSaveFolder(
  settings: Pick<UserSettings, "cloudSyncFolder" | "defaultSaveFolder">,
  requiredBytes: number,
  validateDirectory: DirectoryValidator,
): Promise<InitialSaveFolderResolution> {
  let fallbackFrom: SaveFolderSource | undefined;

  for (const candidate of initialSaveFolderCandidates(settings)) {
    try {
      const result = await validateDirectory(candidate.path, requiredBytes);
      if (result.valid) return { path: candidate.path, fallbackFrom };
    } catch {
      // Treat a transient validation error like an unavailable configured folder.
    }
    fallbackFrom ??= candidate.source;
  }

  return { fallbackFrom };
}
