
export enum MessageSender {
  User = '用户',
  Cognito = 'Cognito', 
  Muse = 'Muse',     
  System = '系统',
}

export enum MessagePurpose {
  UserInput = 'user-input',
  SystemNotification = 'system-notification',
  CognitoToMuse = 'cognito-to-muse',      
  MuseToCognito = 'muse-to-cognito',      
  FinalResponse = 'final-response',       
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: MessageSender;
  purpose: MessagePurpose;
  timestamp: Date;
  durationMs?: number; 
  thoughts?: string; 
  image?: { 
    dataUrl: string; 
    name: string;
    type: string;
  };
}

export interface AiResponsePayload {
  text: string;
  thoughts?: string;
  durationMs: number;
  error?: string; 
}

export type NotepadAction =
  | { action: 'replace_all'; content: string }
  | { action: 'append'; content: string }
  | { action: 'prepend'; content: string }
  | { action: 'replace_section'; header: string; content: string } 
  | { action: 'append_to_section'; header: string; content: string } 
  | { action: 'search_and_replace'; find: string; replacement: string; all?: boolean }; 

export type NotepadUpdatePayload = {
  modifications?: NotepadAction[];
  error?: string; 
} | null;

export interface ParsedAIResponse {
  spokenText: string;
  notepadUpdate: NotepadUpdatePayload;
  discussionShouldEnd?: boolean;
}

export interface FailedStepPayload {
  stepIdentifier: string;
  prompt: string;
  modelName: string;
  systemInstruction?: string;
  imageApiPart?: { inlineData: { mimeType: string; data: string } };
  sender: MessageSender;
  purpose: MessagePurpose;
  originalSystemErrorMsgId: string;
  thinkingConfig?: { thinkingBudget: number };
  userInputForFlow: string;
  imageApiPartForFlow?: { inlineData: { mimeType: string; data: string } };
  discussionLogBeforeFailure: string[];
  currentTurnIndexForResume?: number;
  previousAISignaledStopForResume?: boolean;
}

export enum DiscussionMode {
  FixedTurns = 'fixed',
  AiDriven = 'ai-driven',
}

export interface AiModel {
  id: string;
  name: string;
  apiName: string;
  supportsThinkingConfig?: boolean;
  supportsSystemInstruction?: boolean;
}

export interface MutableRefObject<T> {
  current: T;
}

export interface ApiKeyStatus {
  isMissing?: boolean;
  isInvalid?: boolean;
  message?: string;
}

export type ThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface ChatLogicCommonDependencies {
  addMessage: (text: string, sender: MessageSender, purpose: MessagePurpose, durationMs?: number, image?: ChatMessage['image'], thoughts?: string) => string;
  updateMessage: (id: string, updates: Partial<Pick<ChatMessage, 'text' | 'thoughts' | 'durationMs'>>) => void;
  processNotepadUpdateFromAI: (parsedResponse: ParsedAIResponse, sender: MessageSender, addSystemMessage: ChatLogicCommonDependencies['addMessage']) => string | null;
  setGlobalApiKeyStatus: (status: { isMissing?: boolean, isInvalid?: boolean, message?: string }) => void;

  cognitoModelDetails: AiModel;
  museModelDetails: AiModel;

  useCustomApiConfig: boolean;
  customApiKey: string;
  customApiEndpoint: string;

  useOpenAiApiConfig: boolean;
  openAiApiKey: string;
  openAiApiBaseUrl: string;
  openAiCognitoModelId: string;
  openAiMuseModelId: string;

  discussionMode: DiscussionMode;
  manualFixedTurns: number;
  
  cognitoThinkingBudget: number;
  cognitoThinkingLevel: ThinkingLevel;
  museThinkingBudget: number;
  museThinkingLevel: ThinkingLevel;

  cognitoSystemPrompt: string;
  museSystemPrompt: string;
  notepadContent: string;
  startProcessingTimer: () => void;
  stopProcessingTimer: () => void;
  currentQueryStartTimeRef: MutableRefObject<number | null>;
}
