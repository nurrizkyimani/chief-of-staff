import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { env } from "../../config/env.js";
import { commitMemoryVaultFile, type MemoryVaultGitResult } from "../../integrations/memory/git-memory-vault.js";
import { applyWishlistCommand, parseWishlistCommand } from "./wishlist-markdown.js";

export type WishlistAssistantInput = {
  text: string;
  sourcePlatform: string;
  chatId: string;
};

export type WishlistAssistantResult = {
  messages: string[];
};

export async function processWishlistAssistant(input: WishlistAssistantInput): Promise<WishlistAssistantResult> {
  if (!isAllowedWishlistGroup(input.sourcePlatform, input.chatId)) {
    return { messages: [] };
  }

  const command = parseWishlistCommand(input.text);
  if (!command) {
    return { messages: ["Wishlist command not recognized. Use show, add, done, or undone."] };
  }

  const wishlistPath = resolveWishlistFilePath();
  if (!wishlistPath) {
    return {
      messages: [
        "Wishlist storage is not configured. Set OPENCLAW_MEMORY_VAULT_PATH or WISHLIST_FILE_PATH."
      ]
    };
  }

  const current = await readTextIfExists(wishlistPath);
  const result = applyWishlistCommand(current, command);

  if (result.status !== "changed") {
    return { messages: [result.message] };
  }

  await mkdir(dirname(wishlistPath), { recursive: true });
  await writeFile(wishlistPath, result.content, "utf8");

  let gitResult: MemoryVaultGitResult;
  try {
    gitResult = await commitMemoryVaultFile(wishlistPath, result.commitMessage);
  } catch (error) {
    return {
      messages: [`${result.message}\nGit: commit failed (${formatErrorMessage(error)}).`]
    };
  }

  return {
    messages: [formatSavedMessage(result.message, gitResult)]
  };
}

function isAllowedWishlistGroup(sourcePlatform: string, chatId: string): boolean {
  if (sourcePlatform !== "whatsapp") return false;
  const allowedGroups = env.WISHLIST_ALLOWED_GROUPS.split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return allowedGroups.includes(chatId);
}

function resolveWishlistFilePath(): string | null {
  if (env.WISHLIST_FILE_PATH) return env.WISHLIST_FILE_PATH;
  if (!env.OPENCLAW_MEMORY_VAULT_PATH) return null;
  return join(env.OPENCLAW_MEMORY_VAULT_PATH, "memory", "wishlists", "backlog-wishlist.md");
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return "";
    throw error;
  }
}

function formatSavedMessage(message: string, gitResult: MemoryVaultGitResult): string {
  if (gitResult.status === "committed") {
    return `${message}\nGit: committed${gitResult.pushed ? " and pushed" : ""}.`;
  }

  const reason =
    gitResult.reason === "disabled"
      ? "auto-commit disabled"
      : gitResult.reason === "missing_vault_path"
        ? "vault path missing"
        : gitResult.reason === "outside_vault"
          ? "file outside vault"
          : "no changes";
  return `${message}\nGit: skipped (${reason}).`;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.split("\n")[0] ?? error.message;
  return String(error);
}
