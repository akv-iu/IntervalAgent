export interface LlmMessage {
  role: "agent" | "customer";
  text: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  // Used for recording keys only. Never sent to the model.
  context: { subject: string; version: "baseline" | "guarded"; turn: number; attempt: number };
}

export interface LlmResponse {
  text: string;
  usage?: { input: number; output: number };
}

export interface LlmProvider {
  name: "openai" | "mock" | "mock-bad" | "replay";
  model: string;
  params: Record<string, number>;
  complete(req: LlmRequest): Promise<LlmResponse>;
  // Set by the recording and replay wrappers so artifacts carry their provenance.
  recordingSetId?: string;
  originalSourceMode?: "live" | "mock";
}
