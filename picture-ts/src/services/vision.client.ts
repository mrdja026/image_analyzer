import { setTimeout as setTimeoutPromise } from 'timers/promises';

export type VisionProvider = 'ollama' | 'llamacpp';

export interface VisionClientOptions {
    baseUrl: string;
    model: string;
    provider: VisionProvider;
    system?: string;
    // Intentionally omit temperature for vision requests per project rules
    maxTokens?: number;
    timeoutMs?: number;
}

/**
 * Send a single vision chat request with one image and a user prompt.
 * Returns the assistant text.
 */
export async function visionChat(
    imgDataUri: string,
    userPrompt: string,
    opts: VisionClientOptions
): Promise<string> {
    const { baseUrl, model, provider, system, maxTokens, timeoutMs = 120_000 } = opts;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    function clear() {
        clearTimeout(timeout);
    }

    try {
        if (provider === 'ollama') {
            // Use the same path as text model: /api/generate with prompt+images; no temperature included.
            const rawB64 = imgDataUri.startsWith('data:') ? imgDataUri.split(',', 2)[1] ?? '' : imgDataUri;
            const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    model,
                    prompt: userPrompt,
                    images: [rawB64],
                    stream: false,
                    options: {
                        ...(maxTokens ? { num_predict: maxTokens } : {}),
                    },
                }),
            });
            if (!res.ok) throw new Error(`Ollama chat failed: ${res.status}`);
            const j: any = await res.json();
            return j?.response ?? '';
        } else {
            // llama.cpp OpenAI-compatible /chat/completions; omit temperature.
            const messages = system
                ? [
                    { role: 'system', content: system },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: userPrompt },
                            { type: 'image_url', image_url: imgDataUri },
                        ],
                    },
                ]
                : [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: userPrompt },
                            { type: 'image_url', image_url: imgDataUri },
                        ],
                    },
                ];

            const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    model,
                    ...(maxTokens ? { max_tokens: maxTokens } : {}),
                    messages,
                }),
            });
            if (!res.ok) throw new Error(`llama.cpp chat failed: ${res.status}`);
            const j: any = await res.json();
            return j?.choices?.[0]?.message?.content ?? '';
        }
    } finally {
        clear();
    }
}


