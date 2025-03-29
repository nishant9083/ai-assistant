import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
}

export interface Chat {
    id: string;
    title: string;
    messages: ChatMessage[];
    workspaceId?: string; // Optional association with a workspace
    createdAt: number;
    updatedAt: number;
}

export class ChatHistoryService {
    private storagePath: string;
    private chats: Map<string, Chat> = new Map();
    private currentChatId: string | null = null;
    
    constructor(context: vscode.ExtensionContext) {
        this.storagePath = path.join(context.globalStoragePath, 'chats');
        this.ensureStoragePathExists();
        this.loadChats();
    }
    
    private ensureStoragePathExists(): void {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
    }
    
    private loadChats(): void {
        try {
            const chatFiles = fs.readdirSync(this.storagePath).filter(file => file.endsWith('.json'));
            
            for (const file of chatFiles) {
                try {
                    const chatData = fs.readFileSync(path.join(this.storagePath, file), 'utf8');
                    const chat = JSON.parse(chatData) as Chat;
                    this.chats.set(chat.id, chat);
                } catch (err) {
                    console.error(`Failed to load chat from ${file}:`, err);
                }
            }
        } catch (err) {
            console.error('Failed to load chats:', err);
        }
    }
    
    public createNewChat(workspaceId?: string): string {
        const id = crypto.randomUUID();
        const title = `Chat ${new Date().toLocaleString()}`;
        
        const newChat: Chat = {
            id,
            title,
            messages: [],
            workspaceId,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        
        this.chats.set(id, newChat);
        this.currentChatId = id;
        this.saveChat(newChat);
        
        return id;
    }
    
    public getChat(chatId: string): Chat | undefined {
        return this.chats.get(chatId);
    }
    
    public getAllChats(): Chat[] {
        return Array.from(this.chats.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    }
    
    public getWorkspaceChats(workspaceId: string): Chat[] {
        return this.getAllChats().filter(chat => chat.workspaceId === workspaceId);
    }
    
    public getCurrentChat(): Chat | undefined {
        if (!this.currentChatId) {
            return undefined;
        }
        return this.getChat(this.currentChatId);
    }
    
    public setCurrentChat(chatId: string): boolean {
        if (this.chats.has(chatId)) {
            this.currentChatId = chatId;
            return true;
        }
        return false;
    }
    
    public addMessageToChat(chatId: string, message: Omit<ChatMessage, 'timestamp'>): boolean {
        const chat = this.chats.get(chatId);
        if (!chat) {
            return false;
        }
        
        const messageWithTimestamp: ChatMessage = {
            ...message,
            timestamp: Date.now()
        };
        
        chat.messages.push(messageWithTimestamp);
        chat.updatedAt = messageWithTimestamp.timestamp;
        
        // Update chat title if it's the first user message
        if (message.role === 'user' && chat.messages.filter(m => m.role === 'user').length === 1) {
            chat.title = message.content.substring(0, 30) + (message.content.length > 30 ? '...' : '');
        }
        
        this.saveChat(chat);
        return true;
    }
    
    public deleteChat(chatId: string): boolean {
        const chat = this.chats.get(chatId);
        if (!chat) {
            return false;
        }
        
        this.chats.delete(chatId);
        
        // Delete file
        try {
            const filePath = path.join(this.storagePath, `${chatId}.json`);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (err) {
            console.error(`Failed to delete chat file ${chatId}:`, err);
        }
        
        // If we deleted the current chat, clear currentChatId
        if (this.currentChatId === chatId) {
            this.currentChatId = null;
        }
        
        return true;
    }
    
    public clearAllChats(): void {
        const chatIds = Array.from(this.chats.keys());
        for (const id of chatIds) {
            this.deleteChat(id);
        }
    }
    
    public updateChatTitle(chatId: string, newTitle: string): boolean {
        const chat = this.chats.get(chatId);
        if (!chat) {
            return false;
        }
        
        chat.title = newTitle;
        chat.updatedAt = Date.now();
        this.saveChat(chat);
        return true;
    }
    
    private saveChat(chat: Chat): void {
        try {
            fs.writeFileSync(
                path.join(this.storagePath, `${chat.id}.json`), 
                JSON.stringify(chat, null, 2),
                'utf8'
            );
        } catch (err) {
            console.error(`Failed to save chat ${chat.id}:`, err);
        }
    }
    
    public getCurrentWorkspaceId(): string | undefined {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return undefined;
        }
        
        // Create a deterministic ID for the workspace
        const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        return crypto.createHash('md5').update(workspacePath).digest('hex');
    }
    
    public findOrCreateWorkspaceChat(): string {
        const workspaceId = this.getCurrentWorkspaceId();
        
        // If no workspace is open, just create a new chat without workspace association
        if (!workspaceId) {
            return this.createNewChat();
        }
        
        // Try to find an existing chat for this workspace
        const workspaceChats = this.getWorkspaceChats(workspaceId);
        
        if (workspaceChats.length > 0) {
            // Use the most recently updated chat
            const mostRecentChat = workspaceChats.sort((a, b) => b.updatedAt - a.updatedAt)[0];
            this.currentChatId = mostRecentChat.id;
            return mostRecentChat.id;
        } else {
            // Create a new chat for this workspace
            return this.createNewChat(workspaceId);
        }
    }
}
