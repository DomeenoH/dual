
import { useCallback } from 'react';
import { MessageSender, MessagePurpose, ThinkingLevel, ChatMessage } from '../types';
import { generateResponse as generateGeminiResponse } from '../services/geminiService';
import { generateOpenAiResponse } from '../services/openaiService';
import {
  AiModel,
  MAX_AUTO_RETRIES,
  RETRY_DELAY_BASE_MS,
  GEMINI_3_PRO_MODEL_ID
} from '../constants';
import { parseAIResponse, ParsedAIResponse } from '../utils/appUtils';
import { useChatState } from './useChatState';

interface UseStepExecutorProps {
  state: ReturnType<typeof useChatState>;
  addMessage: (text: string, sender: MessageSender, purpose: MessagePurpose, durationMs?: number, image?: any, thoughts?: string) => string;
  updateMessage: (id: string, updates: Partial<Pick<ChatMessage, 'text' | 'thoughts' | 'durationMs'>>) => void;
  setGlobalApiKeyStatus: (status: { isMissing?: boolean, isInvalid?: boolean, message?: string }) => void;
  cognitoSystemPrompt: string;
  museSystemPrompt: string;
  useCustomApiConfig: boolean;
  customApiKey: string;
  customApiEndpoint: string;
  useOpenAiApiConfig: boolean;
  openAiApiKey: string;
  openAiApiBaseUrl: string;
  cognitoThinkingBudget: number;
  cognitoThinkingLevel: ThinkingLevel;
  museThinkingBudget: number;
  museThinkingLevel: ThinkingLevel;
}

