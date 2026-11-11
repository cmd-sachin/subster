import { FunctionCallingConfigMode, type Content, type Part } from '@google/genai';
import { createFileRoute } from '@tanstack/react-router';
import type { AgAiConversationItem, AgAiOutputItem, AgLlmRequest, AgLlmResponse } from 'ag-studio';
import { fail, handle, json, type RouteContext } from '@/server/http';
import { describeLlmError, generate, llmAvailable, llmModel } from '@/server/llm';

// Gemini attaches a signature to each function call that it expects back when the conversation
// continues. Studio's conversation format has nowhere to carry it, so it is remembered here by
// call id for the life of the process.
const memory = globalThis as unknown as { __substerSignatures?: Map<string, string> };
const signatures = (memory.__substerSignatures ??= new Map<string, string>());

/** Studio's provider-neutral conversation -> Gemini contents (alternating roles, results grouped). */
function toContents(items: AgAiConversationItem[]): Content[] {
  const contents: Content[] = [];
  const names = new Map<string, string>();
  const push = (role: 'user' | 'model', part: Part) => {
    const last = contents.at(-1);
    if (last?.role === role) last.parts!.push(part);
    else contents.push({ role, parts: [part] });
  };

  for (const item of items) {
    if (item.type === 'message' && item.kind === 'input') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
      if (text) push('user', { text: item.role === 'system' ? `[Instruction from the application]\n${text}` : text });
    } else if (item.type === 'message') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : c.refusal)).join('');
      if (text) push('model', { text });
    } else if (item.type === 'function_call') {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(item.arguments || '{}');
      } catch {
        args = {};
      }
      names.set(item.callId, item.name);
      const thoughtSignature = signatures.get(item.callId);
      push('model', { functionCall: { id: item.callId, name: item.name, args }, ...(thoughtSignature && { thoughtSignature }) });
    } else if (item.type === 'function_call_output') {
      push('user', { functionResponse: { id: item.callId, name: names.get(item.callId) ?? 'tool', response: { result: item.output } } });
    }
    // Reasoning items are provider-specific and are not replayed.
  }
  if (contents[0]?.role !== 'user') contents.unshift({ role: 'user', parts: [{ text: 'Continue.' }] });
  return contents;
}

// One model turn for AG Studio's agent framework. The browser-side adapter (components/studio/ai.ts)
// posts Studio's request here; this is the only place the Gemini key is used for the dashboard.
async function POST({ request }: RouteContext) {
  if (!llmAvailable()) return fail(503, 'The assistant is not available right now.');
  const body = (await request.json().catch(() => null)) as AgLlmRequest | null;
  if (!body?.input) return fail(400, 'Invalid request');

  let system = body.instructions ?? '';
  const wantsJson = body.responseFormat?.type === 'json';
  if (wantsJson && body.responseFormat.type === 'json') {
    system += `\n\nRespond with a single JSON object and nothing else (no prose, no code fence). It must match this JSON Schema:\n${JSON.stringify(body.responseFormat.schema)}`;
  }

  const tools = body.toolChoice === 'none' ? [] : (body.tools ?? []);
  const forced = body.toolChoice === 'required' || typeof body.toolChoice === 'object';
  try {
    const response = await generate({
      contents: toContents(body.input),
      config: {
        systemInstruction: system || undefined,
        abortSignal: request.signal,
        ...(wantsJson && tools.length === 0 && { responseMimeType: 'application/json' }),
        ...(tools.length > 0 && {
          tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }],
          ...(forced && {
            toolConfig: {
              functionCallingConfig: {
                mode: FunctionCallingConfigMode.ANY,
                ...(typeof body.toolChoice === 'object' && { allowedFunctionNames: [body.toolChoice.name] }),
              },
            },
          }),
        }),
      },
    });

    const candidate = response.candidates?.[0];
    const id = response.responseId ?? `gem_${Date.now().toString(36)}`;
    const output: AgAiOutputItem[] = [];
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('');
    if (text) output.push({ id: `msg_${id}`, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text, annotations: [] }] });
    (candidate?.content?.parts ?? []).forEach((part, index) => {
      if (!part.functionCall?.name) return;
      const callId = part.functionCall.id ?? `call_${id}_${index}`;
      if (part.thoughtSignature) {
        signatures.set(callId, part.thoughtSignature);
        // Bounded: old conversations fall out first.
        if (signatures.size > 2000) signatures.delete(signatures.keys().next().value!);
      }
      output.push({ id: `fc_${callId}`, kind: 'output', type: 'function_call', callId, name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}), status: 'completed' });
    });

    const cutOff = candidate?.finishReason === 'MAX_TOKENS';
    const blocked = !candidate || (output.length === 0 && !cutOff);
    const result: AgLlmResponse = {
      id,
      createdAt: Date.now(),
      output,
      model: llmModel(),
      status: blocked ? 'failed' : cutOff ? 'incomplete' : 'completed',
      ...(cutOff && { incompleteDetails: { reason: 'max_output_tokens' as const } }),
      ...(blocked && { error: { code: String(candidate?.finishReason ?? 'empty'), message: 'The model returned no answer for this request.' } }),
      usage: { inputTokens: response.usageMetadata?.promptTokenCount ?? 0, outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0 },
    };
    return json(result);
  } catch (error) {
    return fail(502, describeLlmError(error));
  }
}

export const Route = createFileRoute('/api/studio-ai')({
  server: {
    handlers: {
      POST: handle('studio-ai', POST),
    },
  },
});
