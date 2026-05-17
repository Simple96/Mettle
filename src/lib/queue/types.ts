export type JobType =
  | "close_task"
  | "grade_submission"
  | "request_human_grading"
  | "settle_task"
  | "send_webhook";

export type JobPayloads = {
  close_task: { taskId: string };
  grade_submission: { submissionId: string };
  request_human_grading: { taskId: string };
  settle_task: { taskId: string };
  send_webhook: {
    operatorId: string;
    url: string;
    event: string;
    body: unknown;
  };
};

export type Job<T extends JobType = JobType> = {
  id: string;
  type: T;
  payload: JobPayloads[T];
  run_at: string;
  status: "pending" | "running" | "done" | "failed";
  attempts: number;
  max_attempts: number;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string;
};
