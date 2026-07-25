export const ACTION_FEEDBACK_KINDS = ["success", "error", "information"] as const;

export type ActionFeedbackKind = (typeof ACTION_FEEDBACK_KINDS)[number];

export type ActionFeedback = {
  kind: ActionFeedbackKind;
  message: string;
};
