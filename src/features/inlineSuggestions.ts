import * as vscode from 'vscode';
import { OllamaClient } from '../ollama/client';
import { ContextProvider } from './contextProvider';
import { EnhancedContextProvider } from './enhancedContextProvider';
import { FileIndexService } from '../services/fileIndexService';
import path from 'path';

export class InlineSuggestionProvider implements vscode.InlineCompletionItemProvider {
    private client: OllamaClient;
    private contextProvider: ContextProvider;
    private enhancedContextProvider: EnhancedContextProvider;
    private fileIndexService: FileIndexService;
    private enabled: boolean = true;
    private statusBarItem: vscode.StatusBarItem;
    private isProcessing: boolean = false;
    private lastSuggestionTime: number = 0;
    private suggestionCache: Map<string, { completion: string; timestamp: number }> = new Map();
    private readonly cacheTTL = 30000; // 30 seconds cache
    private readonly minDelay = 500; // Minimum delay between suggestions

    constructor(
        client: OllamaClient, 
        contextProvider: ContextProvider,
        fileIndexService: FileIndexService
    ) {
        this.client = client;
        this.contextProvider = contextProvider;
        this.fileIndexService = fileIndexService;
        this.enhancedContextProvider = new EnhancedContextProvider(fileIndexService);

        // Create status bar item to show when we're generating a suggestion
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.statusBarItem.text = "$(loading~spin) Generating suggestion...";
        this.statusBarItem.tooltip = "CodePilot is generating a suggestion";        
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

        // Rate limiting - don't generate suggestions too frequently
        const now = Date.now();
        if (now - this.lastSuggestionTime < this.minDelay) {
            return null;
        }

        try {
            this.isProcessing = true;
            this.lastSuggestionTime = now;
            this.statusBarItem.show();

            // Get the current line text
            const linePrefix = document.lineAt(position.line).text.substring(0, position.character);
            const lineSuffix = document.lineAt(position.line).text.substring(position.character);

            // Enhanced filtering for when to provide suggestions
            if (!this.shouldProvideSuggestion(linePrefix, lineSuffix, document, position)) {
                return null;
            }

            // Check cache first
            const cacheKey = this.generateCacheKey(document, position, linePrefix);
            const cached = this.suggestionCache.get(cacheKey);
            if (cached && now - cached.timestamp < this.cacheTTL) {
                this.isProcessing = false;
                this.statusBarItem.hide();
                if (cached.completion) {
                    return [new vscode.InlineCompletionItem(cached.completion)];
                }
                return null;
            }

            // Get enhanced context
            const enhancedContext = await this.enhancedContextProvider.getInlineCompletionContext(document, position);

            // Get surrounding code with better context window
            const contextLines = this.getContextWindow(document, position);

            // Create an improved prompt
            const prompt = this.createEnhancedPrompt(
                document, 
                position, 
                linePrefix, 
                lineSuffix,
                contextLines,
                enhancedContext
            );

            // Generate completion with optimized parameters
            let completion = await this.client.generateCompletion(prompt, {
                max_tokens: this.getMaxTokensForContext(linePrefix),
                temperature: 0.1,
                top_p: 0.9,
                top_k: 50,
            });

            console.log('Raw completion:', completion);

            // Enhanced completion cleaning
            completion = this.cleanAndValidateCompletion(completion, linePrefix, lineSuffix, document.languageId);

            // Cache the result
            this.suggestionCache.set(cacheKey, { completion, timestamp: now });
            this.cleanCache(); // Clean old cache entries

            this.isProcessing = false;
            this.statusBarItem.hide();

            if (!completion || completion.trim().length === 0) {
                return null;
            }

            return [new vscode.InlineCompletionItem(completion)];
        } catch (error) {
            console.error('Error providing inline completion:', error);
            this.isProcessing = false;
            this.statusBarItem.hide();
            return null;
        } finally {
            this.statusBarItem.hide();
            this.isProcessing = false;
        }
    }

