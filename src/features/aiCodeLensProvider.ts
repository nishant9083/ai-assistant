import * as vscode from 'vscode';
import { OllamaClient } from '../ollama/client';
import { EnhancedContextProvider } from './enhancedContextProvider';
import { FileIndexService } from '../services/fileIndexService';

export class AICodeLensProvider implements vscode.CodeLensProvider {
    private client: OllamaClient;
    private enhancedContextProvider: EnhancedContextProvider;
    private fileIndexService: FileIndexService;
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor(
        client: OllamaClient,
        fileIndexService: FileIndexService
    ) {
        this.client = client;
        this.fileIndexService = fileIndexService;
        this.enhancedContextProvider = new EnhancedContextProvider(fileIndexService);
    }

    provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];

        try {
            const fileIndex = this.fileIndexService.getFileIndex(document.uri);
            if (!fileIndex) {
                return codeLenses;
            }

            // Add code lenses for functions
            for (const symbol of fileIndex.symbols) {
                if (symbol.kind === vscode.SymbolKind.Function || 
                    symbol.kind === vscode.SymbolKind.Method) {
                    
                    // Add "AI Explain" lens
                    codeLenses.push(new vscode.CodeLens(symbol.range, {
                        title: "🤖 AI Explain",
                        command: "ai-assistant.explainFunction",
                        arguments: [document.uri, symbol.range, symbol.name]
                    }));

                    // Add "Generate Tests" lens
                    codeLenses.push(new vscode.CodeLens(symbol.range, {
                        title: "🧪 Generate Tests",
                        command: "ai-assistant.generateTests",
                        arguments: [document.uri, symbol.range, symbol.name]
                    }));

                    // Add "Optimize" lens for longer functions
                    if (symbol.range.end.line - symbol.range.start.line > 10) {
                        codeLenses.push(new vscode.CodeLens(symbol.range, {
                            title: "⚡ AI Optimize",
                            command: "ai-assistant.optimizeFunction",
                            arguments: [document.uri, symbol.range, symbol.name]
                        }));
                    }
                }

                // Add lenses for classes
                if (symbol.kind === vscode.SymbolKind.Class) {
                    codeLenses.push(new vscode.CodeLens(symbol.range, {
                        title: "📝 Generate Docs",
                        command: "ai-assistant.generateClassDocs",
                        arguments: [document.uri, symbol.range, symbol.name]
                    }));

                    codeLenses.push(new vscode.CodeLens(symbol.range, {
                        title: "🔍 Suggest Improvements",
                        command: "ai-assistant.suggestClassImprovements",
                        arguments: [document.uri, symbol.range, symbol.name]
                    }));
                }

                // Add lenses for interfaces (TypeScript)
                if (symbol.kind === vscode.SymbolKind.Interface) {
                    codeLenses.push(new vscode.CodeLens(symbol.range, {
                        title: "🏭 Generate Implementation",
                        command: "ai-assistant.generateInterfaceImplementation",
                        arguments: [document.uri, symbol.range, symbol.name]
                    }));
                }
            }

            // Add file-level code lenses
            this.addFileLevelCodeLenses(document, codeLenses);

        } catch (error) {
            console.error('Error providing code lenses:', error);
        }

        return codeLenses;
    }

    private addFileLevelCodeLenses(document: vscode.TextDocument, codeLenses: vscode.CodeLens[]): void {
        // Add "AI Review" lens at the top of the file
        codeLenses.push(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
            title: "🔍 AI Code Review",
            command: "ai-assistant.reviewFile",
            arguments: [document.uri]
        }));

        // Add "Next Edit" lens
        codeLenses.push(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
            title: "✨ Suggest Next Edit",
            command: "ai-assistant.suggestNextEdit",
            arguments: [document.uri]
        }));

        // Add "Generate README" lens for TypeScript/JavaScript files without README
        if ((document.languageId === 'typescript' || document.languageId === 'javascript') &&
            !this.hasReadmeInDirectory(document.uri)) {
            codeLenses.push(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                title: "📚 Generate README",
                command: "ai-assistant.generateReadme",
                arguments: [document.uri]
            }));
        }

        // Add "Check Security" lens for larger files
        if (document.lineCount > 50) {
            codeLenses.push(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                title: "🔒 Security Check",
                command: "ai-assistant.securityCheck",
                arguments: [document.uri]
            }));
        }
    }

    private hasReadmeInDirectory(fileUri: vscode.Uri): boolean {
        // Simple check - could be enhanced to actually check filesystem
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
        if (!workspaceFolder) {
            return false;
        }

        // This is a simplified check; in practice, you'd want to check if README exists
        return false; // For now, always suggest README generation
    }

    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }
}

