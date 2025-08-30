import * as vscode from 'vscode';
import * as path from 'path';
import { FileIndexService, FileIndex } from '../services/fileIndexService';

export interface CodeContext {
    currentFile?: {
        fileName: string;
        relativePath: string;
        language: string;
        content: string;
        cursorPosition?: vscode.Position;
        selectedText?: string;
        symbols: string[];
        imports: string[];
        exports: string[];
    };
    relatedFiles: {
        fileName: string;
        relativePath: string;
        relationship: 'imports' | 'imported_by' | 'similar_symbols' | 'same_directory';
        summary: string;
    }[];
    workspaceContext: {
        projectName?: string;
        mainLanguages: string[];
        dependencies: string[];
        totalFiles: number;
    };
    relevantSymbols: {
        name: string;
        kind: string;
        location: string;
        context: string;
    }[];
}

export class EnhancedContextProvider {
    private fileIndexService: FileIndexService;

    constructor(fileIndexService: FileIndexService) {
        this.fileIndexService = fileIndexService;
    }

    async getEnhancedContext(document?: vscode.TextDocument, position?: vscode.Position): Promise<CodeContext> {
        const context: CodeContext = {
            relatedFiles: [],
            workspaceContext: {
                mainLanguages: [],
                dependencies: [],
                totalFiles: 0
            },
            relevantSymbols: []
        };

        // Get current file context
        const editor = vscode.window.activeTextEditor;
        if (editor && (document || editor.document)) {
            const currentDoc = document || editor.document;
            const currentPos = position || editor.selection.active;
            
            context.currentFile = await this.getCurrentFileContext(currentDoc, currentPos, editor);
            
            // Get related files
            context.relatedFiles = await this.getRelatedFilesContext(currentDoc);
            
            // Get relevant symbols
            context.relevantSymbols = await this.getRelevantSymbols(currentDoc, currentPos);
        }

        // Get workspace context
        context.workspaceContext = await this.getWorkspaceContext();

        return context;
    }

    private async getCurrentFileContext(
        document: vscode.TextDocument, 
        position: vscode.Position,
        editor?: vscode.TextEditor
    ): Promise<CodeContext['currentFile']> {
        const fileIndex = this.fileIndexService.getFileIndex(document.uri);
        
        const context: NonNullable<CodeContext['currentFile']> = {
            fileName: path.basename(document.fileName),
            relativePath: vscode.workspace.asRelativePath(document.uri),
            language: document.languageId,
            content: document.getText(),
            cursorPosition: position,
            symbols: fileIndex?.symbols.map(s => s.name) || [],
            imports: fileIndex?.imports || [],
            exports: fileIndex?.exports || []
        };

        // Add selected text if available
        if (editor && !editor.selection.isEmpty) {
            context.selectedText = document.getText(editor.selection);
        }

        return context;
    }

    private async getRelatedFilesContext(document: vscode.TextDocument): Promise<CodeContext['relatedFiles']> {
        const relatedFiles = this.fileIndexService.getRelatedFiles(document.uri);
        const currentFile = this.fileIndexService.getFileIndex(document.uri);
        
        const context: CodeContext['relatedFiles'] = [];

        for (const relatedFile of relatedFiles.slice(0, 10)) { // Limit to 10 related files
            let relationship: 'imports' | 'imported_by' | 'similar_symbols' | 'same_directory' = 'same_directory';
            
            // Determine relationship
            if (currentFile?.imports.some(imp => this.isImportMatch(imp, relatedFile))) {
                relationship = 'imports';
            } else if (relatedFile.imports.some(imp => this.isImportMatch(imp, currentFile!))) {
                relationship = 'imported_by';
            } else if (this.hasCommonSymbols(currentFile, relatedFile)) {
                relationship = 'similar_symbols';
            }

            // Generate summary
            const summary = this.generateFileSummary(relatedFile);

            context.push({
                fileName: relatedFile.fileName,
                relativePath: relatedFile.relativePath,
                relationship,
                summary
            });
        }

        return context;
    }

    private isImportMatch(importPath: string, fileIndex: FileIndex): boolean {
        const fileName = path.basename(fileIndex.fileName, path.extname(fileIndex.fileName));
        return importPath.includes(fileName) || 
               importPath.includes(fileIndex.relativePath) ||
               importPath === './' + fileIndex.relativePath;
    }

