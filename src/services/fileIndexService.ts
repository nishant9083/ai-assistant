import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface FileSymbol {
    name: string;
    kind: vscode.SymbolKind;
    range: vscode.Range;
    detail?: string;
    containerName?: string;
}

export interface FileIndex {
    uri: vscode.Uri;
    fileName: string;
    relativePath: string;
    lastModified: number;
    language: string;
    size: number;
    symbols: FileSymbol[];
    imports: string[];
    exports: string[];
    dependencies: string[];
    content?: string; // Cached for small files
}

export interface WorkspaceIndex {
    files: Map<string, FileIndex>;
    symbolIndex: Map<string, FileIndex[]>; // symbol name -> files that define it
    importIndex: Map<string, FileIndex[]>; // import path -> files that import it
    lastIndexed: number;
}

export class FileIndexService {
    private index: WorkspaceIndex;
    private isIndexing: boolean = false;
    private indexingProgress: vscode.Progress<{ message?: string; increment?: number }> | null = null;
    private readonly maxFileSize = 1024 * 1024; // 1MB max file size to index
    private readonly supportedLanguages = new Set([
        'typescript', 'javascript', 'typescriptreact', 'javascriptreact', 
        'python', 'java', 'csharp', 'go', 'rust', 'cpp', 'c', 'php',
        'ruby', 'swift', 'kotlin', 'scala', 'dart', 'html', 'css', 'scss',
        'json', 'yaml', 'xml', 'markdown'
    ]);

    constructor() {
        this.index = {
            files: new Map(),
            symbolIndex: new Map(),
            importIndex: new Map(),
            lastIndexed: 0
        };

        // Watch for file changes
        this.setupFileWatcher();
    }

    private setupFileWatcher(): void {
        // Watch for file changes and update index
        const watcher = vscode.workspace.createFileSystemWatcher('**/*');
        
        watcher.onDidCreate(uri => this.indexFile(uri));
        watcher.onDidChange(uri => this.indexFile(uri));
        watcher.onDidDelete(uri => this.removeFileFromIndex(uri));
    }

