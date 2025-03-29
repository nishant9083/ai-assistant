import * as vscode from 'vscode';
import { OllamaClient } from '../ollama/client';
import { ContextProvider } from './contextProvider';
import { PromptTemplates, IPromptTemplate } from './promptTemplates';
import { FileContextSelector } from './fileContextSelector';
import { CodeActionHandler } from './codeActions';
import { ChatHistoryService, Chat, ChatMessage } from '../services/chatHistoryService';
import * as path from 'path';
import * as fs from 'fs';

export class ChatInterface implements CodeActionHandler {
    private client: OllamaClient;
    private contextProvider: ContextProvider;
    private promptTemplates: PromptTemplates;
    private fileContextSelector: FileContextSelector;
    private panel: vscode.WebviewPanel | undefined;
    private context: vscode.ExtensionContext;
    private currentTemplate: string = 'general_coding';
    private currentRequestId: string | null = null;
    private chatHistoryService: ChatHistoryService;

    constructor(
        client: OllamaClient,
        contextProvider: ContextProvider,
        context: vscode.ExtensionContext,
        promptTemplates: PromptTemplates,
        fileContextSelector: FileContextSelector
    ) {
        this.client = client;
        this.contextProvider = contextProvider;
        this.context = context;
        this.promptTemplates = promptTemplates;
        this.fileContextSelector = fileContextSelector;
        this.chatHistoryService = new ChatHistoryService(context);
    }

