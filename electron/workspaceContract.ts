/** Shared wire types. This module deliberately has no native or provider imports. */
export interface Project {
  id: string;
  name: string;
  instructions: string;
  updatedAt: string;
}
export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  updatedAt: string;
}
export interface Citation {
  sourceId: string;
  label: string;
  page?: number;
  excerpt: string;
}
export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  status: "complete" | "interrupted" | "error";
  citations: Citation[];
}
export interface ContextItem {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "document" | "image";
  status: "indexing" | "ready" | "error";
  error?: string;
  createdAt: string;
}
export interface SavedOutput {
  id: string;
  projectId: string;
  title: string;
  text: string;
  updatedAt: string;
}
export interface UsageSummary {
  plan: "trial" | "pro" | "expired";
  used: number;
  limit: number;
  storageUsed: number;
  storageLimit: number;
  resetsAt: string;
  priceLabel: string;
}
export interface WorkspaceData {
  projects: Project[];
  conversations: Conversation[];
  messages: Message[];
  sources: ContextItem[];
  outputs: SavedOutput[];
}
export interface WorkspaceSnapshot extends WorkspaceData {
  account: { id: string; email: string } | null;
  configured: boolean;
  online: boolean;
  usage: UsageSummary | null;
  activeProjectId: string | null;
  activeConversationId: string | null;
  drafts: Record<string, string>;
  generating: string | null;
  update: string | null;
}
export interface ExtractedSection {
  text: string;
  page?: number;
}
export interface AttachmentPreview {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "document" | "image" | "screen";
  preview: string;
  sections: ExtractedSection[];
}
export interface GenerateInput {
  requestId: string;
  conversationId: string;
  text: string;
  attachmentIds: string[];
  sourceIds: string[];
}
export interface GenerationEvent {
  requestId: string;
  conversationId: string;
  delta?: string;
  done?: boolean;
  error?: string;
}
export interface WorkspaceAPI {
  snapshot(): Promise<WorkspaceSnapshot>;
  refresh(): Promise<void>;
  signIn(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  saveProject(project: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  saveConversation(conversation: Conversation): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  select(projectId: string, conversationId: string | null): Promise<void>;
  saveDraft(conversationId: string, text: string): Promise<void>;
  saveOutput(output: SavedOutput): Promise<void>;
  deleteOutput(id: string): Promise<void>;
  pickFile(): Promise<AttachmentPreview | null>;
  captureScreen(): Promise<AttachmentPreview>;
  cropAttachment(
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<AttachmentPreview>;
  discardAttachment(id: string): Promise<void>;
  saveAttachment(id: string, projectId: string): Promise<void>;
  deleteSource(id: string): Promise<void>;
  readSource(
    id: string,
  ): Promise<{ name: string; sections: ExtractedSection[]; preview?: string }>;
  generate(input: GenerateInput): Promise<void>;
  cancelGeneration(): Promise<void>;
  openWorkspace(): Promise<void>;
  toggleOverlay(): Promise<void>;
  copyText(text: string): Promise<void>;
  exportText(name: string, text: string): Promise<void>;
  exportAccount(): Promise<void>;
  deleteAccount(confirmation: string): Promise<void>;
  openBilling(kind: "checkout" | "portal"): Promise<void>;
  feedback(text: string): Promise<void>;
  installUpdate(): Promise<void>;
  onChange(listener: (snapshot: WorkspaceSnapshot) => void): () => void;
  onGeneration(listener: (event: GenerationEvent) => void): () => void;
}
export const emptyWorkspace = (): WorkspaceData => ({
  projects: [],
  conversations: [],
  messages: [],
  sources: [],
  outputs: [],
});
export const DOCUMENT_LIMIT = 20 * 1024 * 1024;
export const PDF_PAGE_LIMIT = 100;