    private hasCommonSymbols(file1: FileIndex | undefined, file2: FileIndex): boolean {
        if (!file1) {
            return false;
        }
        
        const symbols1 = new Set(file1.symbols.map(s => s.name));
        const symbols2 = new Set(file2.symbols.map(s => s.name));
        
        let commonCount = 0;
        for (const symbol of symbols1) {
            if (symbols2.has(symbol)) {
                commonCount++;
                if (commonCount >= 2) {
                    return true; // At least 2 common symbols
                }
            }
        }
        
        return false;
    }

    private generateFileSummary(fileIndex: FileIndex): string {
        const parts: string[] = [];
        
        if (fileIndex.symbols.length > 0) {
            const symbolTypes = new Map<vscode.SymbolKind, string[]>();
            
            for (const symbol of fileIndex.symbols) {
                if (!symbolTypes.has(symbol.kind)) {
                    symbolTypes.set(symbol.kind, []);
                }
                symbolTypes.get(symbol.kind)!.push(symbol.name);
            }

            for (const [kind, names] of symbolTypes) {
                const kindName = this.getSymbolKindName(kind);
                if (names.length <= 3) {
                    parts.push(`${kindName}: ${names.join(', ')}`);
                } else {
                    parts.push(`${kindName}: ${names.slice(0, 3).join(', ')} (+${names.length - 3} more)`);
                }
            }
        }

        if (fileIndex.imports.length > 0) {
            const mainImports = fileIndex.imports.slice(0, 3);
            const importText = mainImports.join(', ');
            parts.push(`Imports: ${importText}${fileIndex.imports.length > 3 ? ` (+${fileIndex.imports.length - 3} more)` : ''}`);
        }

        return parts.join(' | ') || 'No symbols detected';
    }

    private getSymbolKindName(kind: vscode.SymbolKind): string {
        switch (kind) {
            case vscode.SymbolKind.Function: return 'Functions';
            case vscode.SymbolKind.Class: return 'Classes';
            case vscode.SymbolKind.Interface: return 'Interfaces';
            case vscode.SymbolKind.Variable: return 'Variables';
            case vscode.SymbolKind.Constant: return 'Constants';
            case vscode.SymbolKind.Method: return 'Methods';
            case vscode.SymbolKind.Property: return 'Properties';
            case vscode.SymbolKind.Enum: return 'Enums';
            case vscode.SymbolKind.Module: return 'Modules';
            default: return 'Symbols';
        }
    }

    private async getRelevantSymbols(
        document: vscode.TextDocument, 
        position: vscode.Position
    ): Promise<CodeContext['relevantSymbols']> {
        const relevantSymbols: CodeContext['relevantSymbols'] = [];
        
        // Get symbol at cursor position
        const symbolAtCursor = await this.getSymbolAtPosition(document, position);
        if (symbolAtCursor) {
            // Find other files that define or use this symbol
            const symbolFiles = this.fileIndexService.findSymbol(symbolAtCursor.name);
            
            for (const fileIndex of symbolFiles.slice(0, 5)) {
                const symbol = fileIndex.symbols.find(s => s.name === symbolAtCursor.name);
                if (symbol) {
                    relevantSymbols.push({
                        name: symbol.name,
                        kind: this.getSymbolKindName(symbol.kind),
                        location: `${fileIndex.fileName}:${symbol.range.start.line + 1}`,
                        context: symbol.containerName || 'global'
                    });
                }
            }
        }

        return relevantSymbols;
    }

    private async getSymbolAtPosition(document: vscode.TextDocument, position: vscode.Position): Promise<any> {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );

