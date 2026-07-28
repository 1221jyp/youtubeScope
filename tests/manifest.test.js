// 파일을 기능별로 쪼개면서 생기는 가장 흔한 사고(경로 오타, 로드 순서 누락)를 막는다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

function assertExists(file, where) {
  assert.ok(fs.existsSync(file), `${where}가 가리키는 ${file}이 존재하지 않습니다.`);
}

function run() {
  // 1. manifest가 참조하는 모든 파일이 실제로 있어야 한다.
  assertExists(manifest.background.service_worker, "background.service_worker");
  assertExists(manifest.action.default_popup, "action.default_popup");
  assertExists(manifest.options_page, "options_page");
  for (const entry of manifest.content_scripts) {
    for (const file of entry.js || []) assertExists(file, "content_scripts.js");
    for (const file of entry.css || []) assertExists(file, "content_scripts.css");
  }

  // 2. HTML이 참조하는 스크립트도 실제로 있어야 한다.
  for (const page of [manifest.action.default_popup, manifest.options_page]) {
    const html = fs.readFileSync(page, "utf8");
    const dir = path.dirname(page);
    for (const match of html.matchAll(/<script src="([^"]+)"/g)) {
      assertExists(path.normalize(path.join(dir, match[1])), `${page}의 script`);
    }
  }

  // 3. service worker의 importScripts 목록이 실제 파일과 일치해야 한다.
  const workerSource = fs.readFileSync(manifest.background.service_worker, "utf8");
  const importBlock = workerSource.match(/importScripts\(([\s\S]*?)\)/);
  assert.ok(importBlock, "service worker에 importScripts 호출이 없습니다.");
  const imported = [...importBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/^\//, ""));
  assert.ok(imported.length > 0, "importScripts 목록이 비어 있습니다.");
  for (const file of imported) assertExists(file, "importScripts");

  // 4. 각 모듈은 globalThis.JJG_* 네임스페이스를 정확히 하나 등록한다.
  //    (번들러가 없어서 전역 네임스페이스가 모듈 시스템 역할을 한다)
  const moduleFiles = [
    ...imported,
    ...manifest.content_scripts.flatMap((entry) => entry.js || []),
  ].filter((file) => !file.endsWith("main.js") && !file.endsWith("history-hook.js"));

  const registered = new Set();
  for (const file of new Set(moduleFiles)) {
    const source = fs.readFileSync(file, "utf8");
    const names = [...source.matchAll(/^\s*root\.(JJG_\w+)\s*=/gm)].map((m) => m[1]);
    assert.equal(names.length, 1, `${file}은 JJG_* 네임스페이스를 정확히 하나 등록해야 합니다.`);
    assert.ok(!registered.has(names[0]), `${names[0]} 네임스페이스가 중복 등록되었습니다.`);
    registered.add(names[0]);
  }

  // 5. content script는 의존하는 모듈보다 먼저 로드될 수 없다.
  const contentFiles = manifest.content_scripts.at(-1).js;
  const loadedSoFar = new Set();
  for (const file of contentFiles) {
    const source = fs.readFileSync(file, "utf8");
    // 최상위에서 구조 분해하는 참조만 검사한다 (함수 안의 root.JJG_*는 호출 시점에 해석됨).
    for (const match of source.matchAll(/=\s*root\.(JJG_\w+);/g)) {
      assert.ok(
        loadedSoFar.has(match[1]),
        `${file}이 아직 로드되지 않은 ${match[1]}을 최상위에서 참조합니다. manifest 순서를 확인하세요.`
      );
    }
    for (const match of source.matchAll(/^\s*root\.(JJG_\w+)\s*=/gm)) loadedSoFar.add(match[1]);
  }

  console.log(`manifest/모듈 로드 시나리오 5개 통과 (모듈 ${registered.size}개)`);
}

run();
