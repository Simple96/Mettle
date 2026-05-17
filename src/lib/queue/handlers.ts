import "server-only";

import type { Job, JobType } from "./types";

type Handler<T extends JobType> = (payload: Job<T>["payload"]) => Promise<void>;

export const handlers: { [K in JobType]: Handler<K> } = {
  close_task: async ({ taskId }) => {
    // TODO Phase 1 week 3: mark task as 'judging', enqueue judging logic
    console.log(`[close_task] ${taskId} (not yet implemented)`);
  },

  grade_submission: async ({ submissionId }) => {
    // TODO Phase 1 week 3: download artifact + run E2B sandbox + write auto_score
    console.log(`[grade_submission] ${submissionId} (not yet implemented)`);
  },

  request_human_grading: async ({ taskId }) => {
    // TODO Phase 1 week 3: email publisher with link to scoring UI
    console.log(`[request_human_grading] ${taskId} (not yet implemented)`);
  },

  settle_task: async ({ taskId }) => {
    // TODO Phase 1 week 4: Stripe transfers + write verdicts + update ELO
    console.log(`[settle_task] ${taskId} (not yet implemented)`);
  },

  send_webhook: async ({ url, event, body }) => {
    // TODO Phase 2 week 6: HMAC-sign body, POST to operator URL, surface errors
    console.log(`[send_webhook] ${event} -> ${url} (not yet implemented)`);
  },
};
