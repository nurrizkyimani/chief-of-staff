import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { applyWishlistCommand, parseWishlistCommand } from "../usecases/wishlist-assistant/wishlist-markdown.js";
import { detectTaskTrigger } from "../task-router/task-trigger.detector.js";

const execFileAsync = promisify(execFile);

function changed(content: string, text: string): string {
  const command = parseWishlistCommand(text);
  assert(command, `Expected command for ${text}`);
  const result = applyWishlistCommand(content, command);
  assert.equal(result.status, "changed");
  return result.content;
}

{
  assert.deepEqual(parseWishlistCommand("show ykc"), { kind: "show", board: "ykc" });
  assert.deepEqual(parseWishlistCommand("show ykc wish"), { kind: "show", board: "ykc" });
  assert.deepEqual(parseWishlistCommand("show ykc-wishlist"), { kind: "show", board: "ykc" });
  assert.deepEqual(parseWishlistCommand("show jkt june"), { kind: "show", board: "jkt", section: "JUNE" });
  assert.deepEqual(parseWishlistCommand("add ykc local food: rumah makan godean, godean"), {
    kind: "add",
    board: "ykc",
    section: "LOCAL FOOD",
    item: "rumah makan godean, godean"
  });
  assert.deepEqual(parseWishlistCommand("add jkt june w2: rumah makan godean"), {
    kind: "add",
    board: "jkt",
    section: "JUNE",
    item: "W2 - rumah makan godean"
  });
  assert.deepEqual(parseWishlistCommand("done ykc rumah makan godean"), {
    kind: "done",
    board: "ykc",
    query: "rumah makan godean"
  });
  assert.equal(parseWishlistCommand("done rumah makan godean"), null);
}

{
  const command = parseWishlistCommand(`YKC WISHLIST

ACTIVITY
bookstore`);
  assert.deepEqual(command, {
    kind: "import",
    board: "ykc",
    content: "YKC WISHLIST\n\nACTIVITY\nbookstore"
  });
}

{
  const next = changed("# YKC WISHLIST\n\n## LOCAL FOOD\nKlathak bari\n", "add ykc local food: rumah makan godean, godean");
  assert.match(next, /## LOCAL FOOD\nKlathak bari\nrumah makan godean, godean/);
}

{
  const next = changed("", "add ykc local food: rumah makan godean, godean");
  assert.match(next, /^# YKC WISHLIST\n\n## LOCAL FOOD\nrumah makan godean, godean\n$/);
}

{
  const next = changed("# JKT WISHLIST\n\n### JUNE\nW1 - dijan\n", "add jkt june w2: rumah makan godean");
  assert.match(next, /### JUNE\nW1 - dijan\nW2 - rumah makan godean/);
}

{
  const next = changed("# YKC WISHLIST\n\n## LOCAL FOOD\nrumah makan godean, godean\n", "done ykc rumah makan godean");
  assert.match(next, /DN rumah makan godean, godean/);
  const pending = changed(next, "undone ykc rumah makan godean");
  assert.match(pending, /## LOCAL FOOD\nrumah makan godean, godean/);
}

{
  const command = parseWishlistCommand("done ykc rumah makan")!;
  const result = applyWishlistCommand(
    "# YKC WISHLIST\n\n## LOCAL FOOD\nrumah makan godean\nrumah makan kaliurang\n",
    command
  );
  assert.equal(result.status, "ambiguous");
}

{
  const command = parseWishlistCommand(`!!! JKT WISHLIST !!!

2025 BACKLOG
DONE, roi et, pondok indah
bakmi anything, jakbar, jaksel
bakmi anything, jakbar, jaksel`)!;
  const result = applyWishlistCommand("# JKT WISHLIST\n\n## 2025 BACKLOG\n", command);
  assert.equal(result.status, "changed");
  assert.match(result.content, /DN roi et, pondok indah/);
  assert.equal((result.content.match(/bakmi anything/g) ?? []).length, 1);
}

{
  const trigger = detectTaskTrigger("show ykc", false);
  assert.equal(trigger.kind, "wishlist-assistant");
  assert.deepEqual(detectTaskTrigger("done lunch", false), { kind: "unhandled" });
}

{
  const vault = await mkdtemp(join(tmpdir(), "wishlist-git-"));
  await execFileAsync("git", ["init"], { cwd: vault });
  await execFileAsync("git", ["config", "user.email", "wishlist-test@example.test"], { cwd: vault });
  await execFileAsync("git", ["config", "user.name", "Wishlist Test"], { cwd: vault });

  const wishlistPath = join(vault, "memory", "wishlists", "backlog-wishlist.md");
  const unrelatedPath = join(vault, "memory", "daily", "note.md");
  await mkdir(join(vault, "memory", "wishlists"), { recursive: true });
  await mkdir(join(vault, "memory", "daily"), { recursive: true });
  await writeFile(wishlistPath, "# YKC WISHLIST\n", "utf8");
  await writeFile(unrelatedPath, "unrelated\n", "utf8");
  await execFileAsync("git", ["add", "--", "memory/daily/note.md"], { cwd: vault });

  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-google-credentials.json";
  process.env.RECEIPT_SPREADSHEET_ID = "fake-sheet-id";
  process.env.RECEIPT_JOURNAL_PATH = join(vault, "memory", "receipts", "receipt-journal.md");
  process.env.OPENCLAW_MEMORY_VAULT_PATH = vault;
  process.env.OPENCLAW_MEMORY_GIT_AUTO_COMMIT = "true";
  process.env.OPENCLAW_MEMORY_GIT_AUTO_PUSH = "false";

  const { commitMemoryVaultFile } = await import("../integrations/memory/git-memory-vault.js");
  const result = await commitMemoryVaultFile(wishlistPath, "wishlist: test path-specific commit");
  assert.equal(result.status, "committed");

  const committedFiles = await execFileAsync("git", ["show", "--name-only", "--pretty=format:", "HEAD"], { cwd: vault });
  assert.match(committedFiles.stdout, /memory\/wishlists\/backlog-wishlist\.md/);
  assert.doesNotMatch(committedFiles.stdout, /memory\/daily\/note\.md/);

  const stagedFiles = await execFileAsync("git", ["diff", "--cached", "--name-only"], { cwd: vault });
  assert.match(stagedFiles.stdout, /memory\/daily\/note\.md/);
}

console.log("wishlist assistant tests passed");
