import * as vscode from 'vscode';
import { OllamaClient } from '../ollama/client';
import { ContextProvider } from './contextProvider';
import { PromptTemplates, IPromptTemplate } from './promptTemplates';
import { FileContextSelector } from './fileContextSelector';
import { CodeActionHandler } from './codeActions';
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
    }

    public open() {
        if (this.panel) {
            this.panel.reveal();
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'aiAssistantChat',
                'AI Assistant Chat',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this.context.extensionUri, 'resources')
                    ]
                }
            );

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
            
            // Send initial data to the webview
            this.updateWebviewTemplates();
            this.updateModelInfo();
            this.updateFileContextStatus();
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

    private async handleQuestion(question: string) {
        try {            
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

            // Stream response back to webview
            const { requestId } = await this.client.streamCompletion(prompt, (chunk) => {
                if (chunk === '__END__') {
                    this.currentRequestId = null;
                    this.panel?.webview.postMessage({ type: 'endResponse', isGenerating: false });
                } else if (chunk === '__CANCELLED__') {
                    this.currentRequestId = null;
                    this.panel?.webview.postMessage({ type: 'cancelled', isGenerating: false });
                } else if (chunk.startsWith('__ERROR__')) {
                    this.currentRequestId = null;
                    this.panel?.webview.postMessage({ 
                        type: 'error',
                        content: chunk.replace('__ERROR__', ''),
                        isGenerating: false 
                    });
                } else {
                    this.panel?.webview.postMessage({ type: 'textChunk', content: chunk });
                }
            });

            this.currentRequestId = requestId;

        } catch (error) {
            this.currentRequestId = null;
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
        
        // Post a system message to indicate what action is being performed
        const actionTitle = this.capitalize(type) + " Code";
        
        try {
            // Open the panel if it's not already open
            if (!this.panel) {
                this.open();
                // Small delay to ensure the panel is ready
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            
            // Add a "system message" to indicate the action being performed
            this.panel?.webview.postMessage({ 
                type: 'systemMessage', 
                content: `**${actionTitle}** - Processing...`
            });
            
            this.panel?.webview.postMessage({ type: 'startResponse', isGenerating: true });

            // Stream response back to webview
            const { requestId } = await this.client.streamCompletion(prompt, (chunk) => {
                if (chunk === '__END__') {
                    this.currentRequestId = null;
                    this.panel?.webview.postMessage({ type: 'endResponse', isGenerating: false });
                } else if (chunk === '__CANCELLED__') {
                    this.currentRequestId = null;
                    this.panel?.webview.postMessage({ type: 'cancelled', isGenerating: false });
                } else if (chunk.startsWith('__ERROR__')) {
                    this.currentRequestId = null;
                    this.panel?.webview.postMessage({ 
                        type: 'error',
                        content: chunk.replace('__ERROR__', ''),
                        isGenerating: false 
                    });
                } else {
                    this.panel?.webview.postMessage({ type: 'textChunk', content: chunk });
                }
            });

            this.currentRequestId = requestId;

        } catch (error) {
            this.currentRequestId = null;
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
    
    return html;
    }
}