    async buildFullIndex(): Promise<void> {
        if (this.isIndexing) {
            return;
        }

        this.isIndexing = true;

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "CodePilot: Indexing workspace files",
                cancellable: false
            }, async (progress) => {
                this.indexingProgress = progress;
                
                // Clear existing index
                this.index = {
                    files: new Map(),
                    symbolIndex: new Map(),
                    importIndex: new Map(),
                    lastIndexed: Date.now()
                };

                // Find all workspace files
                const workspaceFiles = await vscode.workspace.findFiles(
                    '**/*',
                    '**/node_modules/**'
                );

                const totalFiles = workspaceFiles.length;
                let processedFiles = 0;

                progress.report({ message: `Found ${totalFiles} files`, increment: 0 });

                // Index files in batches
                const batchSize = 10;
                for (let i = 0; i < workspaceFiles.length; i += batchSize) {
                    const batch = workspaceFiles.slice(i, i + batchSize);
                    
                    await Promise.all(batch.map(async (uri) => {
                        try {
                            await this.indexFile(uri, false);
                        } catch (error) {
                            console.warn(`Failed to index ${uri.fsPath}:`, error);
                        }
                    }));

                    processedFiles += batch.length;
                    const percentage = Math.round((processedFiles / totalFiles) * 100);
                    progress.report({ 
                        message: `Indexed ${processedFiles}/${totalFiles} files (${percentage}%)`,
                        increment: (batchSize / totalFiles) * 100
                    });
                }

                // Build symbol and import indices
                this.rebuildSecondaryIndices();

                progress.report({ message: "Indexing complete", increment: 100 });
                this.indexingProgress = null;
            });
        } finally {
            this.isIndexing = false;
        }
    }

    private async indexFile(uri: vscode.Uri, updateSecondaryIndices: boolean = true): Promise<void> {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            
            // Skip if file is too large
            if (stat.size > this.maxFileSize) {
                return;
            }

            // Skip if not a supported language
            const document = await vscode.workspace.openTextDocument(uri);
            if (!this.supportedLanguages.has(document.languageId)) {
                return;
            }

            const fileIndex: FileIndex = {
                uri,
                fileName: path.basename(uri.fsPath),
                relativePath: vscode.workspace.asRelativePath(uri),
                lastModified: stat.mtime,
                language: document.languageId,
                size: stat.size,
                symbols: [],
                imports: [],
                exports: [],
                dependencies: [],
                content: stat.size < 50 * 1024 ? document.getText() : undefined // Cache small files
            };

            // Extract symbols
            try {
                const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                    'vscode.executeDocumentSymbolProvider',
                    uri
                );
                
                if (symbols) {
                    fileIndex.symbols = this.flattenSymbols(symbols);
                }
            } catch (error) {
                // Fallback to basic text analysis if symbol provider fails
                fileIndex.symbols = this.extractSymbolsFromText(document.getText(), document.languageId);
            }

            // Extract imports and exports
            this.extractImportsAndExports(document.getText(), document.languageId, fileIndex);

            // Store in index
            this.index.files.set(uri.fsPath, fileIndex);

            if (updateSecondaryIndices) {
                this.updateSecondaryIndices(fileIndex);
            }

        } catch (error) {
            console.warn(`Failed to index file ${uri.fsPath}:`, error);
        }
    }

    private flattenSymbols(symbols: vscode.DocumentSymbol[], containerName?: string): FileSymbol[] {
        const result: FileSymbol[] = [];

        for (const symbol of symbols) {
            result.push({
                name: symbol.name,
                kind: symbol.kind,
                range: symbol.range,
                detail: symbol.detail,
                containerName
            });

            // Recursively flatten children
            if (symbol.children && symbol.children.length > 0) {
                result.push(...this.flattenSymbols(symbol.children, symbol.name));
            }
        }

        return result;
    }

    private extractSymbolsFromText(text: string, language: string): FileSymbol[] {
        const symbols: FileSymbol[] = [];
        const lines = text.split('\n');

        switch (language) {
            case 'typescript':
            case 'javascript':
            case 'typescriptreact':
            case 'javascriptreact':
                this.extractJSSymbols(lines, symbols);
                break;
            case 'python':
                this.extractPythonSymbols(lines, symbols);
                break;
            // Add more language extractors as needed
        }

        return symbols;
    }

    private extractJSSymbols(lines: string[], symbols: FileSymbol[]): void {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Extract functions
            const functionMatch = trimmed.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
            if (functionMatch) {
                symbols.push({
                    name: functionMatch[1],
                    kind: vscode.SymbolKind.Function,
                    range: new vscode.Range(i, 0, i, line.length)
                });
            }

            // Extract classes
            const classMatch = trimmed.match(/(?:export\s+)?class\s+(\w+)/);
            if (classMatch) {
                symbols.push({
                    name: classMatch[1],
                    kind: vscode.SymbolKind.Class,
                    range: new vscode.Range(i, 0, i, line.length)
                });
            }

            // Extract interfaces (TypeScript)
            const interfaceMatch = trimmed.match(/(?:export\s+)?interface\s+(\w+)/);
            if (interfaceMatch) {
                symbols.push({
                    name: interfaceMatch[1],
                    kind: vscode.SymbolKind.Interface,
                    range: new vscode.Range(i, 0, i, line.length)
                });
            }

            // Extract const/let/var declarations
            const varMatch = trimmed.match(/(?:export\s+)?(?:const|let|var)\s+(\w+)/);
            if (varMatch) {
                symbols.push({
                    name: varMatch[1],
                    kind: vscode.SymbolKind.Variable,
                    range: new vscode.Range(i, 0, i, line.length)
                });
            }
        }
    }

    private extractPythonSymbols(lines: string[], symbols: FileSymbol[]): void {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Extract functions
            const functionMatch = trimmed.match(/def\s+(\w+)/);
            if (functionMatch) {
                symbols.push({
                    name: functionMatch[1],
                    kind: vscode.SymbolKind.Function,
                    range: new vscode.Range(i, 0, i, line.length)
                });
            }

            // Extract classes
            const classMatch = trimmed.match(/class\s+(\w+)/);
            if (classMatch) {
                symbols.push({
                    name: classMatch[1],
                    kind: vscode.SymbolKind.Class,
                    range: new vscode.Range(i, 0, i, line.length)
                });
            }
        }
    }

    private extractImportsAndExports(text: string, language: string, fileIndex: FileIndex): void {
        const lines = text.split('\n');

        switch (language) {
            case 'typescript':
            case 'javascript':
            case 'typescriptreact':
            case 'javascriptreact':
                this.extractJSImportsExports(lines, fileIndex);
                break;
            case 'python':
                this.extractPythonImports(lines, fileIndex);
                break;
        }
    }

    private extractJSImportsExports(lines: string[], fileIndex: FileIndex): void {
        for (const line of lines) {
            const trimmed = line.trim();

            // Extract imports
            const importMatch = trimmed.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/);
            if (importMatch) {
                fileIndex.imports.push(importMatch[1]);
                fileIndex.dependencies.push(importMatch[1]);
            }

            // Extract require statements
            const requireMatch = trimmed.match(/require\(['"]([^'"]+)['"]\)/);
            if (requireMatch) {
                fileIndex.imports.push(requireMatch[1]);
                fileIndex.dependencies.push(requireMatch[1]);
            }

            // Extract exports
            if (trimmed.startsWith('export')) {
                const exportMatch = trimmed.match(/export\s+(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)/);
                if (exportMatch) {
                    fileIndex.exports.push(exportMatch[1]);
                }
            }
        }
    }

    private extractPythonImports(lines: string[], fileIndex: FileIndex): void {
        for (const line of lines) {
            const trimmed = line.trim();

            // Extract imports
            const importMatch = trimmed.match(/import\s+(\w+(?:\.\w+)*)/);
            if (importMatch) {
                fileIndex.imports.push(importMatch[1]);
                fileIndex.dependencies.push(importMatch[1]);
            }

            // Extract from imports
            const fromMatch = trimmed.match(/from\s+(\w+(?:\.\w+)*)\s+import/);
            if (fromMatch) {
                fileIndex.imports.push(fromMatch[1]);
                fileIndex.dependencies.push(fromMatch[1]);
            }
        }
    }

    private updateSecondaryIndices(fileIndex: FileIndex): void {
        // Update symbol index
        for (const symbol of fileIndex.symbols) {
            if (!this.index.symbolIndex.has(symbol.name)) {
                this.index.symbolIndex.set(symbol.name, []);
            }
            const symbolFiles = this.index.symbolIndex.get(symbol.name)!;
            const existingIndex = symbolFiles.findIndex(f => f.uri.fsPath === fileIndex.uri.fsPath);
            if (existingIndex >= 0) {
                symbolFiles[existingIndex] = fileIndex;
            } else {
                symbolFiles.push(fileIndex);
            }
        }

        // Update import index
        for (const importPath of fileIndex.imports) {
            if (!this.index.importIndex.has(importPath)) {
                this.index.importIndex.set(importPath, []);
            }
            const importFiles = this.index.importIndex.get(importPath)!;
            const existingIndex = importFiles.findIndex(f => f.uri.fsPath === fileIndex.uri.fsPath);
            if (existingIndex >= 0) {
                importFiles[existingIndex] = fileIndex;
            } else {
                importFiles.push(fileIndex);
            }
        }
    }

    private rebuildSecondaryIndices(): void {
        this.index.symbolIndex.clear();
        this.index.importIndex.clear();

        for (const fileIndex of this.index.files.values()) {
            this.updateSecondaryIndices(fileIndex);
        }
    }

    private removeFileFromIndex(uri: vscode.Uri): void {
        const fileIndex = this.index.files.get(uri.fsPath);
        if (!fileIndex) {
            return;
        }

        // Remove from main index
        this.index.files.delete(uri.fsPath);

        // Remove from symbol index
        for (const symbol of fileIndex.symbols) {
            const symbolFiles = this.index.symbolIndex.get(symbol.name);
            if (symbolFiles) {
                const index = symbolFiles.findIndex(f => f.uri.fsPath === uri.fsPath);
                if (index >= 0) {
                    symbolFiles.splice(index, 1);
                    if (symbolFiles.length === 0) {
                        this.index.symbolIndex.delete(symbol.name);
                    }
                }
            }
        }

        // Remove from import index
        for (const importPath of fileIndex.imports) {
            const importFiles = this.index.importIndex.get(importPath);
            if (importFiles) {
                const index = importFiles.findIndex(f => f.uri.fsPath === uri.fsPath);
                if (index >= 0) {
                    importFiles.splice(index, 1);
                    if (importFiles.length === 0) {
                        this.index.importIndex.delete(importPath);
                    }
                }
            }
        }
    }

    // Public API methods
    getFileIndex(uri: vscode.Uri): FileIndex | undefined {
        return this.index.files.get(uri.fsPath);
    }

    findSymbol(symbolName: string): FileIndex[] {
        return this.index.symbolIndex.get(symbolName) || [];
    }

    findImporters(importPath: string): FileIndex[] {
        return this.index.importIndex.get(importPath) || [];
    }

    getRelatedFiles(uri: vscode.Uri): FileIndex[] {
        const fileIndex = this.getFileIndex(uri);
        if (!fileIndex) {
            return [];
        }

        const related = new Set<FileIndex>();

        // Add files that import this file
        const fileName = path.basename(uri.fsPath, path.extname(uri.fsPath));
        const relativePath = vscode.workspace.asRelativePath(uri);
        const importers = this.findImporters(fileName) 
            .concat(this.findImporters(relativePath))
            .concat(this.findImporters('./' + relativePath));

        importers.forEach(f => related.add(f));

        // Add files that this file imports
        for (const importPath of fileIndex.imports) {
            const possiblePaths = this.resolveImportPath(importPath, fileIndex);
            for (const possiblePath of possiblePaths) {
                const imported = this.index.files.get(possiblePath);
                if (imported) {
                    related.add(imported);
                }
            }
        }

        // Add files with similar symbols
        for (const symbol of fileIndex.symbols.slice(0, 5)) { // Limit to avoid too many results
            const symbolFiles = this.findSymbol(symbol.name);
            symbolFiles.slice(0, 3).forEach(f => { // Limit to 3 per symbol
                if (f.uri.fsPath !== uri.fsPath) {
                    related.add(f);
                }
            });
        }

        return Array.from(related);
    }

    private resolveImportPath(importPath: string, fromFile: FileIndex): string[] {
        const possibilities: string[] = [];
        const baseDir = path.dirname(fromFile.uri.fsPath);

        if (importPath.startsWith('./') || importPath.startsWith('../')) {
            // Relative import
            const resolved = path.resolve(baseDir, importPath);
            possibilities.push(resolved);
            possibilities.push(resolved + '.ts');
            possibilities.push(resolved + '.js');
            possibilities.push(path.join(resolved, 'index.ts'));
            possibilities.push(path.join(resolved, 'index.js'));
        } else {
            // Module import - could be in node_modules or a file
            // For simplicity, just try as relative path
            const resolved = path.resolve(baseDir, importPath);
            possibilities.push(resolved);
            possibilities.push(resolved + '.ts');
            possibilities.push(resolved + '.js');
        }

        return possibilities.filter(p => this.index.files.has(p));
    }

    getAllFiles(): FileIndex[] {
        return Array.from(this.index.files.values());
    }

    getWorkspaceStats(): { totalFiles: number; totalSymbols: number; languages: string[] } {
        const languages = new Set<string>();
        let totalSymbols = 0;

        for (const fileIndex of this.index.files.values()) {
            languages.add(fileIndex.language);
            totalSymbols += fileIndex.symbols.length;
        }

        return {
            totalFiles: this.index.files.size,
            totalSymbols,
            languages: Array.from(languages).sort()
        };
    }

    isCurrentlyIndexing(): boolean {
        return this.isIndexing;
    }

    getLastIndexedTime(): number {
        return this.index.lastIndexed;
    }
}