    public open() {
        if (this.panel) {
            this.panel.reveal();
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'aiAssistantChat',
                'CodePilot Chat',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    enableFindWidget: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this.context.extensionUri, 'resources')
                    ]
                }
            );
            this.panel.iconPath = {
                light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'bot.svg'),
                dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'bot.png')
            };

            this.panel.webview.html = this.getWebviewContent(this.panel.webview, this.context.extensionUri);

            this.panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'ask':
                            this.handleQuestion(message.text);
                            break;
                        case 'selectTemplate':
                            this.currentTemplate = message.templateId;
                            break;
                        case 'selectFiles':
                            await this.selectContextFiles();
                            break;
                        case 'stopGeneration':
                            this.stopGeneration();
                            break;
                        case 'newChat':
                            this.createNewChat();
                            break;
                        case 'loadChat':
                            this.loadChat(message.chatId);
                            break;
                        case 'deleteChat':
                            this.deleteChat(message.chatId);
                            break;
                        case 'updateChatTitle':
                            this.updateChatTitle(message.chatId, message.title);
                            break;
                    }
                },
                undefined
            );

            this.panel.onDidDispose(
                () => {
                    this.panel = undefined;
                },
                null
            );

            // Find or create a workspace chat
            this.chatHistoryService.findOrCreateWorkspaceChat();

            // Send initial data to the webview
            this.updateWebviewTemplates();
            this.updateModelInfo();
            this.updateFileContextStatus();
            this.updateChatList();
            this.loadCurrentChatHistory();
        }
    }

    private async selectContextFiles(): Promise<void> {
        const selectionChanged = await this.fileContextSelector.selectFiles();
        if (selectionChanged) {
            this.updateFileContextStatus();
        }
    }

    private updateFileContextStatus(): void {
        const count = this.fileContextSelector.getSelectedFilesCount();
        this.panel?.webview.postMessage({
            type: 'updateFileContext',
            count: count
        });
    }

    private updateWebviewTemplates(): void {
        const templates = this.promptTemplates.getChatTemplates();
        this.panel?.webview.postMessage({
            type: 'updateTemplates',
            templates: templates,
            currentTemplate: this.currentTemplate
        });
    }

    private updateModelInfo(): void {
        this.panel?.webview.postMessage({
            type: 'updateModel',
            model: this.client.getCurrentModel()
        });
    }

    private updateChatList(): void {
        const allChats = this.chatHistoryService.getAllChats();
        const currentChat = this.chatHistoryService.getCurrentChat();

        this.panel?.webview.postMessage({
            type: 'updateChatList',
            chats: allChats,
            currentChatId: currentChat?.id || null
        });
    }

    private loadCurrentChatHistory(): void {
        const currentChat = this.chatHistoryService.getCurrentChat();

        if (currentChat) {
            this.panel?.webview.postMessage({
                type: 'loadChatHistory',
                messages: currentChat.messages
            });
        }
    }

    private async handleQuestion(question: string) {
        try {
            // Get current chat or create a new one if none exists
            let currentChat = this.chatHistoryService.getCurrentChat();
            if (!currentChat) {
                const newChatId = this.chatHistoryService.createNewChat(
                    this.chatHistoryService.getCurrentWorkspaceId()
                );
                currentChat = this.chatHistoryService.getChat(newChatId);
                if (!currentChat) {
                    throw new Error("Failed to create a new chat");
                }
                this.updateChatList();
            }

            // Add user message to chat history
            this.chatHistoryService.addMessageToChat(currentChat.id, {
                role: 'user',
                content: question
            });

            // Notify webview
            this.panel?.webview.postMessage({ type: 'startResponse', isGenerating: true });

            // Get context from current workspace/file
            let context = await this.contextProvider.getCurrentContext();

            // Add file context if any files are selected
            const fileContext = await this.fileContextSelector.getSelectedFilesContent();
            if (fileContext !== 'No context files selected.') {
                context += '\n\n' + fileContext;
            }

            // Apply the selected template
            const prompt = this.promptTemplates.applyChatTemplate(
                this.currentTemplate,
                context,
                question
            );

            let responseContent = '';

            // Stream response back to webview
            const { requestId } = await this.client.streamCompletion(prompt, (chunk) => {
                if (chunk === '__END__') {
                    // Add assistant's complete message to chat history
                    this.chatHistoryService.addMessageToChat(currentChat!.id, {
                        role: 'assistant',
                        content: responseContent
                    });

                    this.currentRequestId = null;
                    this.updateChatList();
                    this.panel?.webview.postMessage({ type: 'endResponse', isGenerating: false });
                } else if (chunk === '__CANCELLED__') {
                    // Add a note that generation was cancelled
                    if (responseContent) {
                        this.chatHistoryService.addMessageToChat(currentChat!.id, {
                            role: 'assistant',
                            content: responseContent + '\n\n_[Generation stopped by user]_'
                        });
                    }

                    this.currentRequestId = null;
                    this.updateChatList();
                    this.panel?.webview.postMessage({ type: 'cancelled', isGenerating: false });
                } else if (chunk.startsWith('__ERROR__')) {
                    // Add error message
                    this.chatHistoryService.addMessageToChat(currentChat!.id, {
                        role: 'system',
                        content: `Error: ${chunk.replace('__ERROR__', '')}`
                    });

                    this.currentRequestId = null;
                    this.updateChatList();
                    this.panel?.webview.postMessage({
                        type: 'error',
                        content: chunk.replace('__ERROR__', ''),
                        isGenerating: false
                    });
                } else {
                    responseContent += chunk;
                    this.panel?.webview.postMessage({ type: 'textChunk', content: chunk });
                }
            });

            this.currentRequestId = requestId;

        } catch (error) {
            this.currentRequestId = null;

            const currentChat = this.chatHistoryService.getCurrentChat();
            if (currentChat) {
                this.chatHistoryService.addMessageToChat(currentChat.id, {
                    role: 'system',
                    content: `Error: Failed to get response from Ollama - ${error instanceof Error ? error.message : String(error)}`
                });
            }

            this.panel?.webview.postMessage({
                type: 'error',
                content: 'Failed to get response from Ollama',
                isGenerating: false
            });
        }
    }

    public async handleCodeAction(type: 'explain' | 'refactor' | 'document', prompt: string): Promise<void> {
        // Make sure the chat interface is open
        this.open();

        // Get current chat or create a new one if none exists
        let currentChat = this.chatHistoryService.getCurrentChat();
        if (!currentChat) {
            const newChatId = this.chatHistoryService.createNewChat(
                this.chatHistoryService.getCurrentWorkspaceId()
            );
            currentChat = this.chatHistoryService.getChat(newChatId);
            if (!currentChat) {
                throw new Error("Failed to create a new chat");
            }
            this.updateChatList();
        }

        // Post a system message to indicate what action is being performed
        const actionTitle = this.capitalize(type) + " Code";

        try {
            // Open the panel if it's not already open
            if (!this.panel) {
                this.open();
                // Small delay to ensure the panel is ready
                await new Promise(resolve => setTimeout(resolve, 300));
            }

            // Add a system message to the chat history
            this.chatHistoryService.addMessageToChat(currentChat.id, {
                role: 'system',
                content: `**${actionTitle}** - Processing...`
            });

            // Add a "system message" to indicate the action being performed
            this.panel?.webview.postMessage({
                type: 'systemMessage',
                content: `**${actionTitle}** - Processing...`
            });

            this.panel?.webview.postMessage({ type: 'startResponse', isGenerating: true });

            let responseContent = '';

            // Stream response back to webview
            const { requestId } = await this.client.streamCompletion(prompt, (chunk) => {
                if (chunk === '__END__') {
                    // Add assistant's complete message to chat history
                    this.chatHistoryService.addMessageToChat(currentChat!.id, {
                        role: 'assistant',
                        content: responseContent
                    });

                    this.currentRequestId = null;
                    this.updateChatList();
                    this.panel?.webview.postMessage({ type: 'endResponse', isGenerating: false });
                } else if (chunk === '__CANCELLED__') {
                    // Add a note that generation was cancelled
                    if (responseContent) {
                        this.chatHistoryService.addMessageToChat(currentChat!.id, {
                            role: 'assistant',
                            content: responseContent + '\n\n_[Generation stopped by user]_'
                        });
                    }

                    this.currentRequestId = null;
                    this.updateChatList();
                    this.panel?.webview.postMessage({ type: 'cancelled', isGenerating: false });
                } else if (chunk.startsWith('__ERROR__')) {
                    // Add error message
                    this.chatHistoryService.addMessageToChat(currentChat!.id, {
                        role: 'system',
                        content: `Error: ${chunk.replace('__ERROR__', '')}`
                    });

                    this.currentRequestId = null;
                    this.updateChatList();
                    this.panel?.webview.postMessage({
                        type: 'error',
                        content: chunk.replace('__ERROR__', ''),
                        isGenerating: false
                    });
                } else {
                    responseContent += chunk;
                    this.panel?.webview.postMessage({ type: 'textChunk', content: chunk });
                }
            });

            this.currentRequestId = requestId;

        } catch (error) {
            this.currentRequestId = null;

            const currentChat = this.chatHistoryService.getCurrentChat();
            if (currentChat) {
                this.chatHistoryService.addMessageToChat(currentChat.id, {
                    role: 'system',
                    content: `Error: Failed to ${type} code - ${error instanceof Error ? error.message : String(error)}`
                });
            }

            this.panel?.webview.postMessage({
                type: 'error',
                content: `Failed to ${type} code: ${error instanceof Error ? error.message : String(error)}`,
                isGenerating: false
            });
        }
    }

    public stopGeneration() {
        if (this.currentRequestId) {
            this.client.abortRequest(this.currentRequestId);
            this.currentRequestId = null;
        }
    }

    public createNewChat(): void {
        const chatId = this.chatHistoryService.createNewChat(
            this.chatHistoryService.getCurrentWorkspaceId()
        );
        this.updateChatList();
        this.clearChatUI();
    }

    public loadChat(chatId: string): void {
        if (this.chatHistoryService.setCurrentChat(chatId)) {
            this.updateChatList();
            this.loadCurrentChatHistory();
        } else {
            vscode.window.showErrorMessage(`Failed to load chat ${chatId}`);
        }
    }

    public async deleteChat(chatId: string | null): Promise<void> {
        if (!chatId) {
            chatId = this.chatHistoryService.getCurrentChat()?.id || null;
        }
        if (!chatId) {
            return;
        }
        const answer = await vscode.window.showWarningMessage(
            "Are you sure you want to delete this chat?",
            { modal: true },
            "Yes", "No"
        );        
        if (answer === "Yes") {
            if (this.chatHistoryService.deleteChat(chatId)) {
                this.updateChatList();

                // If we deleted the current chat, clear the UI
                const currentChat = this.chatHistoryService.getCurrentChat();
                if (!currentChat) {
                    this.clearChatUI();
                } else {
                    this.loadCurrentChatHistory();
                }
            }
            else {
                vscode.window.showErrorMessage(`Failed to delete chat ${chatId}`);
            }
        }
    }

    public updateChatTitle(chatId: string, title: string): void {
        if (this.chatHistoryService.updateChatTitle(chatId, title)) {
            this.updateChatList();
        } else {
            vscode.window.showErrorMessage(`Failed to update chat title`);
        }
    }

    private clearChatUI(): void {
        this.panel?.webview.postMessage({
            type: 'clearChat'
        });
    }

    private capitalize(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    private getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        // Create URIs for the external files
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'styles.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'script.js'));
        const userImgUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'user.svg'));
        const aiImgUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'bot.svg'));

        // Read the HTML file
        const htmlPath = vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'chat.html');
        let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

        // Replace placeholders in the HTML with the actual URIs
        html = html
            .replace('{{cssUri}}', cssUri.toString())
            .replace('{{scriptUri}}', scriptUri.toString())
            .replace(/{{userImgUri}}/g, userImgUri.toString())
            .replace(/{{aiImgUri}}/g, aiImgUri.toString());            

        // Add VSCode theme CSS variables
        const colorCustomizations = vscode.workspace.getConfiguration().get('workbench.colorCustomizations') as Record<string, string> || {};
        const themeVariables = `
            :root {
                --vscode-editor-background: ${colorCustomizations['editor.background'] || '#1E1E1E'};
                --vscode-editor-foreground: ${colorCustomizations['editor.foreground'] || '#D4D4D4'};
            }
        `;
        html = html.replace('</head>', `<style>${themeVariables}</style></head>`);

        return html;
    }
}
