import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface ContextFile {
    uri: vscode.Uri;
    relativePath: string;
    isSelected: boolean;
}

export class FileContextSelector {
    private contextFiles: ContextFile[] = [];
    private maxFileSize = 100 * 1024; // 100KB
    private maxTotalSize = 500 * 1024; // 500KB
    
    constructor() {
        this.refreshContextFiles();
    }
    
    public async refreshContextFiles(): Promise<void> {
        this.contextFiles = [];
        
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return;
        }
        
        const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const workspaceFilesUris = await vscode.workspace.findFiles(
            '**/*.{ts,js,jsx,tsx,json,md,py,html,css,scss,less,xml,yaml,yml,sh,txt,c,cs,java,php,rb,go,swift,kt,sql,graphql,mdx}', 
            '**/node_modules/**'
        );
        
        this.contextFiles = workspaceFilesUris.map(uri => ({
            uri,
            relativePath: path.relative(rootPath, uri.fsPath),
            isSelected: false
        }));
        
        // Auto-select the most relevant files
        const activeEditorPath = vscode.window.activeTextEditor?.document.uri.fsPath;
        if (activeEditorPath) {
            const activeFileName = path.basename(activeEditorPath);
            const activeDir = path.dirname(activeEditorPath);
            
            // Select files in the same directory
            this.contextFiles.forEach(file => {
                const fileDir = path.dirname(file.uri.fsPath);
                if (fileDir === activeDir) {
                    file.isSelected = true;
                }
            });
            
            // Try to find related config files
            if (activeFileName.endsWith('.ts') || activeFileName.endsWith('.js')) {
                const configFiles = this.contextFiles.filter(file => {
                    const fileName = path.basename(file.uri.fsPath);
                    return fileName === 'tsconfig.json' || fileName === 'package.json';
                });
                
                configFiles.forEach(file => {
                    file.isSelected = true;
                });
            }
        }
    }
    
    public async selectFiles(): Promise<boolean> {
        const selectedFilesBeforeDialog = this.contextFiles.filter(f => f.isSelected);
        
        // Group files by directories for better organization
        const filesByDir = this.groupFilesByDirectory();
        
        // Create quick pick items for each file
        const items = this.createQuickPickItems(filesByDir);
        
        // Show quick pick with multi-select
        const selectedItems = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: 'Select files to include in the context',
            title: 'CodePilot - Context Files',
            ignoreFocusOut: true
        });
        
        // Update selection state
        if (selectedItems) {
            // Reset all files
            this.contextFiles.forEach(file => file.isSelected = false);
            
            // Set selected files
            for (const item of selectedItems) {
                if (item.type === 'file') {
                    const file = this.contextFiles.find(f => f.relativePath === item.id);
                    if (file) {
                        file.isSelected = true;
                    }
                } else if (item.type === 'directory') {
                    // Select all files in the directory
                    const dirFiles = this.contextFiles.filter(f => 
                        f.relativePath.startsWith(item.id + path.sep));
                    
                    dirFiles.forEach(file => file.isSelected = true);
                }
            }
            
            return true;
        }
        
        // If user canceled, restore previous selection
        this.contextFiles.forEach(file => {
            file.isSelected = selectedFilesBeforeDialog.some(f => 
                f.relativePath === file.relativePath);
        });
        
        return false;
    }
    
    private groupFilesByDirectory(): Map<string, ContextFile[]> {
        const filesByDir = new Map<string, ContextFile[]>();
        
        for (const file of this.contextFiles) {
            const dirPath = path.dirname(file.relativePath);
            
            if (!filesByDir.has(dirPath)) {
                filesByDir.set(dirPath, []);
            }
            
            filesByDir.get(dirPath)?.push(file);
        }
        
        return filesByDir;
    }
    
    private createQuickPickItems(filesByDir: Map<string, ContextFile[]>): Array<vscode.QuickPickItem & { type: 'file' | 'directory', id: string }> {
        const items: Array<vscode.QuickPickItem & { type: 'file' | 'directory', id: string }> = [];
        
        // Add directories
        for (const [dirPath, files] of filesByDir.entries()) {
            const dirName = dirPath === '.' ? '/ (root)' : dirPath;
            const allFilesSelected = files.every(f => f.isSelected);
            
            items.push({
                label: `$(folder) ${dirName}`,
                description: `(${files.length} files)`,
                picked: allFilesSelected,
                type: 'directory',
                id: dirPath
            });
            
            // Add files in this directory
            for (const file of files) {
                items.push({
                    label: `$(file) ${path.basename(file.relativePath)}`,
                    description: file.relativePath,
                    picked: file.isSelected,
                    type: 'file',
                    id: file.relativePath
                });
            }
        }
        
        return items;
    }
    
    public async getSelectedFilesContent(): Promise<string> {
        let content = '';
        let totalSize = 0;
        
        const selectedFiles = this.contextFiles.filter(file => file.isSelected);
        
        if (selectedFiles.length === 0) {
            return 'No context files selected.';
        }
        
        content += `Including ${selectedFiles.length} files as context:\n\n`;
        
        for (const file of selectedFiles) {
            try {
                // Check if file isn't too large
                const stats = fs.statSync(file.uri.fsPath);
                if (stats.size > this.maxFileSize) {
                    content += `File ${file.relativePath} is too large (${Math.round(stats.size / 1024)}KB).\n\n`;
                    continue;
                }
                
                // Check if we're not exceeding total size
                if (totalSize + stats.size > this.maxTotalSize) {
                    content += `Stopping context collection as max size reached (${Math.round(this.maxTotalSize / 1024)}KB).\n\n`;
                    break;
                }
                
                const fileContent = fs.readFileSync(file.uri.fsPath, 'utf8');
                content += `--- File: ${file.relativePath} ---\n\n`;
                content += fileContent + '\n\n';
                
                totalSize += stats.size;
            } catch (error) {
                content += `Error reading ${file.relativePath}: ${error instanceof Error ? error.message : String(error)}\n\n`;
            }
        }
        
        return content;
    }
    
    public getSelectedFilesCount(): number {
        return this.contextFiles.filter(file => file.isSelected).length;
    }
}
