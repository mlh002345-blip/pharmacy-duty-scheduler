import { createHash } from "node:crypto";
import { createReadStream, writeFileSync } from "node:fs";

export type BackupManifest = {
  sourceIdentifier: string;
  dumpStartedAt: string;
  dumpFinishedAt: string;
  postgresVersion: string;
  format: "custom";
  fileSizeBytes: number;
  sha256: string;
};

/** Streams the file so large dumps never need to be fully loaded into memory just to checksum them. */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export function writeManifest(dumpFilePath: string, manifest: BackupManifest): string {
  const manifestPath = `${dumpFilePath}.manifest.json`;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  return manifestPath;
}

export function writeChecksumFile(dumpFilePath: string, sha256: string): string {
  const checksumPath = `${dumpFilePath}.sha256`;
  const fileName = dumpFilePath.split("/").pop();
  writeFileSync(checksumPath, `${sha256}  ${fileName}\n`, "utf-8");
  return checksumPath;
}
