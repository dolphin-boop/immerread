import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("public release metadata is complete and consistent", async () => {
  const [readme, license, privacy, security, workflow, packageText, manifestText] = await Promise.all([
    read("README.md"),
    read("LICENSE"),
    read("PRIVACY.md"),
    read("SECURITY.md"),
    read(".github/workflows/ci.yml"),
    read("package.json"),
    read("manifest.json")
  ]);
  const packageJson = JSON.parse(packageText);
  const manifest = JSON.parse(manifestText);

  assert.match(readme, /^# 译读 ImmerRead/m);
  assert.match(readme, /\*\*中文\*\* \| \[English\]\(#english\)/);
  assert.match(readme, /demo\/article-translator\/[\w-]+\.(png|jpe?g)/);
  assert.match(readme, /github\.com\/dolphin-boop\/immerread/);
  assert.doesNotMatch(readme, /github\.com\/dolphin-boop\/yidu/);
  assert.doesNotMatch(readme, /github\.com\/joeseesun\//);
  assert.doesNotMatch(readme, /向阳乔木|qiaomu|vista8|joeseesun/i);
  assert.match(readme, /PRIVACY\.md/);
  assert.match(readme, /SECURITY\.md/);
  assert.match(readme, /npm test/);
  assert.doesNotMatch(readme, /TODO|TBD|PLACEHOLDER/i);

  assert.match(license, /^MIT License/);
  assert.match(privacy, /DeepSeek/);
  assert.match(security, /Private Vulnerability Reporting/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run check/);
  assert.equal(packageJson.name, "yidu");
  assert.equal(packageJson.version, manifest.version);
});
