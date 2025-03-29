import * as vscode from 'vscode';
import { OllamaClient } from '../ollama/client';
import { ContextProvider } from './contextProvider';
import { PromptTemplates } from './promptTemplates';

export interface CodeActionHandler {
    handleCodeAction(type: 'explain' | 'refactor' | 'document', prompt: string): Promise<void>;
}

export class CodeActionsProvider implements vscode.CodeActionProvider {
    private client: OllamaClient;
    private contextProvider: ContextProvider;
    private promptTemplates: PromptTemplates;
    private currentRequestId: string | null = null;
    private codeActionHandler: CodeActionHandler | null = null;

    constructor(client: OllamaClient, contextProvider: ContextProvider, promptTemplates: PromptTemplates) {
        this.client = client;
        this.contextProvider = contextProvider;
        this.promptTemplates = promptTemplates;
    }

    public setCodeActionHandler(handler: CodeActionHandler): void {
        this.codeActionHandler = handler;
    }

    public async provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeAction[]> {
        const codeActions: vscode.CodeAction[] = [];

        // Only provide actions when there's a selection
        if (range.isEmpty) {
            return [];
        }

        const selectedText = document.getText(range);

        // Add explain code action
        const explainAction = new vscode.CodeAction('Explain Code', vscode.CodeActionKind.RefactorRewrite);
        explainAction.command = {
            command: 'ai-assistant.explainCode',
            title: 'Explain Code',
            arguments: [document, range, selectedText]
        };
        codeActions.push(explainAction);

        // Add refactor code action
        const refactorAction = new vscode.CodeAction('Refactor Code', vscode.CodeActionKind.RefactorRewrite);
        refactorAction.command = {
            command: 'ai-assistant.refactorCode',
            title: 'Refactor Code',
            arguments: [document, range, selectedText]
        };
        codeActions.push(refactorAction);

        // Add document code action
        const documentAction = new vscode.CodeAction('Document Code', vscode.CodeActionKind.RefactorRewrite);
        documentAction.command = {
            command: 'ai-assistant.documentCode',
            title: 'Document Code',
            arguments: [document, range, selectedText]
        };
        codeActions.push(documentAction);

        return codeActions;
    }

    public async performCodeAction(
        type: 'explain' | 'refactor' | 'document',
        document: vscode.TextDocument,
        range: vscode.Range,
        selectedText: string
    ): Promise<void> {
        try {
            // Get file context
            const fileContext = await this.contextProvider.getContextForDocument(document);

            // Get the appropriate prompt template
            let prompt = '';
            switch (type) {
                case 'explain':
                    prompt = this.promptTemplates.getExplainCodePrompt(fileContext, selectedText);
                    break;
                case 'refactor':
                    prompt = this.promptTemplates.getRefactorCodePrompt(fileContext, selectedText);
                    break;
                case 'document':
                    prompt = this.promptTemplates.getDocumentCodePrompt(fileContext, selectedText);
                    break;
            }

            // Use chat interface if available, otherwise fallback to output panel
            if (this.codeActionHandler) {
                await this.codeActionHandler.handleCodeAction(type, prompt);
            } else {
                await this.showInOutputPanel(type, prompt);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async showInOutputPanel(
        type: 'explain' | 'refactor' | 'document', 
        prompt: string
    ): Promise<void> {
        // Show processing indicator
        const panel = this.createOutputPanel(`CodePilot: ${this.capitalize(type)} Code`);

        // Add stop button to the output panel
        const stopButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
        stopButton.text = "$(debug-stop) Stop Generation";
        stopButton.tooltip = "Stop the current generation";
        stopButton.command = "ai-assistant.stopCurrentGeneration";
        stopButton.show();

        try {
            // Register command to abort generation
            const disposable = vscode.commands.registerCommand("ai-assistant.stopCurrentGeneration", () => {
                if (this.currentRequestId) {
                    this.client.abortRequest(this.currentRequestId);
                    panel.appendLine("\n\n[Generation stopped by user]");
                    disposable.dispose();
                    stopButton.dispose();
                }
            });

            // Stream the response
            panel.appendLine(`Processing ${type} request...\n`);
            panel.appendLine('-'.repeat(50));            

            const { requestId } = await this.client.streamCompletion(prompt, (chunk) => {
                if (chunk === '__END__') {
                    panel.appendLine('\n' + '-'.repeat(50));
                    panel.appendLine(`\nCompleted ${type} request.`);
                    this.currentRequestId = null;
                    disposable.dispose();
                    stopButton.dispose();
                } else if (chunk === '__CANCELLED__') {
                    panel.appendLine('\n' + '-'.repeat(50));
                    panel.appendLine(`\n[Generation stopped by user]`);
                    this.currentRequestId = null;
                    disposable.dispose();
                    stopButton.dispose();
                } else if (chunk.startsWith('__ERROR__')) {
                    panel.appendLine(`\nError: ${chunk.replace('__ERROR__', '')}`);
                    this.currentRequestId = null;
                    disposable.dispose();
                    stopButton.dispose();
                } else {
                    panel.append(chunk);
                }
            });
            
            this.currentRequestId = requestId;

        } catch (error) {
            panel.appendLine(`\nError: ${error instanceof Error ? error.message : String(error)}`);
            stopButton.dispose();
        }
    }

    public stopCurrentGeneration(): boolean {
        if (this.currentRequestId) {
            return this.client.abortRequest(this.currentRequestId);
        }
        return false;
    }

    private createOutputPanel(title: string): vscode.OutputChannel {
        // We can't access existing channels directly through the API
        // Instead, try to create a new one and handle potential reuse internally
        try {
            // If channel with same name exists, VS Code will return the existing one
            const outputChannel = vscode.window.createOutputChannel(title, 'markdown');
            outputChannel.clear();
            outputChannel.show(true);
            return outputChannel;
        } catch (error) {
            console.error(`Error creating output channel: ${error}`);
            // Fallback in case of error
            const fallbackChannel = vscode.window.createOutputChannel(title);
            fallbackChannel.show(true);
            return fallbackChannel;
        }
    }

    private capitalize(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}
