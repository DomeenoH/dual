
import { AiResponsePayload } from "../types";

export const generateOpenAiResponse = async (
  prompt: string,
  modelId: string,
  apiKey: string,
  baseUrl: string,
  systemInstruction?: string,
  imagePart?: { mimeType: string; data: string },
  signal?: AbortSignal,
  onStream?: (chunk: { text?: string }) => void
): Promise<AiResponsePayload> => {
  const startTime = performance.now();
  const messages: any[] = [];

  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  
  const userContent: any[] = [{ type: 'text', text: prompt }];
  if (imagePart) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${imagePart.mimeType};base64,${imagePart.data}` },
    });
  }
  messages.push({ role: 'user', content: userContent });

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: messages,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { text: errorData.error?.message || response.statusText, durationMs: 0, error: "OpenAI Error" };
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    if (!reader) throw new Error("无法读取流响应");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        const message = line.replace(/^data: /, '');
        if (message === '[DONE]') break;
        
        try {
          const parsed = JSON.parse(message);
          const delta = parsed.choices[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            if (onStream) onStream({ text: delta });
          }
        } catch (e) {
          // Ignore incomplete JSON chunks
        }
      }
    }

    return { text: fullText, durationMs: performance.now() - startTime };
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError')) {
      return { text: "用户取消操作", durationMs: 0, error: "AbortError" };
    }
    return { text: error instanceof Error ? error.message : "未知错误", durationMs: 0, error: "OpenAI Error" };
  }
};