            if (symbols) {
                // Find symbol that contains the position
                for (const symbol of symbols) {
                    if (symbol.location.range.contains(position)) {
                        return symbol;
                    }
                }
            }
        } catch (error) {
            // Fallback: try to extract symbol from text
            const line = document.lineAt(position.line);
            const wordRange = document.getWordRangeAtPosition(position);
            if (wordRange) {
                const word = document.getText(wordRange);
                return { name: word };
            }
        }

        return null;
    }

    private async getWorkspaceContext(): Promise<CodeContext['workspaceContext']> {
        const stats = this.fileIndexService.getWorkspaceStats();
        const context: CodeContext['workspaceContext'] = {
            mainLanguages: stats.languages,
            dependencies: [] as string[],
            totalFiles: stats.totalFiles
        };

        // Try to get project name from package.json
        try {
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                const workspaceFolder = vscode.workspace.workspaceFolders[0];
                const packageJsonUri = vscode.Uri.joinPath(workspaceFolder.uri, 'package.json');
                
                try {
                    const packageJsonContent = await vscode.workspace.fs.readFile(packageJsonUri);
                    const packageJson = JSON.parse(packageJsonContent.toString());
                    context.projectName = packageJson.name;
                    
                    // Extract main dependencies
                    const allDeps = {
                        ...packageJson.dependencies,
                        ...packageJson.devDependencies
                    };
                    context.dependencies = Object.keys(allDeps).slice(0, 10);
                } catch (error) {
                    // package.json doesn't exist or is invalid
                }
            }
        } catch (error) {
            // Ignore errors
        }

        return context;
    }

    // Generate a formatted context string for AI prompts
    async getFormattedContext(document?: vscode.TextDocument, position?: vscode.Position): Promise<string> {
        const context = await this.getEnhancedContext(document, position);
        const parts: string[] = [];

        // Current file context
        if (context.currentFile) {
            parts.push(`## Current File: ${context.currentFile.fileName}`);
            parts.push(`Language: ${context.currentFile.language}`);
            parts.push(`Path: ${context.currentFile.relativePath}`);
            
            if (context.currentFile.symbols.length > 0) {
                parts.push(`Symbols: ${context.currentFile.symbols.slice(0, 10).join(', ')}`);
            }
            
            if (context.currentFile.imports.length > 0) {
                parts.push(`Imports: ${context.currentFile.imports.slice(0, 5).join(', ')}`);
            }

            if (context.currentFile.selectedText) {
                parts.push(`\nSelected Code:\n\`\`\`${context.currentFile.language}\n${context.currentFile.selectedText}\n\`\`\``);
            }
        }

        // Related files
        if (context.relatedFiles.length > 0) {
            parts.push('\n## Related Files:');
            for (const file of context.relatedFiles.slice(0, 5)) {
                parts.push(`- ${file.fileName} (${file.relationship}): ${file.summary}`);
            }
        }

        // Workspace context
        if (context.workspaceContext.totalFiles > 0) {
            parts.push('\n## Workspace Context:');
            if (context.workspaceContext.projectName) {
                parts.push(`Project: ${context.workspaceContext.projectName}`);
            }
            parts.push(`Languages: ${context.workspaceContext.mainLanguages.join(', ')}`);
            parts.push(`Total Files: ${context.workspaceContext.totalFiles}`);
            
            if (context.workspaceContext.dependencies.length > 0) {
                parts.push(`Main Dependencies: ${context.workspaceContext.dependencies.join(', ')}`);
            }
        }

        // Relevant symbols
        if (context.relevantSymbols.length > 0) {
            parts.push('\n## Relevant Symbols:');
            for (const symbol of context.relevantSymbols.slice(0, 5)) {
                parts.push(`- ${symbol.name} (${symbol.kind}) in ${symbol.location}`);
            }
        }

        return parts.join('\n');
    }

    // Get context for specific use cases
    async getInlineCompletionContext(document: vscode.TextDocument, position: vscode.Position): Promise<string> {
        const context = await this.getEnhancedContext(document, position);
        const parts: string[] = [];

        if (context.currentFile) {
            parts.push(`File: ${context.currentFile.fileName} (${context.currentFile.language})`);
            
            // Add surrounding symbols for context
            const fileIndex = this.fileIndexService.getFileIndex(document.uri);
            if (fileIndex) {
                const nearbySymbols = fileIndex.symbols.filter(symbol => 
                    Math.abs(symbol.range.start.line - position.line) <= 10
                );
                
                if (nearbySymbols.length > 0) {
                    parts.push(`Nearby symbols: ${nearbySymbols.map(s => s.name).join(', ')}`);
                }
            }

            // Add recent imports
            if (context.currentFile.imports.length > 0) {
                parts.push(`Available imports: ${context.currentFile.imports.slice(0, 3).join(', ')}`);
            }
        }

        return parts.join('\n');
    }

    async getChatContext(includeFileContents: boolean = false): Promise<string> {
        const context = await this.getEnhancedContext();
        const parts: string[] = [];

        if (context.currentFile) {
            parts.push(`## Current File: ${context.currentFile.fileName}`);
            parts.push(`Language: ${context.currentFile.language}`);
            
            if (includeFileContents) {
                const truncatedContent = context.currentFile.content.length > 2000 
                    ? context.currentFile.content.slice(0, 2000) + '\n... (truncated)'
                    : context.currentFile.content;
                parts.push(`\nContent:\n\`\`\`${context.currentFile.language}\n${truncatedContent}\n\`\`\``);
            }
        }

        // Add related files summary
        if (context.relatedFiles.length > 0) {
            parts.push('\n## Related Files:');
            for (const file of context.relatedFiles.slice(0, 3)) {
                parts.push(`- ${file.fileName}: ${file.summary}`);
            }
        }

        return parts.join('\n');
    }
}