    private shouldProvideSuggestion(
        linePrefix: string, 
        lineSuffix: string, 
        document: vscode.TextDocument, 
        position: vscode.Position
    ): boolean {
        const trimmedPrefix = linePrefix.trim();
        
        // Skip if line is too short
        if (trimmedPrefix.length < 2) {
            return false;
        }

        // Skip if we're in the middle of a word (has suffix that's not whitespace/punctuation)
        if (lineSuffix && /^\w/.test(lineSuffix)) {
            return false;
        }

        // Skip if user is typing a comment
        if (trimmedPrefix.startsWith('//') || trimmedPrefix.startsWith('/*') || trimmedPrefix.startsWith('#')) {
            return false;
        }

        // Skip if we're in a string literal (basic check)
        const inString = this.isInStringLiteral(linePrefix);
        if (inString) {
            return false;
        }

        // Skip if line ends with complete statement punctuation
        if (/[;{}]\s*$/.test(linePrefix)) {
            return false;
        }

        // Good contexts for suggestions
        const goodContexts = [
            /\.\s*$/, // After dot (method/property access)
            /=\s*$/, // After assignment
            /\(\s*$/, // After opening parenthesis
            /,\s*$/, // After comma
            /:\s*$/, // After colon (type annotation, object property)
            /\s+\w+$/, // Typing a word
            /if\s*\(\s*$/, // After if condition start
            /for\s*\(\s*$/, // After for loop start
            /function\s*\w*\s*\(\s*$/, // Function parameters
            /=>\s*$/, // Arrow function
        ];

        return goodContexts.some(pattern => pattern.test(linePrefix));
    }

    private isInStringLiteral(text: string): boolean {
        let inSingleQuote = false;
        let inDoubleQuote = false;
        let inBacktick = false;
        let escaped = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            
            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === '\\') {
                escaped = true;
                continue;
            }

            if (char === "'" && !inDoubleQuote && !inBacktick) {
                inSingleQuote = !inSingleQuote;
            } else if (char === '"' && !inSingleQuote && !inBacktick) {
                inDoubleQuote = !inDoubleQuote;
            } else if (char === '`' && !inSingleQuote && !inDoubleQuote) {
                inBacktick = !inBacktick;
            }
        }

        return inSingleQuote || inDoubleQuote || inBacktick;
    }

    private getContextWindow(document: vscode.TextDocument, position: vscode.Position): string {
        const maxLines = 15;
        const startLine = Math.max(0, position.line - maxLines);
        const endLine = Math.min(document.lineCount - 1, position.line + 5);

        const lines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
            const line = document.lineAt(i);
            if (i === position.line) {
                // Mark current cursor position
                const beforeCursor = line.text.substring(0, position.character);
                const afterCursor = line.text.substring(position.character);
                lines.push(beforeCursor + '|CURSOR|' + afterCursor);
            } else {
                lines.push(line.text);
            }
        }

        return lines.join('\n');
    }

    private createEnhancedPrompt(
        document: vscode.TextDocument,
        position: vscode.Position,
        linePrefix: string,
        lineSuffix: string,
        contextLines: string,
        enhancedContext: string
    ): string {
        const language = document.languageId;
        const fileName = path.basename(document.fileName);

        return `You are an AI code completion assistant. Complete the code at the cursor position marked with |CURSOR|.

CONTEXT:
${enhancedContext}

FILE: ${fileName} (${language})

CODE WITH CURSOR:
\`\`\`${language}
${contextLines}
\`\`\`

RULES:
1. Complete ONLY from the cursor position - never repeat existing code
2. Provide syntactically correct ${language} code
3. Match the existing code style and patterns
4. Keep completions concise and relevant
5. Do not include explanations or markdown formatting
6. Stop at natural completion points (semicolons, closing braces, etc.)

COMPLETION:`;
    }

    private getMaxTokensForContext(linePrefix: string): number {
        // Adjust max tokens based on context
        if (linePrefix.includes('function') || linePrefix.includes('=>')) {
            return 150; // More tokens for function bodies
        } else if (linePrefix.includes('.') || linePrefix.includes('(')) {
            return 50; // Shorter for method calls or parameters
        } else {
            return 100; // Default
        }
    }

    private cleanAndValidateCompletion(
        completion: string, 
        linePrefix: string, 
        lineSuffix: string, 
        language: string
    ): string {
        if (!completion) {
            return '';
        }

        // Remove markdown formatting
        completion = completion.replace(/^```[\w]*\n/gm, '').replace(/```$/gm, '');
        completion = completion.replace(/^`/g, '').replace(/`$/g, '');

        // Remove explanatory text
        const explanatoryPrefixes = [
            "Here's the completion:",
            "Here's the continuation:",
            "The completion is:",
            "Continuing the code:",
            "COMPLETION:",
            "The code completes to:",
        ];

        for (const prefix of explanatoryPrefixes) {
            if (completion.toLowerCase().startsWith(prefix.toLowerCase())) {
                completion = completion.substring(prefix.length).trim();
            }
        }

        // Remove any text after natural stopping points if it looks like explanation
        const naturalStops = ['\n\n', '// ', '/* ', '# '];
        for (const stop of naturalStops) {
            const stopIndex = completion.indexOf(stop);
            if (stopIndex > 0) {
                const beforeStop = completion.substring(0, stopIndex);
                const afterStop = completion.substring(stopIndex + stop.length);
                
                // If what comes after looks like explanation (contains explanation keywords)
                if (this.looksLikeExplanation(afterStop)) {
                    completion = beforeStop;
                    break;
                }
            }
        }

        // Language-specific cleaning
        completion = this.languageSpecificCleaning(completion, language);

        // Ensure we don't repeat the line prefix
        if (completion.startsWith(linePrefix.trim())) {
            completion = completion.substring(linePrefix.trim().length);
        }

        // Trim and validate
        completion = completion.trim();

        // Basic validation
        if (completion.length > 500) {
            completion = completion.substring(0, 500);
        }

        return completion;
    }

    private looksLikeExplanation(text: string): boolean {
        const explanationKeywords = [
            'this will', 'this creates', 'this function', 'this method',
            'explanation:', 'note:', 'in this', 'the above', 'as you can see'
        ];
        
        const lowerText = text.toLowerCase();
        return explanationKeywords.some(keyword => lowerText.includes(keyword));
    }

    private languageSpecificCleaning(completion: string, language: string): string {
        switch (language) {
            case 'typescript':
            case 'javascript':
            case 'typescriptreact':
            case 'javascriptreact':
                // Remove incomplete JSX tags or malformed syntax
                completion = completion.replace(/(<[^>]*$|^[^<]*>)/g, '');
                break;
                
            case 'python':
                // Ensure proper indentation for Python
                const lines = completion.split('\n');
                if (lines.length > 1) {
                    // Check if first line establishes indentation
                    const firstLineIndent = lines[0].match(/^\s*/)?.[0] || '';
                    completion = lines.map((line, i) => 
                        i === 0 ? line : firstLineIndent + line.replace(/^\s*/, '')
                    ).join('\n');
                }
                break;
        }

        return completion;
    }

    private generateCacheKey(document: vscode.TextDocument, position: vscode.Position, linePrefix: string): string {
        return `${document.uri.fsPath}:${position.line}:${position.character}:${linePrefix.slice(-20)}`;
    }

    private cleanCache(): void {
        const now = Date.now();
        for (const [key, value] of this.suggestionCache.entries()) {
            if (now - value.timestamp > this.cacheTTL) {
                this.suggestionCache.delete(key);
            }
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
