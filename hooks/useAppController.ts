
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChatMessage, MessageSender, MessagePurpose, ApiKeyStatus } from '../types';
import { useAppUI } from './useAppUI';
import { useNotepadLogic } from './useNotepadLogic';
import { useSettings } from './useSettings';
import { useChatLogic } from './useChatLogic';
import { generateUniqueId, getWelcomeMessageText } from '../utils/appUtils';
import { CHAT_MESSAGES_STORAGE_KEY } from '../constants';

const DEFAULT_CHAT_PANEL_PERCENT = 60;

export const useAppController = (panelsContainerRef: React.RefObject<HTMLDivElement>) => {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem(CHAT_MESSAGES_STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved).map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        }));
      } catch (e) {
        console.error("Failed to parse saved messages", e);
      }
    }
    return [];
  });
  
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>({});
  
  useEffect(() => {
    localStorage.setItem(CHAT_MESSAGES_STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;

  const ui = useAppUI(DEFAULT_CHAT_PANEL_PERCENT, panelsContainerRef);
  const notepad = useNotepadLogic(); 
  const settings = useSettings();

  const addMessage = useCallback((
    text: string,
    sender: MessageSender,
    purpose: MessagePurpose,
    durationMs?: number,
    image?: ChatMessage['image'],
    thoughts?: string
  ): string => {
    const messageId = generateUniqueId();
    setMessages(prev => [...prev, {
      id: messageId,
      text,
      sender,
      purpose,
      timestamp: new Date(),
      durationMs,
      image,
      thoughts,
    }]);
    return messageId;
  }, []);

  const updateMessage = useCallback((
    id: string,
    updates: Partial<Pick<ChatMessage, 'text' | 'thoughts' | 'durationMs'>>
  ) => {
    setMessages(prev => prev.map(msg => msg.id === id ? { ...msg, ...updates } : msg));
  }, []);

  const chat = useChatLogic({
    addMessage,
    updateMessage,
    processNotepadUpdateFromAI: notepad.processNotepadUpdateFromAI,
    setGlobalApiKeyStatus: setApiKeyStatus,
    cognitoModelDetails: settings.actualCognitoModelDetails,
    museModelDetails: settings.actualMuseModelDetails,
    useCustomApiConfig: settings.useCustomApiConfig,
    customApiKey: settings.customApiKey,
    customApiEndpoint: settings.customApiEndpoint,
    useOpenAiApiConfig: settings.useOpenAiApiConfig,
    openAiApiKey: settings.openAiApiKey,
    openAiApiBaseUrl: settings.openAiApiBaseUrl,
    openAiCognitoModelId: settings.openAiCognitoModelId,
    openAiMuseModelId: settings.openAiMuseModelId,
    discussionMode: settings.discussionMode,
    manualFixedTurns: settings.manualFixedTurns,
    cognitoThinkingBudget: settings.cognitoThinkingBudget,
    cognitoThinkingLevel: settings.cognitoThinkingLevel,
    museThinkingBudget: settings.museThinkingBudget,
    museThinkingLevel: settings.museThinkingLevel,
    cognitoSystemPrompt: settings.cognitoSystemPrompt,
    museSystemPrompt: settings.museSystemPrompt,
    notepadContent: notepad.notepadContent,
    startProcessingTimer: ui.startProcessingTimer,
    stopProcessingTimer: ui.stopProcessingTimer,
    currentQueryStartTimeRef: ui.currentQueryStartTimeRef,
  });

  const initializeChat = useCallback((shouldClear = true) => {
    if (shouldClear) {
      setMessages([]);
      notepad.clearNotepadContent();
    }
    ui.setIsNotepadFullscreen(false);
    setApiKeyStatus({});

    let missingKeyMsg = "";
    if (settings.useOpenAiApiConfig) {
      if (!settings.openAiApiBaseUrl.trim() || !settings.openAiCognitoModelId.trim() || !settings.openAiMuseModelId.trim()) {
        missingKeyMsg = "OpenAI API 配置不完整。";
      }
    } else if (settings.useCustomApiConfig) {
      if (!settings.customApiKey.trim()) {
        missingKeyMsg = "自定义 Gemini API 密钥缺失。";
      }
    } else {
      if (!(process.env.API_KEY && process.env.API_KEY.trim() !== "")) {
        missingKeyMsg = "Google Gemini API 密钥未配置。";
      }
    }

    if (missingKeyMsg) {
      addMessage(`严重警告：${missingKeyMsg}`, MessageSender.System, MessagePurpose.SystemNotification);
      setApiKeyStatus({ isMissing: true, message: missingKeyMsg });
    } else {
      const welcomeText = getWelcomeMessageText(
        settings.actualCognitoModelDetails.name,
        settings.actualMuseModelDetails.name,
        settings.discussionMode,
        settings.manualFixedTurns,
        settings.useOpenAiApiConfig,
        settings.openAiCognitoModelId,
        settings.openAiMuseModelId
      );
      if (shouldClear || messagesRef.current.length === 0) {
        addMessage(welcomeText, MessageSender.System, MessagePurpose.SystemNotification);
      }
    }
  }, [addMessage, notepad, ui, settings]);

  useEffect(() => {
    initializeChat(false);
  }, [settings.useCustomApiConfig, settings.useOpenAiApiConfig]);

  useEffect(() => {
    let intervalId: number | undefined;
    if (chat.isLoading && ui.currentQueryStartTimeRef.current) {
      intervalId = window.setInterval(() => {
        if (ui.currentQueryStartTimeRef.current && !chat.cancelRequestRef.current) {
          ui.updateProcessingTimer();
        }
      }, 100);
    } else {
      if (intervalId) clearInterval(intervalId);
      if (!chat.isLoading && ui.currentQueryStartTimeRef.current !== null) {
        ui.updateProcessingTimer();
      }
    }
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [chat.isLoading, ui.updateProcessingTimer, ui.currentQueryStartTimeRef, chat.cancelRequestRef]);

  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ui.isNotepadFullscreen) ui.toggleNotepadFullscreen();
      if (event.key === 'Escape' && ui.isSettingsModalOpen) ui.closeSettingsModal();
    };
    document.addEventListener('keydown', handleEscKey);
    return () => document.removeEventListener('keydown', handleEscKey);
  }, [ui.isNotepadFullscreen, ui.toggleNotepadFullscreen, ui.isSettingsModalOpen, ui.closeSettingsModal]);

  const handleClearChat = useCallback(() => {
    if (chat.isLoading) chat.stopGenerating();
    initializeChat(true);
  }, [chat, initializeChat]);

  const apiKeyBannerMessage = useMemo(() => {
    if (!apiKeyStatus.message) return null;
    return apiKeyStatus.message;
  }, [apiKeyStatus]);

  return {
    messages,
    apiKeyStatus,
    apiKeyBannerMessage,
    ui,
    notepad,
    settings,
    chat,
    actions: {
      initializeChat,
      handleClearChat,
      addMessage,
    }
  };
};
