import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface FileCache {
    content: string;
    timestamp: number;
}

export class ContextProvider {
    private cache: Map<string, FileCache> = new Map();
    private cacheTTL = 30000; // 30 seconds cache lifetime

    async getCurrentContext(): Promise<string> {
        let context = '';

        // Get active editor content if available
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const document = editor.document;
            context += `Current file (${path.basename(document.fileName)}):\n${document.getText()}\n\n`;

            // Add current cursor position context
            const selection = editor.selection;
            if (!selection.isEmpty) {
                const selectedText = document.getText(selection);
                context += `Selected code: ${selectedText}\n\n`;
            }

            // Add surrounding code context
            const cursorPosition = selection.active;
            const startLine = Math.max(0, cursorPosition.line - 10);
            const endLine = Math.min(document.lineCount - 1, cursorPosition.line + 10);

            if (startLine > 0 || endLine < document.lineCount - 1) {
                context += `Surrounding code (lines ${startLine + 1}-${endLine + 1}):\n`;
                for (let i = startLine; i <= endLine; i++) {
                    const line = document.lineAt(i);
                    if (i === cursorPosition.line) {
                        context += `> ${line.text}\n`; // Mark current line
                    } else {
                        context += `  ${line.text}\n`;
                    }
                }
                context += '\n';
            }
        }

        // Add workspace info
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const workspaceFolder = vscode.workspace.workspaceFolders[0];
            context += `Workspace: ${workspaceFolder.name}\n`;