export const useStepExecutor = ({
  state,
  addMessage,
  updateMessage,
  setGlobalApiKeyStatus,
  cognitoSystemPrompt,
  museSystemPrompt,
  useCustomApiConfig,
  customApiKey,
  customApiEndpoint,
  useOpenAiApiConfig,
  openAiApiKey,
  openAiApiBaseUrl,
  cognitoThinkingBudget,
  cognitoThinkingLevel,
  museThinkingBudget,
  museThinkingLevel,
}: UseStepExecutorProps) => {

  const getThinkingConfigForGeminiModel = useCallback((
    modelDetails: AiModel,
    budget: number,
    level: ThinkingLevel
  ): { thinkingBudget?: number, thinkingLevel?: ThinkingLevel } | undefined => {
    if (!useOpenAiApiConfig && modelDetails.supportsThinkingConfig) {
      if (budget === 0) return undefined;
      if (budget === -1) {
          if (modelDetails.apiName === GEMINI_3_PRO_MODEL_ID) return { thinkingLevel: level };
          return { thinkingBudget: 1024 }; 
      }
      return { thinkingBudget: budget };
    }
    return undefined;
  }, [useOpenAiApiConfig]);

  const executeStep = useCallback(async (
    stepIdentifier: string,
    prompt: string,
    modelDetailsForStep: AiModel,
    senderForStep: MessageSender,
    purposeForStep: MessagePurpose,
    imageApiPartForStep?: { inlineData: { mimeType: string; data: string } },
    userInputForFlowContext?: string,
    imageApiPartForFlowContext?: { inlineData: { mimeType: string; data: string } },
    discussionLogBeforeFailureContext?: string[],
    currentTurnIndexForResumeContext?: number,
    previousAISignaledStopForResumeContext?: boolean
  ): Promise<ParsedAIResponse> => {
    let stepSuccess = false;
    let parsedResponse: ParsedAIResponse | null = null;
    let autoRetryCount = 0;

    const systemInstructionToUse = senderForStep === MessageSender.Cognito ? cognitoSystemPrompt : museSystemPrompt;
    const specificThinkingBudget = senderForStep === MessageSender.Cognito ? cognitoThinkingBudget : museThinkingBudget;
    const specificThinkingLevel = senderForStep === MessageSender.Cognito ? cognitoThinkingLevel : museThinkingLevel;
    const thinkingConfig = getThinkingConfigForGeminiModel(modelDetailsForStep, specificThinkingBudget, specificThinkingLevel);

    while (autoRetryCount <= MAX_AUTO_RETRIES && !stepSuccess) {
      if (state.cancelRequestRef.current) throw new Error("用户取消操作");
      
      // 创建占位消息
      const msgId = addMessage("", senderForStep, purposeForStep);
      let streamedText = "";
      let streamedThoughts = "";

      try {
        let result: { text: string; durationMs: number; error?: string; thoughts?: string };

        const streamHandler = (chunk: { text?: string; thoughts?: string }) => {
          if (chunk.text) streamedText += chunk.text;
          if (chunk.thoughts) streamedThoughts += chunk.thoughts;
          updateMessage(msgId, { text: streamedText, thoughts: streamedThoughts });
        };

        if (useOpenAiApiConfig) {
          result = await generateOpenAiResponse(
            prompt, modelDetailsForStep.apiName, openAiApiKey, openAiApiBaseUrl,
            modelDetailsForStep.supportsSystemInstruction ? systemInstructionToUse : undefined,
            imageApiPartForStep ? { mimeType: imageApiPartForStep.inlineData.mimeType, data: imageApiPartForStep.inlineData.data } : undefined,
            state.abortControllerRef.current?.signal,
            streamHandler
          );
        } else {
          result = await generateGeminiResponse(
            prompt, modelDetailsForStep.apiName, useCustomApiConfig, customApiKey, customApiEndpoint,
            modelDetailsForStep.supportsSystemInstruction ? systemInstructionToUse : undefined,
            imageApiPartForStep, thinkingConfig, state.abortControllerRef.current?.signal,
            streamHandler
          );
        }

        if (state.cancelRequestRef.current) throw new Error("用户取消操作");

        if (result.error) {
          if (result.error === 'AbortError') throw new Error("用户取消操作");
          throw new Error(result.text || "AI 响应错误");
        }

        setGlobalApiKeyStatus({ isMissing: false, isInvalid: false, message: undefined });
        parsedResponse = parseAIResponse(result.text);
        
        // 更新为最终解析后的文本（去掉 JSON 后的 spokenText）
        updateMessage(msgId, { text: parsedResponse.spokenText, durationMs: result.durationMs, thoughts: result.thoughts });
        stepSuccess = true;
      } catch (e) {
        const error = e as Error;
        // 发生错误时，将刚才创建的占位消息标记或移除（本例简单处理为移除或显示错误）
        if (state.cancelRequestRef.current || error.name === 'AbortError') throw new Error("用户取消操作");

        if (autoRetryCount < MAX_AUTO_RETRIES) {
          addMessage(`[重试] ${error.message}`, MessageSender.System, MessagePurpose.SystemNotification);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_BASE_MS * (autoRetryCount + 1)));
        } else {
          const errorMsgId = addMessage(`失败: ${error.message}`, MessageSender.System, MessagePurpose.SystemNotification);
          state.setFailedStepInfo({
            stepIdentifier, prompt, modelName: modelDetailsForStep.apiName,
            systemInstruction: systemInstructionToUse, imageApiPart: imageApiPartForStep,
            sender: senderForStep, purpose: purposeForStep, originalSystemErrorMsgId: errorMsgId,
            userInputForFlow: userInputForFlowContext || "", imageApiPartForFlow: imageApiPartForFlowContext,
            discussionLogBeforeFailure: discussionLogBeforeFailureContext || [],
            currentTurnIndexForResume: currentTurnIndexForResumeContext,
            previousAISignaledStopForResume: previousAISignaledStopForResumeContext
          });
          state.setIsInternalDiscussionActive(false);
          throw error;
        }
      }
      autoRetryCount++;
    }
    return parsedResponse!;
  }, [
    state, addMessage, updateMessage, cognitoSystemPrompt, museSystemPrompt, getThinkingConfigForGeminiModel,
    useOpenAiApiConfig, openAiApiKey, openAiApiBaseUrl, useCustomApiConfig, customApiKey, customApiEndpoint, setGlobalApiKeyStatus,
    cognitoThinkingBudget, cognitoThinkingLevel, museThinkingBudget, museThinkingLevel
  ]);

  return { executeStep };
};
