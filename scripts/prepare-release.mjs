// Assemble one updater feed after both platform builds have finished.
// RELEASE_TAG=vX.Y.Z GITHUB_REPOSITORY=owner/repo node scripts/prepare-release.mjs build/release
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const readRepoFile = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const version = JSON.parse(readRepoFile("src-tauri/tauri.conf.json")).version;
const packageVersion = JSON.parse(readRepoFile("package.json")).version;
const cargoVersion = readRepoFile("src-tauri/Cargo.toml").match(
  /^version\s*=\s*"([^"]+)"/m,
)?.[1];
const tag = process.env.RELEASE_TAG;
if (
  tag !== `v${version}` ||
  packageVersion !== version ||
  cargoVersion !== version
)
  throw new Error(
    `Release tag and app versions must match: tag=${tag}, Tauri=${version}, npm=${packageVersion}, Cargo=${cargoVersion}`,
  );

const repository = process.env.GITHUB_REPOSITORY;
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository))
  throw new Error("GITHUB_REPOSITORY must be owner/repo");

const directory = process.argv[2] ?? "build/release";
const bundles = [
  {
    file: "im_universal.app.tar.gz",
    targets: ["darwin-aarch64", "darwin-x86_64"],
  },
  { file: "im_x64-setup.exe", targets: ["windows-x86_64"] },
];
const platforms = {};
const checksums = [];
for (const { file, targets } of bundles) {
  const bytes = readFileSync(join(directory, file));
  const signature = readFileSync(join(directory, `${file}.sig`), "utf8").trim();
  if (!bytes.length || !signature)
    throw new Error(`Empty bundle or signature: ${file}`);
  const asset = {
    url: `https://github.com/${repository}/releases/download/${tag}/${file}`,
    signature,
  };
  for (const target of targets) platforms[target] = asset;
  checksums.push({
    file,
    hash: createHash("sha256").update(bytes).digest("hex"),
  });
}

// Validate every input before writing anything that could be published.
for (const { file, hash } of checksums)
  writeFileSync(join(directory, `${file}.sha256`), `${hash}  ${file}\n`);
writeFileSync(
  join(directory, "latest.json"),
  `${JSON.stringify(
    {
      version,
      notes: readRepoFile(".github/release-notes.md").trim(),
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  )}\n`,
);
console.log(`Prepared ${tag}: ${Object.keys(platforms).join(", ")}`);