            // Add package.json info if available
            try {
                const packageJsonPath = path.join(workspaceFolder.uri.fsPath, 'package.json');
                if (fs.existsSync(packageJsonPath)) {
                    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                    context += `Project: ${packageJson.name}@${packageJson.version}\n`;

                    if (packageJson.dependencies || packageJson.devDependencies) {
                        context += `Main dependencies: ${Object.keys({
                            ...packageJson.dependencies,
                            ...packageJson.devDependencies
                        }).slice(0, 10).join(', ')}...\n`;
                    }
                }
            } catch (error) {
                // Ignore package.json errors
            }
        }

        return context;
    }

    async getContextForDocument(document: vscode.TextDocument): Promise<string> {
        // Get file info
        const fileName = path.basename(document.fileName);
        const fileExt = path.extname(document.fileName);
        const filePath = document.fileName;

        let context = `File: ${fileName} (${fileExt})\n`;
        context += `Path: ${filePath}\n\n`;

        // Add file structure information
        const text = document.getText();

        // Language-specific extraction
        switch (fileExt.toLowerCase()) {
            case '.ts':
            case '.tsx':
            case '.js':
            case '.jsx':
                context += this.getJavaScriptContext(text);
                break;
            case '.py':
                context += this.getPythonContext(text);
                break;
            case '.java':
            case '.kt':
                context += this.getJavaContext(text);
                break;
            case '.json':
                context += this.getJSONContext(text);
                break;
            default:
                // Generic extraction
                context += this.getGenericFileContext(text);
        }

        // Add related files
        const relatedFiles = await this.findRelatedFiles(document);
        if (relatedFiles.length > 0) {
            context += `\nRelated files:\n${relatedFiles.map(file => `- ${file}`).join('\n')}\n`;
        }

        return context;
    }

    private getJavaScriptContext(text: string): string {
        const lines = text.split('\n');
        let context = '';

        // Extract imports
        const imports = lines
            .filter(line => line.includes('import') || line.includes('require'))
            .join('\n');

        if (imports) {
            context += `Imports/Dependencies:\n${imports}\n\n`;
        }

        // Extract classes
        const classMatches = text.match(/class\s+(\w+)/g);
        if (classMatches && classMatches.length > 0) {
            context += `Classes: ${classMatches.map(c => c.replace('class ', '')).join(', ')}\n`;
        }

        // Extract functions
        const functionMatches = text.match(/function\s+(\w+)|(\w+)\s*=\s*function|(\w+)\s*=\s*\(.*?\)\s*=>/g);
        if (functionMatches && functionMatches.length > 0) {
            context += `Functions: ${functionMatches.join(', ')}\n`;
        }

        // Extract exports
        const exportMatches = text.match(/export\s+(const|let|var|function|class|default|{)/g);
        if (exportMatches && exportMatches.length > 0) {
            context += `Exports: ${exportMatches.length} exports found\n`;
        }

        return context;
    }

    private getPythonContext(text: string): string {
        const lines = text.split('\n');
        let context = '';

        // Extract imports
        const imports = lines
            .filter(line => line.trim().startsWith('import') || line.trim().startsWith('from'))
            .join('\n');

        if (imports) {
            context += `Imports:\n${imports}\n\n`;
        }

        // Extract classes
        const classMatches = text.match(/class\s+(\w+)/g);
        if (classMatches && classMatches.length > 0) {
            context += `Classes: ${classMatches.map(c => c.replace('class ', '')).join(', ')}\n`;
        }

        // Extract functions
        const functionMatches = text.match(/def\s+(\w+)/g);
        if (functionMatches && functionMatches.length > 0) {
            context += `Functions: ${functionMatches.map(f => f.replace('def ', '')).join(', ')}\n`;
        }

        return context;
    }

    private getJavaContext(text: string): string {
        const lines = text.split('\n');
        let context = '';

        // Extract imports
        const imports = lines
            .filter(line => line.trim().startsWith('import'))
            .join('\n');

        if (imports) {
            context += `Imports:\n${imports}\n\n`;
        }

        // Extract package
        const packageMatch = text.match(/package\s+([\w.]+);/);
        if (packageMatch) {
            context += `Package: ${packageMatch[1]}\n`;
        }

        // Extract classes
        const classMatches = text.match(/class\s+(\w+)/g);
        if (classMatches && classMatches.length > 0) {
            context += `Classes: ${classMatches.map(c => c.replace('class ', '')).join(', ')}\n`;
        }

        return context;
    }

    private getJSONContext(text: string): string {
        try {
            const json = JSON.parse(text);
            const keys = Object.keys(json);
            return `JSON with ${keys.length} top-level keys: ${keys.join(', ')}\n`;
        } catch (error) {
            return 'Invalid or complex JSON file\n';
        }
    }

    private getGenericFileContext(text: string): string {
        const lines = text.split('\n');
        return `File with ${lines.length} lines\n`;
    }

    async getWorkspaceContext(): Promise<string> {
        if (!vscode.workspace.workspaceFolders) {
            return 'No workspace open';
        }

        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        const rootPath = workspaceFolder.uri.fsPath;

        let context = `Workspace: ${workspaceFolder.name}\n`;
        context += `Root path: ${rootPath}\n\n`;

        // Get project structure summary
        try {
            // Collect key project files
            const projectFiles = await this.collectProjectFiles(rootPath);
            if (projectFiles.length > 0) {
                context += `Key project files:\n${projectFiles.join('\n')}\n\n`;
            }

            // Add project structure summary
            const dirStructure = await this.getDirectoryStructureSummary(rootPath);
            context += `Project structure summary:\n${dirStructure}\n`;
        } catch (error) {
            context += `Error analyzing project structure: ${error}\n`;
        }

        return context;
    }

    private async collectProjectFiles(rootPath: string): Promise<string[]> {
        const keyFiles = ['package.json', 'tsconfig.json', '.gitignore', 'README.md'];
        const result: string[] = [];

        for (const file of keyFiles) {
            const filePath = path.join(rootPath, file);
            if (fs.existsSync(filePath)) {
                result.push(`- ${file}`);
            }
        }

        return result;
    }

    private async getDirectoryStructureSummary(rootPath: string, maxDepth: number = 2): Promise<string> {
        const ignoreDirs = ['node_modules', '.git', '.vscode', 'dist', 'out'];

        const processDir = (dirPath: string, depth: number = 0): string => {
            if (depth > maxDepth) { return ''; }

            let result = '';
            const indent = '  '.repeat(depth);

            try {
                const items = fs.readdirSync(dirPath);

                // Process directories first
                const dirs = items
                    .filter(item => {
                        const fullPath = path.join(dirPath, item);
                        return fs.statSync(fullPath).isDirectory() && !ignoreDirs.includes(item);
                    })
                    .sort();

                // Then files (limited number)
                const files = items
                    .filter(item => {
                        const fullPath = path.join(dirPath, item);
                        return fs.statSync(fullPath).isFile();
                    })
                    .sort()
                    .slice(0, 5); // Limit to 5 files per directory

                // Add directories
                for (const dir of dirs) {
                    result += `${indent}- ${dir}/\n`;
                    result += processDir(path.join(dirPath, dir), depth + 1);
                }

                // Add files
                for (const file of files) {
                    result += `${indent}- ${file}\n`;
                }

                // Show if there are more files
                if (items.length > dirs.length + files.length) {
                    result += `${indent}  (${items.length - dirs.length - files.length} more items)\n`;
                }
            } catch (error) {
                result += `${indent}Error reading directory\n`;
            }

            return result;
        };

        return processDir(rootPath);
    }

    private async findRelatedFiles(document: vscode.TextDocument): Promise<string[]> {
        const fileName = path.basename(document.fileName, path.extname(document.fileName));
        const dirPath = path.dirname(document.fileName);
        const result: string[] = [];

        try {
            const items = fs.readdirSync(dirPath);

            // Find files with the same base name but different extension
            for (const item of items) {
                const itemBaseName = path.basename(item, path.extname(item));
                if (itemBaseName === fileName && item !== path.basename(document.fileName)) {
                    result.push(item);
                }
            }

            // Find "index" files in the same directory
            if (fileName !== 'index') {
                for (const item of items) {
                    if (item.startsWith('index.')) {
                        result.push(item);
                    }
                }
            }

            // Look for files that might import this one (simple text search)
            const currentFileName = path.basename(document.fileName);
            const workspaceFiles = await vscode.workspace.findFiles('**/*.*', '**/node_modules/**');

            for (const file of workspaceFiles.slice(0, 20)) { // Limit search to 20 files
                if (file.fsPath === document.fileName) { continue; }

                try {
                    const cachedContent = this.getCachedFile(file.fsPath);
                    if (cachedContent && cachedContent.includes(currentFileName)) {
                        result.push(path.relative(dirPath, file.fsPath));
                    }
                } catch (error) {
                    // Skip files that can't be read
                }
            }
        } catch (error) {
            // Ignore directory read errors
        }

        return result.slice(0, 10); // Limit to 10 related files
    }

    private getCachedFile(filePath: string): string | null {
        const now = Date.now();
        const cached = this.cache.get(filePath);

        if (cached && now - cached.timestamp < this.cacheTTL) {
            return cached.content;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            this.cache.set(filePath, { content, timestamp: now });
            return content;
        } catch (error) {
            return null;
        }
    }

    clearCache(): void {
        this.cache.clear();
    }
}