// Register the commands that the code lenses use
export function registerCodeLensCommands(
    context: vscode.ExtensionContext,
    client: OllamaClient,
    fileIndexService: FileIndexService
): void {
    const enhancedContextProvider = new EnhancedContextProvider(fileIndexService);

    // Explain Function
    const explainFunctionCommand = vscode.commands.registerCommand(
        'ai-assistant.explainFunction',
        async (uri: vscode.Uri, range: vscode.Range, functionName: string) => {
            const document = await vscode.workspace.openTextDocument(uri);
            const functionCode = document.getText(range);
            const context = await enhancedContextProvider.getFormattedContext(document);

            const prompt = `Explain this ${document.languageId} function in detail:

CONTEXT:
${context}

FUNCTION: ${functionName}
\`\`\`${document.languageId}
${functionCode}
\`\`\`

Provide a clear explanation of:
1. What this function does
2. Its parameters and return value
3. Key logic and algorithms used
4. Potential edge cases or limitations
5. How it fits into the larger codebase`;

            try {
                const explanation = await client.generateCompletion(prompt, {
                    max_tokens: 500,
                    temperature: 0.3,
                });

                // Show explanation in a new document
                const explanationDoc = await vscode.workspace.openTextDocument({
                    content: `# Function Explanation: ${functionName}\n\n${explanation}`,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(explanationDoc);
            } catch (error) {
                vscode.window.showErrorMessage('Failed to explain function: ' + error);
            }
        }
    );

    // Generate Tests
    const generateTestsCommand = vscode.commands.registerCommand(
        'ai-assistant.generateTests',
        async (uri: vscode.Uri, range: vscode.Range, functionName: string) => {
            const document = await vscode.workspace.openTextDocument(uri);
            const functionCode = document.getText(range);
            const context = await enhancedContextProvider.getFormattedContext(document);

            const prompt = `Generate comprehensive unit tests for this ${document.languageId} function:

CONTEXT:
${context}

FUNCTION: ${functionName}
\`\`\`${document.languageId}
${functionCode}
\`\`\`

Generate test cases that cover:
1. Normal/happy path scenarios
2. Edge cases and boundary conditions
3. Error conditions and exception handling
4. Mock dependencies if needed

Use appropriate testing framework for ${document.languageId} (Jest, Mocha, etc.).`;

            try {
                const tests = await client.generateCompletion(prompt, {
                    max_tokens: 800,
                    temperature: 0.2,
                });

                // Create a new test file
                const testFileName = `${functionName}.test.${document.languageId === 'typescript' ? 'ts' : 'js'}`;
                const testDoc = await vscode.workspace.openTextDocument({
                    content: tests,
                    language: document.languageId
                });
                await vscode.window.showTextDocument(testDoc);
            } catch (error) {
                vscode.window.showErrorMessage('Failed to generate tests: ' + error);
            }
        }
    );

    // Optimize Function
    const optimizeFunctionCommand = vscode.commands.registerCommand(
        'ai-assistant.optimizeFunction',
        async (uri: vscode.Uri, range: vscode.Range, functionName: string) => {
            const document = await vscode.workspace.openTextDocument(uri);
            const functionCode = document.getText(range);
            const context = await enhancedContextProvider.getFormattedContext(document);

            const prompt = `Optimize this ${document.languageId} function for better performance, readability, and maintainability:

CONTEXT:
${context}

FUNCTION: ${functionName}
\`\`\`${document.languageId}
${functionCode}
\`\`\`

Provide:
1. Optimized version of the function
2. Explanation of improvements made
3. Performance considerations
4. Any potential trade-offs`;

            try {
                const optimization = await client.generateCompletion(prompt, {
                    max_tokens: 600,
                    temperature: 0.2,
                });

                // Show optimization suggestions
                const optimizationDoc = await vscode.workspace.openTextDocument({
                    content: `# Function Optimization: ${functionName}\n\n${optimization}`,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(optimizationDoc);
            } catch (error) {
                vscode.window.showErrorMessage('Failed to optimize function: ' + error);
            }
        }
    );

    // Generate Class Docs
    const generateClassDocsCommand = vscode.commands.registerCommand(
        'ai-assistant.generateClassDocs',
        async (uri: vscode.Uri, range: vscode.Range, className: string) => {
            const document = await vscode.workspace.openTextDocument(uri);
            const classCode = document.getText(range);
            const context = await enhancedContextProvider.getFormattedContext(document);

            const prompt = `Generate comprehensive documentation for this ${document.languageId} class:

CONTEXT:
${context}

CLASS: ${className}
\`\`\`${document.languageId}
${classCode}
\`\`\`

Generate documentation that includes:
1. Class overview and purpose
2. Constructor parameters
3. Method descriptions
4. Property descriptions
5. Usage examples
6. JSDoc/TypeDoc formatted comments`;

            try {
                const docs = await client.generateCompletion(prompt, {
                    max_tokens: 800,
                    temperature: 0.2,
                });

                // Show documentation
                const docsDoc = await vscode.workspace.openTextDocument({
                    content: `# Class Documentation: ${className}\n\n${docs}`,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(docsDoc);
            } catch (error) {
                vscode.window.showErrorMessage('Failed to generate class documentation: ' + error);
            }
        }
    );

    // Review File
    const reviewFileCommand = vscode.commands.registerCommand(
        'ai-assistant.reviewFile',
        async (uri: vscode.Uri) => {
            const document = await vscode.workspace.openTextDocument(uri);
            const context = await enhancedContextProvider.getFormattedContext(document);
            const code = document.getText();

            const prompt = `Perform a comprehensive code review of this ${document.languageId} file:

CONTEXT:
${context}

CODE:
\`\`\`${document.languageId}
${code.length > 2000 ? code.slice(0, 2000) + '\n... (truncated)' : code}
\`\`\`

Provide a detailed review covering:
1. Code quality and best practices
2. Potential bugs or issues
3. Performance considerations
4. Security concerns
5. Maintainability and readability
6. Specific recommendations for improvement`;

            try {
                const review = await client.generateCompletion(prompt, {
                    max_tokens: 1000,
                    temperature: 0.3,
                });

                // Show review in a new document
                const reviewDoc = await vscode.workspace.openTextDocument({
                    content: `# Code Review: ${document.fileName}\n\n${review}`,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(reviewDoc);
            } catch (error) {
                vscode.window.showErrorMessage('Failed to review file: ' + error);
            }
        }
    );

    // Security Check
    const securityCheckCommand = vscode.commands.registerCommand(
        'ai-assistant.securityCheck',
        async (uri: vscode.Uri) => {
            const document = await vscode.workspace.openTextDocument(uri);
            const code = document.getText();

            const prompt = `Perform a security analysis of this ${document.languageId} code:

CODE:
\`\`\`${document.languageId}
${code.length > 2000 ? code.slice(0, 2000) + '\n... (truncated)' : code}
\`\`\`

Check for:
1. SQL injection vulnerabilities
2. XSS vulnerabilities
3. Authentication/authorization issues
4. Input validation problems
5. Sensitive data exposure
6. Dependency security issues
7. Other common security vulnerabilities

Provide specific recommendations for each issue found.`;

            try {
                const securityReport = await client.generateCompletion(prompt, {
                    max_tokens: 800,
                    temperature: 0.2,
                });

                // Show security report
                const reportDoc = await vscode.workspace.openTextDocument({
                    content: `# Security Analysis: ${document.fileName}\n\n${securityReport}`,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(reportDoc);
            } catch (error) {
                vscode.window.showErrorMessage('Failed to perform security check: ' + error);
            }
        }
    );

    // Add all commands to context subscriptions
    context.subscriptions.push(
        explainFunctionCommand,
        generateTestsCommand,
        optimizeFunctionCommand,
        generateClassDocsCommand,
        reviewFileCommand,
        securityCheckCommand
    );
}