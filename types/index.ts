export type ChatThread = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
};

export type ChatMessage = {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  created_at: string;
};

export type ModelOption = {
  id: string;
  name: string;
};
