import { GoogleSheetsFinanceDigestRepository } from "../../integrations/google-sheets/finance-digest.repository.js";
import { env } from "../../config/env.js";
import { formatFinanceDigest } from "../../usecases/finance-digest/format-finance-digest.js";
import { getFinanceDigest } from "../../usecases/finance-digest/get-finance-digest.js";
import type { TaskHandler } from "../../task-router/task-handler.js";
import { handledTaskResult } from "../../task-router/task-handler.js";

export const financeDigestHandler: TaskHandler = {
  name: "finance-digest",
  canHandle(trigger) {
    return trigger.kind === "finance-digest";
  },
  async handle(_input, trigger, logger) {
    if (trigger.kind !== "finance-digest") {
      return handledTaskResult({ suppressReason: "finance_digest_unmatched" });
    }

    const digest = await getFinanceDigest(new GoogleSheetsFinanceDigestRepository(), {
      timezone: env.FINANCE_DIGEST_TIMEZONE,
      lookaheadDays: env.FINANCE_DIGEST_LOOKAHEAD_DAYS
    });
    logger?.log("finance_digest.complete", {
      weeklyMethods: digest.weeklySpend.length,
      upcomingPayments: digest.upcomingPayments.length,
      warnings: digest.warnings.length,
      partial: digest.partial,
      unavailable: digest.unavailable
    });

    return handledTaskResult({
      suppressReason: trigger.source,
      messages: [formatFinanceDigest(digest)]
    });
  }
};
