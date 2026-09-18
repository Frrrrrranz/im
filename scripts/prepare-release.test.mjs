import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./prepare-release.mjs", import.meta.url));
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const mac = "im_universal.app.tar.gz";
const win = "im_x64-setup.exe";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "im-release-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of [mac, win]) {
    writeFileSync(join(directory, file), `bundle: ${file}`);
    writeFileSync(join(directory, `${file}.sig`), `signature: ${file}\n`);
  }
  return directory;
}

function prepare(directory, tag = `v${version}`) {
  return spawnSync(process.execPath, [script, directory], {
    encoding: "utf8",
    env: {
      ...process.env,
      RELEASE_TAG: tag,
      GITHUB_REPOSITORY: "yetlinghao/im",
    },
  });
}

test("one feed serves both Mac architectures and the Windows installer", (t) => {
  const directory = fixture(t);
  const result = prepare(directory);
  assert.equal(result.status, 0, result.stderr);
  const feed = JSON.parse(readFileSync(join(directory, "latest.json"), "utf8"));
  assert.equal(feed.version, version);
  assert.ok(Number.isFinite(Date.parse(feed.pub_date)));
  assert.deepEqual(Object.keys(feed.platforms).sort(), [
    "darwin-aarch64",
    "darwin-x86_64",
    "windows-x86_64",
  ]);
  for (const [target, file] of [
    ["darwin-aarch64", mac],
    ["darwin-x86_64", mac],
    ["windows-x86_64", win],
  ]) {
    assert.equal(
      feed.platforms[target].url,
      `https://github.com/yetlinghao/im/releases/download/v${version}/${file}`,
    );
    assert.equal(feed.platforms[target].signature, `signature: ${file}`);
    const hash = createHash("sha256")
      .update(readFileSync(join(directory, file)))
      .digest("hex");
    assert.equal(
      readFileSync(join(directory, `${file}.sha256`), "utf8"),
      `${hash}  ${file}\n`,
    );
  }
});

for (const file of [mac, win, `${mac}.sig`, `${win}.sig`]) {
  test(`missing ${file} prevents publishing a partial feed`, (t) => {
    const directory = fixture(t);
    rmSync(join(directory, file));
    const result = prepare(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ENOENT/);
    assert.equal(existsSync(join(directory, "latest.json")), false);
    assert.equal(existsSync(join(directory, `${mac}.sha256`)), false);
  });
}

test("an empty signing output is rejected", (t) => {
  const directory = fixture(t);
  writeFileSync(join(directory, `${win}.sig`), "\n");
  const result = prepare(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Empty bundle or signature/);
  assert.equal(existsSync(join(directory, "latest.json")), false);
});

test("a tag that differs from the built version is rejected", (t) => {
  const directory = fixture(t);
  const result = prepare(directory, "v9999.0.0");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release tag and app versions must match/);
  assert.equal(existsSync(join(directory, "latest.json")), false);
});
