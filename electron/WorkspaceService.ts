import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { WorkspaceStore } from "./workspaceStore";
import {
  emptyWorkspace,
  type WorkspaceSnapshot,
  type WorkspaceData,
  type Project,
  type Conversation,
  type SavedOutput,
  type AttachmentPreview,
  type GenerateInput,
  type GenerationEvent,
  type Message,
} from "./workspaceContract";
import {
  projectSchema,
  conversationSchema,
  outputSchema,
  generationSchema,
  idSchema,
  normalizeCrop,
} from "./workspacePolicy";

export interface PendingAttachment {
  view: AttachmentPreview;
  bytes: Buffer;
}
export class WorkspaceService {
  private deviceMessages: Message[] = [];
  private contextProvider: () => string = () => "";
  private localAnswer: ((text: string, images: Buffer[], signal: AbortSignal) => Promise<string>) | null = null;
  private client: SupabaseClient | null = null;
  private state: WorkspaceSnapshot = {
    ...emptyWorkspace(),
    account: null,
    configured: false,
    online: true,
    usage: null,
    activeProjectId: null,
    activeConversationId: null,
    drafts: {},
    generating: null,
    update: null,
  };
  private pending = new Map<string, PendingAttachment>();
  private abort: AbortController | null = null;
  private generationTask: Promise<void> | null = null;
  private requestId: string | null = null;
  private epoch = 0;
  private mutation: Promise<unknown> = Promise.resolve();
  private refreshPending: Promise<void> | null = null;
  constructor(
    private config: { supabaseUrl: string; supabaseAnonKey: string },
    private store: WorkspaceStore,
    private notify: (snapshot: WorkspaceSnapshot) => void,
    private generation: (event: GenerationEvent) => void,
  ) {
    if (config.supabaseUrl && config.supabaseAnonKey) {
      const url = new URL(config.supabaseUrl);
      if (
        url.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(url.hostname)
      )
        throw new Error("The cloud service must use HTTPS.");
      this.client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storage: store,
        },
      });
      this.state.configured = true;
    }
  }
  snapshot() {
    return structuredClone(this.state);
  }
  private emit() {
    this.notify(this.snapshot());
  }
  private cacheKey() {
    return `workspace-${this.state.account?.id || "local"}`;
  }
  private async persist() {
    await this.store.setItem(
      this.cacheKey(),
      JSON.stringify({ ...this.state, deviceMessages: this.deviceMessages, generating: null, update: null }),
    );
    this.emit();
  }
  async initialize() {
    const session = this.client
      ? (await this.client.auth.getSession()).data.session
      : null;
    this.state.account = session
      ? { id: session.user.id, email: session.user.email || "" }
      : null;
    await this.loadCache();
    if (this.state.account) await this.refresh().catch(() => {});
    this.emit();
  }
  private async loadCache() {
    this.deviceMessages = [];
    const saved = await this.store.getItem(this.cacheKey());
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.deviceMessages = parsed.deviceMessages || [];
        delete parsed.deviceMessages;
        this.state = {
          ...this.state,
          ...parsed,
          account: this.state.account,
          configured: !!this.client,
          online: true,
          generating: null,
          update: null,
        };
      } catch {
        /* corrupt cache can be recovered from cloud */
      }
    }
  }
  private async token() {
    if (!this.client || !this.state.account)
      throw new Error("Sign in to use managed AI and cloud projects.");
    const { data, error } = await this.client.auth.getSession();
    if (error || !data.session)
      throw new Error("Your session expired. Sign in again.");
    return data.session.access_token;
  }
  async api(op: string, value?: unknown, signal?: AbortSignal): Promise<any> {
    const token = await this.token();
    let response: Response;
    try {
      response = await fetch(
        `${this.config.supabaseUrl}/functions/v1/workspace`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: this.config.supabaseAnonKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ op, value }),
          signal:
            signal ||
            AbortSignal.timeout(
              op === "snapshot" || op === "cancel" ? 10000 : 60000,
            ),
        },
      );
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        this.state.online = false;
        this.emit();
      }
      throw new Error(
        "Could not reach Quip. Your saved work and drafts are still available.",
      );
    }
    if (!response.ok) {
      let error = "Request failed. Please try again.";
      try {
        error = ((await response.json()) as { error?: string }).error || error;
      } catch {}
      throw new Error(error);
    }
    this.state.online = true;
    return op === "generate" ? response : response.json();
  }
  async refresh() {
    if (!this.state.account) return;
    if (this.refreshPending) return this.refreshPending;
    const epoch = this.epoch;
    const operation = (async () => {
      const result = await this.api("snapshot");
      if (epoch !== this.epoch) return;
      result.messages.sort(
        (a: { createdAt: string }, b: { createdAt: string }) =>
          a.createdAt.localeCompare(b.createdAt),
      );
      this.deviceMessages = this.deviceMessages.filter(message => result.conversations.some((c: Conversation) => c.id === message.conversationId));
      result.messages = [...result.messages, ...this.deviceMessages.filter(message => !result.messages.some((m: Message) => m.id === message.id))].sort((a: Message, b: Message) => a.createdAt.localeCompare(b.createdAt));
      this.state = { ...this.state, ...result };
      this.repairSelection();
      await this.persist();
    })();
    this.refreshPending = operation;
    try {
      await operation;
    } finally {
      if (this.refreshPending === operation) this.refreshPending = null;
    }
  }
  private repairSelection() {
    if (!this.state.projects.some((p) => p.id === this.state.activeProjectId))
      this.state.activeProjectId = this.state.projects[0]?.id || null;
    if (
      !this.state.conversations.some(
        (c) =>
          c.id === this.state.activeConversationId &&
          c.projectId === this.state.activeProjectId,
      )
    )
      this.state.activeConversationId =
        this.state.conversations.find(
          (c) => c.projectId === this.state.activeProjectId,
        )?.id || null;
  }
  private queue(operation: () => Promise<void>) {
    const result = this.mutation.then(operation);
    this.mutation = result.catch(() => {});
    return result;
  }
  async signIn(email: string) {
    if (!this.client)
      throw new Error(
        "Cloud access is not configured in this build. Local projects remain available.",
      );
    if (
      typeof email !== "string" ||
      email.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(email)
    )
      throw new Error("Enter a valid email address.");
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) throw new Error(error.message);
  }
  async verifyCode(email: string, token: string) {
    if (!this.client || !/^\d{6,10}$/.test(token))
      throw new Error("Enter the code from your email.");
    await this.cancelGeneration();
    await this.mutation;
    await this.persist();
    const { data, error } = await this.client.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    if (error || !data.user)
      throw new Error(error?.message || "Sign-in failed.");
    this.epoch++;
    this.pending.clear();
    const configured = this.state.configured;
    this.state = {
      ...this.state,
      ...emptyWorkspace(),
      account: { id: data.user.id, email: data.user.email || email },
      configured,
      drafts: {},
      activeProjectId: null,
      activeConversationId: null,
      generating: null,
      usage: null,
    };
    await this.loadCache();
    await this.refresh();
  }
  async signOut() {
    await this.cancelGeneration();
    await this.mutation;
    this.epoch++;
    await this.refreshPending?.catch(() => {});
    const key = this.cacheKey();
    if (this.client) await this.client.auth.signOut({ scope: "local" });
    await this.store.removeItem(key);
    this.pending.clear();
    this.state = {
      ...this.state,
      ...emptyWorkspace(),
      account: null,
      drafts: {},
      usage: null,
      activeProjectId: null,
      activeConversationId: null,
      generating: null,
    };
    await this.loadCache();
    this.emit();
  }
  async saveProject(raw: Project) {
    const project = projectSchema.parse(raw);
    return this.queue(async () => {
      if (this.state.account) {
        await this.api("saveProject", project);
        await this.refresh();
      } else
        this.state.projects = [
          ...this.state.projects.filter((p) => p.id !== project.id),
          project,
        ];
      this.state.activeProjectId = project.id;
      this.repairSelection();
      await this.persist();
    });
  }
  async saveConversation(raw: Conversation) {
    const conversation = conversationSchema.parse(raw);
    return this.queue(async () => {
      if (!this.state.projects.some((p) => p.id === conversation.projectId))
        throw new Error("Choose a project first.");
      if (this.state.account) {
        await this.api("saveConversation", conversation);
        await this.refresh();
      } else
        this.state.conversations = [
          ...this.state.conversations.filter((c) => c.id !== conversation.id),
          conversation,
        ];
      this.state.activeProjectId = conversation.projectId;
      this.state.activeConversationId = conversation.id;
      await this.persist();
    });
  }
  async saveOutput(raw: SavedOutput) {
    const output = outputSchema.parse(raw);
    return this.queue(async () => {
      if (!this.state.projects.some((p) => p.id === output.projectId))
        throw new Error("Choose a project first.");
      if (this.state.account) {
        await this.api("saveOutput", output);
        await this.refresh();
      } else
        this.state.outputs = [
          ...this.state.outputs.filter((o) => o.id !== output.id),
          output,
        ];
      await this.persist();
    });
  }
  async remove(
    kind: "Project" | "Conversation" | "Output" | "Source",
    raw: string,
  ) {
    const id = idSchema.parse(raw);
    return this.queue(async () => {
      if (this.state.generating)
        throw new Error("Stop the current answer before deleting work.");
      if (this.state.account) {
        await this.api(`delete${kind}`, id);
        await this.refresh();
      } else {
        if (kind === "Project") {
          const ids = this.state.conversations
            .filter((c) => c.projectId === id)
            .map((c) => c.id);
          this.state.projects = this.state.projects.filter((p) => p.id !== id);
          this.state.conversations = this.state.conversations.filter(
            (c) => c.projectId !== id,
          );
          this.state.messages = this.state.messages.filter(
            (m) => !ids.includes(m.conversationId),
          );
          this.state.outputs = this.state.outputs.filter(
            (o) => o.projectId !== id,
          );
        }
        if (kind === "Conversation") {
          this.state.conversations = this.state.conversations.filter(
            (c) => c.id !== id,
          );
          this.state.messages = this.state.messages.filter(
            (m) => m.conversationId !== id,
          );
        }
        if (kind === "Output")
          this.state.outputs = this.state.outputs.filter((o) => o.id !== id);
      }
      this.deviceMessages = this.deviceMessages.filter(message => this.state.conversations.some(c => c.id === message.conversationId));
      const valid = new Set(
        [...this.state.conversations, ...this.state.projects].map(
          (item) => item.id,
        ),
      );
      for (const key of Object.keys(this.state.drafts))
        if (!valid.has(key)) delete this.state.drafts[key];
      this.repairSelection();
      await this.persist();
    });
  }
  async select(projectId: string, conversationId: string | null) {
    if (!this.state.projects.some((p) => p.id === projectId))
      throw new Error("Project unavailable.");
    if (
      conversationId &&
      !this.state.conversations.some(
        (c) => c.id === conversationId && c.projectId === projectId,
      )
    )
      throw new Error("Conversation unavailable.");
    this.state.activeProjectId = projectId;
    this.state.activeConversationId = conversationId;
    await this.persist();
  }
  async saveDraft(id: string, text: string) {
    if (
      (!this.state.conversations.some((c) => c.id === id) &&
        !this.state.projects.some((p) => p.id === id)) ||
      typeof text !== "string" ||
      text.length > 24000
    )
      throw new Error("Draft unavailable or too long.");
    this.state.drafts[id] = text;
    await this.persist();
  }
  addAttachment(file: PendingAttachment) {
    if (this.pending.size >= 12)
      throw new Error("Remove an unused attachment before adding more.");
    this.pending.set(file.view.id, file);
    return file.view;
  }
  discardAttachment(id: string) {
    this.pending.delete(id);
  }
  async cropAttachment(
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ) {
    const file = this.pending.get(id);
    if (!file || file.view.kind === "document")
      throw new Error("Image unavailable.");
    const info = await sharp(file.bytes).metadata(),
      crop = normalizeCrop(rect, info.width!, info.height!);
    const bytes = await sharp(file.bytes).extract(crop).png().toBuffer();
    file.bytes = bytes;
    file.view = {
      ...file.view,
      mimeType: "image/png",
      size: bytes.length,
      preview: `data:image/png;base64,${bytes.toString("base64")}`,
    };
    return file.view;
  }
  async saveAttachment(id: string, projectId: string) {
    const file = this.pending.get(id);
    if (!file) throw new Error("Attachment expired. Please attach it again.");
    await this.api("uploadSource", {
      id: file.view.id,
      projectId,
      name: file.view.name,
      mimeType: file.view.mimeType,
      data: file.bytes.toString("base64"),
      sections: file.view.sections,
    });
    await this.refresh();
    await this.indexSource(id);
  }
  async indexSource(id: string) {
    for (let batch = 0; batch < 100; batch++) {
      const result = await this.api("indexSource", id);
      if (result.done) {
        await this.refresh();
        return;
      }
    }
    throw new Error("Indexing paused. Refresh to resume.");
  }
  async readSource(id: string) {
    const source = await this.api("readSource", id);
    if (source.mimeType.startsWith("image/")) {
      const url = new URL(source.url);
      if (url.origin !== new URL(this.config.supabaseUrl).origin)
        throw new Error("Invalid source URL.");
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error("Could not load this source.");
      source.preview = `data:${source.mimeType};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
    }
    return source;
  }
  generate(raw: GenerateInput): Promise<void> {
    if (this.generationTask)
      return Promise.reject(new Error("An answer is already running."));
    const task = this.runGeneration(raw);
    this.generationTask = task;
    void task
      .finally(() => {
        if (this.generationTask === task) this.generationTask = null;
      })
      .catch(() => {});
    return task;
  }
  private async runGeneration(raw: GenerateInput) {
    const input = generationSchema.parse(raw);
    if (this.state.generating)
      throw new Error(
        "An answer is already running. Stop it before starting another.",
      );
    if (!this.state.account && this.localAnswer) return this.runLocalAnswer(input);
    if (!this.state.account) throw new Error("Sign in to use managed AI, or configure a provider in the assistant settings.");
    const conversation = this.state.conversations.find(
      (c) => c.id === input.conversationId,
    );
    if (!conversation) throw new Error("Conversation unavailable.");
    this.state.generating = input.conversationId;
    this.requestId = input.requestId;
    this.abort = new AbortController();
    this.emit();
    const epoch = this.epoch,
      attachments: Array<{ name: string; mimeType: string; data: string }> = [],
      sourceIds = [...input.sourceIds];
    let streamed = "";
    try {
      for (const id of input.attachmentIds) {
        const file = this.pending.get(id);
        if (!file)
          throw new Error("Attachment expired. Please attach it again.");
        if (file.view.kind === "document") {
          await this.saveAttachment(id, conversation.projectId);
          sourceIds.push(id);
        } else {
          const bytes = await sharp(file.bytes)
            .resize({
              width: 1600,
              height: 1600,
              fit: "inside",
              withoutEnlargement: true,
            })
            .jpeg({ quality: 80 })
            .toBuffer();
          attachments.push({
            name: file.view.name,
            mimeType: "image/jpeg",
            data: bytes.toString("base64"),
          });
        }
      }
      for (const sourceId of input.sourceIds) {
        const source = this.state.sources.find(
          (item) =>
            item.id === sourceId && item.projectId === conversation.projectId,
        );
        if (source?.kind !== "image") continue;
        const saved = await this.readSource(sourceId);
        const bytes = await sharp(
          Buffer.from(saved.preview.split(",")[1], "base64"),
        )
          .resize({
            width: 1600,
            height: 1600,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 80 })
          .toBuffer();
        attachments.push({
          name: source.name,
          mimeType: "image/jpeg",
          data: bytes.toString("base64"),
        });
      }
      if (attachments.length > 4)
        throw new Error(
          "Choose up to four images or screenshots for one question.",
        );
      const response: Response = await this.api(
        "generate",
        {
          ...input,
          text: `${input.text}\n\n${this.contextProvider()}`,
          attachmentIds: undefined,
          sourceIds: [...new Set(sourceIds)],
          attachments,
        },
        this.abort.signal,
      );
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The server returned no answer.");
      if (
        !this.state.messages.some((message) => message.id === input.requestId)
      )
        this.state.messages.push({
          id: input.requestId,
          conversationId: input.conversationId,
          role: "user",
          text: input.text,
          createdAt: new Date().toISOString(),
          status: "complete",
          citations: [],
        });
      await this.persist();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        buffer += decoder.decode(item.value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.delta) streamed += event.delta;
          if (event.done) {
            completed = true;
            this.state.messages.push(
              event.message || {
                id: randomUUID(),
                conversationId: input.conversationId,
                role: "assistant",
                text: streamed,
                createdAt: new Date().toISOString(),
                status: "complete",
                citations: [],
              },
            );
          }
          this.generation({
            ...event,
            requestId: input.requestId,
            conversationId: input.conversationId,
          });
          if (event.error) throw new Error(event.error);
        }
      }
      if (!completed)
        throw new Error(
          "The connection ended before the answer completed. Your draft is preserved.",
        );
      if (epoch === this.epoch) {
        if (this.state.drafts[input.conversationId] === input.text)
          delete this.state.drafts[input.conversationId];
        if (this.state.drafts[conversation.projectId] === input.text)
          delete this.state.drafts[conversation.projectId];
        for (const id of input.attachmentIds) this.pending.delete(id);
      }
    } catch (error) {
      if (streamed && epoch === this.epoch)
        this.state.messages.push({
          id: randomUUID(),
          conversationId: input.conversationId,
          role: "assistant",
          text: streamed,
          createdAt: new Date().toISOString(),
          status: "interrupted",
          citations: [],
        });
      if (this.abort?.signal.aborted)
        throw new Error("Stopped. Your draft is preserved.");
      throw error;
    } finally {
      if (epoch === this.epoch) {
        this.abort = null;
        this.requestId = null;
        this.state.generating = null;
        await this.refresh().catch(() => {});
        await this.persist();
        this.generation({
          requestId: input.requestId,
          conversationId: input.conversationId,
          done: true,
        });
      }
    }
  }
  async cancelGeneration() {
    const id = this.requestId;
    this.abort?.abort();
    this.state.generating = null;
    this.emit();
    if (id && this.state.account) await this.api("cancel", id).catch(() => {});
    await this.generationTask?.catch(() => {});
    this.emit();
  }
  async deleteAccount(confirmation: string) {
    if (confirmation !== "DELETE") throw new Error("Type DELETE to confirm.");
    await this.cancelGeneration();
    await this.api("deleteAccount", confirmation);
    await this.signOut();
  }
  setAssistantProvider(context: () => string, answer: (text: string, images: Buffer[], signal: AbortSignal) => Promise<string>) {
    this.contextProvider = context; this.localAnswer = answer;
  }
  async assistantConversation() {
    if (!this.state.activeProjectId) await this.saveProject({ id: randomUUID(), name: "Desktop work", instructions: "", updatedAt: new Date().toISOString() });
    if (!this.state.activeConversationId) await this.saveConversation({ id: randomUUID(), projectId: this.state.activeProjectId!, title: "Desktop assistant", updatedAt: new Date().toISOString() });
    return this.state.activeConversationId!;
  }
  conversationContext(id: string) {
    const conversation = this.state.conversations.find(c => c.id === id);
    const project = this.state.projects.find(p => p.id === conversation?.projectId);
    return `Project instructions: ${project?.instructions || ""}\n` + this.state.messages.filter(m => m.conversationId === id).slice(-12).map(m => `${m.role}: ${m.text}`).join("\n");
  }
  async appendExchange(conversationId: string, question: string, answer: string) {
    return this.queue(async () => {
      if (!this.state.conversations.some(c => c.id === conversationId)) throw new Error("The conversation was removed or the account changed.");
      const messages: Message[] = [
        { id: randomUUID(), conversationId, role: "user", text: question, createdAt: new Date().toISOString(), status: "complete", citations: [] },
        { id: randomUUID(), conversationId, role: "assistant", text: answer, createdAt: new Date().toISOString(), status: "complete", citations: [] },
      ];
      this.state.messages.push(...messages);
      // Device-provider exchanges are shared by both windows and retained on cloud refresh.
      if (this.state.account) this.deviceMessages.push(...messages);
      await this.persist();
    });
  }
  async saveAssistantNote(title: string, text: string, conversationId: string) {
    const conversation = this.state.conversations.find(c => c.id === conversationId);
    if (!conversation) throw new Error("The original conversation is unavailable.");
    await this.saveOutput({ id: randomUUID(), projectId: conversation.projectId, title: title.slice(0, 160), text, updatedAt: new Date().toISOString() });
  }
  private async runLocalAnswer(input: GenerateInput) {
    const conversation = this.state.conversations.find(c => c.id === input.conversationId);
    if (!conversation) throw new Error("Conversation unavailable.");
    this.state.generating = input.conversationId; this.abort = new AbortController(); this.emit();
    const controller = this.abort;
    try {
      const attachments = input.attachmentIds.map(id => { const item = this.pending.get(id); if (!item) throw new Error("Attachment expired."); return item; });
      if (input.sourceIds.length) throw new Error("Saved cloud sources require sign-in. You can attach a local document here.");
      const evidence = attachments.filter(a => a.view.kind === "document").map(a => `${a.view.name}: ${a.view.sections.map(s => s.text).join("\n")}`).join("\n").slice(0, 40000);
      const answer = await this.localAnswer!(`${input.text}\n${this.conversationContext(conversation.id)}\nAttached evidence:\n${evidence}`, attachments.filter(a => a.view.kind !== "document").map(a => a.bytes), controller.signal);
      controller.signal.throwIfAborted();
      await this.appendExchange(conversation.id, input.text, answer);
      if (this.state.drafts[conversation.id] === input.text) delete this.state.drafts[conversation.id];
      this.generation({ requestId: input.requestId, conversationId: conversation.id, delta: answer, done: true });
    } finally {
      this.state.generating = null; this.abort = null; await this.persist();
      this.generation({ requestId: input.requestId, conversationId: conversation.id, done: true });
    }
  }
  setUpdate(message: string) {
    this.state.update = message;
    this.emit();
  }
}
