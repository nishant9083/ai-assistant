import * as vscode from 'vscode';
import { OllamaClient } from '../ollama/client';
import { ContextProvider } from './contextProvider';
import path from 'path';

export class InlineSuggestionProvider implements vscode.InlineCompletionItemProvider {
    private client: OllamaClient;
    private contextProvider: ContextProvider;
    private enabled: boolean = true;
    private statusBarItem: vscode.StatusBarItem;
    private isProcessing: boolean = false;

    constructor(client: OllamaClient, contextProvider: ContextProvider) {
        this.client = client;
        this.contextProvider = contextProvider;

        // Create status bar item to show when we're generating a suggestion
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.statusBarItem.text = "$(loading~spin) Generating suggestion...";
        this.statusBarItem.tooltip = "AI Assistant is generating a suggestion";        
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {
        if (!this.enabled) {
            return null;
        }

        // Don't generate suggestions if we're already processing one
        if (this.isProcessing) {
            return null;
        }

        try {
            this.isProcessing = true;
            this.statusBarItem.show();

            // Get the current line text
            const linePrefix = document.lineAt(position.line).text.substring(0, position.character);

            // Skip if line is too short or is empty/whitespace
            if (linePrefix.trim().length < 3) {
                return null;
            }

            // Skip if user is typing a comment
            if (linePrefix.trimStart().startsWith('//') || linePrefix.trimStart().startsWith('/*')) {
                return null;
            }

            // Get the text of the current function or block (up to 500 characters before cursor)
            const maxPrefixLength = 500;
            const startPos = new vscode.Position(
                Math.max(0, position.line - 20),
                0
            );
            const blockRange = new vscode.Range(startPos, position);
            const blockPrefix = document.getText(blockRange);

            // Use a shorter context to make it more responsive
            const fileContext = path.basename(document.fileName);

            // Create a prompt focused on continuing the current line/block
            const prompt = `Complete the following code. Continue exactly from where the code ends without repeating anything.
  Respond ONLY with the continuation code - no backticks, no markdown formatting, no explanations.
  
  File: ${fileContext}
  
  Code:
  ${blockPrefix.slice(-maxPrefixLength)}`;

            // Generate a shorter completion with lower temperature for more focused results
            let completion = await this.client.generateCompletion(prompt, {
                max_tokens: 100,
                temperature: 0.1,
                top_p: 0.95,
            });
            // let completion = "console.log('Hello, world!');";

            console.log('Raw completion:', completion);

            // Clean up the completion to remove any markdown formatting
            // completion = this.cleanCompletionText(completion);

            // console.log('Cleaned completion:', completion);

            this.isProcessing = false;
            this.statusBarItem.hide();

            if (!completion || completion.trim().length === 0) {
                return null;
            }

            return [
                new vscode.InlineCompletionItem(
                    completion.toString(),
                    new vscode.Range(position, new vscode.Position(position.line, position.character + completion.length))

                )
            ];
        } catch (error) {
            console.error('Error providing inline completion:', error);
            this.isProcessing = false;
            this.statusBarItem.hide();
            return null;
        }finally{
            this.statusBarItem.hide();
            this.isProcessing = false;
        }
    }

    // Helper method to clean up LLM responses
    private cleanCompletionText(text: string): string {
        // Remove markdown code blocks (```lang and ```)
        text = text.replace(/^```[\w]*\n/gm, '').replace(/```$/gm, '');

        // Remove HTML tags
        // text = text.replace(/<[^>]*>/g, '');

        // If the result starts with a backtick, remove it
        text = text.replace(/^`/g, '');

        // Remove "Here's the continuation" type of phrases
        const prefixesToRemove = [
            "Here's the continuation of the code:",
            "Here's the completion:",
            "Sure, here's the completion:",
            "Continuing your code:",
            "Here's how the code continues:"
        ];

        for (const prefix of prefixesToRemove) {
            if (text.startsWith(prefix)) {
                text = text.substring(prefix.length).trim();
            }
        }

        return text;
    }

    toggleEnabled(): boolean {
        this.enabled = !this.enabled;
        return this.enabled;
    }
}
