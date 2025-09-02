import * as vscode from 'vscode';
import { OllamaClient } from '../ollama/client';
import { EnhancedContextProvider } from './enhancedContextProvider';
import { FileIndexService } from '../services/fileIndexService';

export class AIHoverProvider implements vscode.HoverProvider {
    private client: OllamaClient;
    private enhancedContextProvider: EnhancedContextProvider;
    private fileIndexService: FileIndexService;
    private hoverCache: Map<string, { content: vscode.MarkdownString; timestamp: number }> = new Map();
    private readonly cacheTTL = 5 * 60 * 1000; // 5 minutes cache

    constructor(
        client: OllamaClient,
        fileIndexService: FileIndexService
    ) {
        this.client = client;
        this.fileIndexService = fileIndexService;
        this.enhancedContextProvider = new EnhancedContextProvider(fileIndexService);
    }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        try {
            // Get word at position
            const wordRange = document.getWordRangeAtPosition(position);
            if (!wordRange) {
                return null;
            }

            const word = document.getText(wordRange);
            
            // Skip common keywords and short words
            if (this.shouldSkipWord(word)) {
                return null;
            }

            // Check if this word is a symbol in our index
            const symbolFiles = this.fileIndexService.findSymbol(word);
            if (symbolFiles.length === 0) {
                return null;
            }

            // Check cache first
            const cacheKey = `${document.uri.fsPath}:${word}:${position.line}`;
            const cached = this.hoverCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
                return new vscode.Hover(cached.content, wordRange);
            }

            // Generate AI-powered hover content
            const hoverContent = await this.generateHoverContent(document, position, word, symbolFiles);
            
            if (hoverContent) {
                // Cache the result
                this.hoverCache.set(cacheKey, { content: hoverContent, timestamp: Date.now() });
                this.cleanCache();
                
                return new vscode.Hover(hoverContent, wordRange);
            }

        } catch (error) {
            console.error('Error providing hover:', error);
        }

        return null;
    }

    private shouldSkipWord(word: string): boolean {
        // Skip common keywords, operators, and short words
        const skipPatterns = [
            /^(if|else|for|while|do|switch|case|break|continue|return|function|class|interface|import|export|from|let|const|var|true|false|null|undefined)$/,
            /^[a-z]{1,2}$/i, // Very short words (1-2 chars)
            /^\d+$/, // Numbers
            /^[^a-zA-Z]/, // Non-alphabetic starts
        ];

        return skipPatterns.some(pattern => pattern.test(word));
    }

    private async generateHoverContent(
        document: vscode.TextDocument,
        position: vscode.Position,
        word: string,
        symbolFiles: any[]
    ): Promise<vscode.MarkdownString | null> {
        try {
            // Get context around the symbol
            const context = await this.enhancedContextProvider.getInlineCompletionContext(document, position);
            
            // Find the definition of this symbol
            const symbolInfo = this.getSymbolInfo(word, symbolFiles, document);
            
            if (!symbolInfo) {
                return null;
            }

            const prompt = `Provide a concise explanation for this code symbol. Be brief but informative.

SYMBOL: ${word}
CONTEXT: ${context}
SYMBOL DEFINITION: ${symbolInfo.definition}
FILE: ${symbolInfo.fileName}

Provide:
1. Brief explanation of what this symbol does/represents
2. Type information (if applicable)
3. Key usage notes or important details
4. Where it's defined

Keep the response concise and focused. Use markdown formatting.`;

            const response = await this.client.generateCompletion(prompt, {
                max_tokens: 200,
                temperature: 0.2,
            });

            const markdown = new vscode.MarkdownString();
            markdown.supportHtml = true;
            markdown.isTrusted = true;

            // Add symbol header
            markdown.appendMarkdown(`### 🤖 AI Insight: \`${word}\`\n\n`);
            
            // Add AI explanation
            markdown.appendMarkdown(response);
            
            // Add symbol location info
            if (symbolInfo.fileName !== document.fileName) {
                markdown.appendMarkdown(`\n\n---\n📍 Defined in: \`${symbolInfo.fileName}\``);
            }
            
            // Add quick actions if applicable
            if (symbolInfo.isFunction) {
                markdown.appendMarkdown(`\n\n[Generate Tests](command:ai-assistant.generateTests) | [Explain Function](command:ai-assistant.explainFunction)`);
            }

            return markdown;

        } catch (error) {
            console.error('Error generating hover content:', error);
            return null;
        }
    }

    private getSymbolInfo(word: string, symbolFiles: any[], currentDocument: vscode.TextDocument): any {
        // Find the most relevant symbol definition
        for (const fileIndex of symbolFiles) {
            const symbol = fileIndex.symbols.find((s: any) => s.name === word);
            if (symbol) {
                // Try to get the actual code definition
                let definition = 'Symbol definition not available';
                
                if (fileIndex.content) {
                    // Extract the line containing the symbol
                    const lines = fileIndex.content.split('\n');
                    if (symbol.range && symbol.range.start && symbol.range.start.line < lines.length) {
                        definition = lines[symbol.range.start.line].trim();
                    }
                }

                return {
                    definition,
                    fileName: fileIndex.fileName,
                    isFunction: symbol.kind === vscode.SymbolKind.Function || symbol.kind === vscode.SymbolKind.Method,
                    isClass: symbol.kind === vscode.SymbolKind.Class,
                    isInterface: symbol.kind === vscode.SymbolKind.Interface,
                    kind: this.getSymbolKindName(symbol.kind),
                    containerName: symbol.containerName
                };
            }
        }

        return null;
    }

    private getSymbolKindName(kind: vscode.SymbolKind): string {
        switch (kind) {
            case vscode.SymbolKind.Function: return 'Function';
            case vscode.SymbolKind.Method: return 'Method';
            case vscode.SymbolKind.Class: return 'Class';
            case vscode.SymbolKind.Interface: return 'Interface';
            case vscode.SymbolKind.Variable: return 'Variable';
            case vscode.SymbolKind.Constant: return 'Constant';
            case vscode.SymbolKind.Property: return 'Property';
            case vscode.SymbolKind.Enum: return 'Enum';
            case vscode.SymbolKind.Module: return 'Module';
            default: return 'Symbol';
        }
    }

    private cleanCache(): void {
        const now = Date.now();
        for (const [key, value] of this.hoverCache.entries()) {
            if (now - value.timestamp > this.cacheTTL) {
                this.hoverCache.delete(key);
            }
        }
    }

    clearCache(): void {
        this.hoverCache.clear();
    }
}