// The Studio assistant. An adapter sends each model turn to /api/studio-ai, where the server
// calls Gemini with its own key, so nothing secret reaches the browser. On top of Studio's
// built-in agents (data, widget, page, planning) sits a custom lead agent that knows what the
// subscription metrics mean and delegates the dashboard work to the built-ins.

import {
  createAiHarness,
  directLlmRunner,
  type AgAiEvent,
  type AgAiHarnessSetup,
  type AgAiOutputItem,
  type AgAiPromptStarter,
  type AgLlmAdapter,
  type AgLlmResponse,
  type AgStudioApi,
} from 'ag-studio';

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: 'Worst value for money', prompt: 'Which subscriptions cost me the most relative to how much I use them? Show it as a chart.' },
  { label: 'Spend over $10, used under 5h', prompt: 'Add a table of subscriptions costing more than $10 a month that I used for less than 5 hours in the last 30 days.' },
  { label: 'Explain this page', prompt: 'Summarise what this page shows and what stands out.' },
];

const ADVISOR_INSTRUCTIONS = `You are the Subster analytics advisor inside a dashboard about one person's subscriptions.

What the data means:
- subscriptions.valueScore is 0 to 100; higher means better value for money. Below 40 is low value; 0 with zero hours is unused.
- subscriptions.costPerHour is monthly cost divided by hours of use in the last 30 days. Usage is phone screen time, so TV or console use is not counted.
- subscriptions.savings is what the recommended action would save per month.
- Verdicts "Essential" and "Not measured" have no usage-based score: do not rank them as poor value.

Answer questions about the user's subscriptions directly and briefly, using real numbers from queries. When the user wants something built or changed on the dashboard, delegate to the specialist agents instead of describing how. Amounts are USD. Do not use emojis.`;

/** Runs one turn on the server and replays the result to Studio as protocol events. */
function modelAdapter(endpoint: string): AgLlmAdapter {
  return {
    executeTurn(request, options) {
      const complete: Promise<AgLlmResponse> = fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: options?.signal,
      }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return { id: `err_${Date.now()}`, createdAt: Date.now(), status: 'failed', output: [], error: { code: String(res.status), message: data.error ?? 'The assistant request failed.' } };
        }
        return data as AgLlmResponse;
      });

      async function* events(): AsyncGenerator<AgAiEvent> {
        const response = await complete;
        for (const item of response.output as AgAiOutputItem[]) {
          if (item.type === 'message') {
            yield { type: 'TEXT_MESSAGE_START', messageId: item.id, role: 'assistant' };
            for (const part of item.content) if (part.type === 'text') yield { type: 'TEXT_MESSAGE_CONTENT', messageId: item.id, delta: part.text };
            yield { type: 'TEXT_MESSAGE_END', messageId: item.id };
          } else if (item.type === 'function_call') {
            yield { type: 'TOOL_CALL_START', toolCallId: item.callId, toolCallName: item.name };
            yield { type: 'TOOL_CALL_ARGS', toolCallId: item.callId, delta: item.arguments };
            yield { type: 'TOOL_CALL_END', toolCallId: item.callId };
          }
        }
      }
      return { stream: events(), complete };
    },
  };
}

export function buildAi(): AgAiHarnessSetup {
  const adapter = modelAdapter('/api/studio-ai');
  return ({ api }) =>
    createAiHarness(api as AgStudioApi, ({ tools, builtIn }) => {
      const specialists = (['data', 'widget', 'page', 'planning'] as const).map((id) => directLlmRunner({ ...builtIn[id], adapter }));
      const advisor = directLlmRunner({
        id: 'subster-advisor',
        name: 'Subster advisor',
        description: 'Understands subscription value metrics and coordinates the dashboard specialists.',
        adapter,
        instructions: () => ADVISOR_INSTRUCTIONS,
        tools: () => [tools.studio.viewSchema(), tools.studio.viewPage(), tools.studio.executeQuery(), tools.delegateTo(specialists.map((s) => s.id))],
      });
      return { agents: [advisor, ...specialists], primary: advisor.id, promptStarters: PROMPT_STARTERS };
    });
}
