
import { GoogleGenAI, GenerateContentResponse, Part } from "@google/genai";
import { AiResponsePayload, ThinkingLevel } from "../types";

const createGoogleAIClient = (apiKey: string, customApiEndpoint?: string, signal?: AbortSignal): GoogleGenAI => {
  const clientOptions: any = { apiKey };
  if ((customApiEndpoint && customApiEndpoint.trim() !== '') || signal) {
    clientOptions.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const fetchInit = { ...init, signal: signal || init?.signal };
      try {
        const sdkUrl = new URL(url.toString());
        const sdkPathAndQuery = sdkUrl.pathname + sdkUrl.search + sdkUrl.hash;
        let basePath = customApiEndpoint?.trim();
        if (basePath) {
            if (basePath.endsWith('/')) basePath = basePath.slice(0, -1);
            const versionMatch = sdkUrl.pathname.match(/^\/(v1beta|v1)\b/);
            if (versionMatch && basePath.endsWith(`/${versionMatch[1]}`)) {
                 basePath = basePath.slice(0, - (`/${versionMatch[1]}`).length);
            }
            return fetch(basePath + sdkPathAndQuery, fetchInit);
        }
        return fetch(url, fetchInit);
      } catch (e) {
        return fetch(url, fetchInit);
      }
    };
  }
  return new GoogleGenAI(clientOptions);
};

export const generateResponse = async (
  prompt: string,
  modelName: string,
  useCustomConfig: boolean,
  customApiKey?: string,
  customApiEndpoint?: string,
  systemInstruction?: string,
  imagePart?: { inlineData: { mimeType: string; data: string } },
  thinkingConfig?: { thinkingBudget?: number, thinkingLevel?: ThinkingLevel },
  signal?: AbortSignal,
  onStream?: (chunk: { text?: string; thoughts?: string }) => void
): Promise<AiResponsePayload> => {
  const startTime = performance.now();
  try {
    let apiKeyToUse = useCustomConfig ? customApiKey?.trim() : process.env.API_KEY;
    if (!apiKeyToUse) {
      return { text: "API密钥未配置。", durationMs: 0, error: "API key not configured" };
    }
    
    const genAI = createGoogleAIClient(apiKeyToUse, customApiEndpoint, signal);
    const config: any = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (thinkingConfig) config.thinkingConfig = thinkingConfig;

    const parts: Part[] = [];
    if (imagePart) parts.push(imagePart);
    parts.push({ text: prompt });

    const stream = await genAI.models.generateContentStream({
      model: modelName,
      contents: { parts },
      config,
    });

    let fullText = '';
    let fullThoughts = '';

    for await (const chunk of stream) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      
      let chunkText = '';
      let chunkThoughts = '';
      
      if (chunk.candidates?.[0]?.content?.parts) {
        for (const part of chunk.candidates[0].content.parts) {
          if ((part as any).thought) {
            chunkThoughts += part.text || '';
          } else {
            chunkText += part.text || '';
          }
        }
      }

      // Fallback if parts structure is unexpected but text property exists
      if (!chunkText && !chunkThoughts && chunk.text) {
        chunkText = chunk.text;
      }

      fullText += chunkText;
      fullThoughts += chunkThoughts;

      if (onStream) {
        onStream({ text: chunkText, thoughts: chunkThoughts });
      }
    }

    return { text: fullText, thoughts: fullThoughts || undefined, durationMs: performance.now() - startTime };
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('Aborted'))) {
       return { text: "用户取消操作", durationMs: performance.now() - startTime, error: "AbortError" };
    }
    const durationMs = performance.now() - startTime;
    return { text: error instanceof Error ? error.message : "未知错误", durationMs, error: "AI Error" };
  }
};
