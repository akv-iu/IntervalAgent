import { z } from "zod";
import { MessageStep } from "./mock-agents";
import { RoleTask } from "./role-tasks";

export const ModelStepSpec = z.strictObject({
  step: MessageStep, model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/), input: z.string().min(1).max(8000), task: RoleTask.optional(),
});
export const ModelRequest = z.strictObject({ model: ModelStepSpec.shape.model, system: z.string().min(1).max(6000), input: ModelStepSpec.shape.input, maxOutputTokens: z.literal(600), task: RoleTask.optional() });
export const ModelRequests = z.array(ModelRequest).length(2);
export const ModelUsage = z.strictObject({ input: z.number().int().min(0).max(1000000), output: z.number().int().min(0).max(1000000) }).nullable();
export function modelInputCapacity(requests: z.infer<typeof ModelRequests>) {
  const capacity = Math.max(...requests.map((r) => Buffer.byteLength(JSON.stringify(r),"utf8")))+128;
  if (capacity>23400) throw new Error("model input exceeds run capacity");
  return capacity;
}
