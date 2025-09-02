import * as vscode from 'vscode';
import { OllamaClient } from '../ollama/client';
import { EnhancedContextProvider } from './enhancedContextProvider';
import { FileIndexService } from '../services/fileIndexService';

interface AnalysisResult {
    incomplete_implementations: Array<{
        location: string;
        description: string;
        suggestion: string;
        priority: string;
    }>;
    missing_error_handling: Array<{
        location: string;
        function: string;
        suggestion: string;
    }>;
    new_features: Array<{
        description: string;
        location: string;
        reasoning: string;
    }>;
    missing_imports: Array<{
        import: string;
        reason: string;
    }>;
    refactoring_opportunities: Array<{
        location: string;
        type: string;
        description: string;
    }>;
}

export interface NextEditSuggestion {
    description: string;
    location: vscode.Range;
    newText: string;
    confidence: number;
    type: 'function' | 'variable' | 'import' | 'refactor' | 'bugfix' | 'enhancement';
}

export class NextEditProvider {
    private client: OllamaClient;
    private enhancedContextProvider: EnhancedContextProvider;
    private fileIndexService: FileIndexService;
    private isAnalyzing: boolean = false;

    constructor(
        client: OllamaClient,
        fileIndexService: FileIndexService
    ) {
        this.client = client;
        this.fileIndexService = fileIndexService;
        this.enhancedContextProvider = new EnhancedContextProvider(fileIndexService);
    }

    async suggestNextEdit(document?: vscode.TextDocument): Promise<NextEditSuggestion[]> {
        if (this.isAnalyzing) {
            return [];
        }

        const editor = vscode.window.activeTextEditor;
        const currentDocument = document || editor?.document;
        
        if (!currentDocument) {
            vscode.window.showErrorMessage('No active document found');
            return [];
        }

        this.isAnalyzing = true;

        try {
            const suggestions = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "CodePilot: Analyzing code for next edit suggestions...",
                cancellable: true
            }, async (progress, token) => {
                progress.report({ increment: 0, message: "Getting code context..." });
                
                // Get enhanced context
                const context = await this.enhancedContextProvider.getEnhancedContext(currentDocument);
                
                progress.report({ increment: 25, message: "Analyzing code patterns..." });
                
                // Analyze the current file for improvement opportunities
                const analysisResults = await this.analyzeCode(currentDocument, context);
                
                progress.report({ increment: 50, message: "Generating edit suggestions..." });
                
                // Generate specific edit suggestions
                const suggestions = await this.generateEditSuggestions(currentDocument, analysisResults);
                
                progress.report({ increment: 100, message: "Complete" });
                
                return suggestions;
            });

            return suggestions;
        } catch (error) {
            console.error('Error suggesting next edit:', error);
            vscode.window.showErrorMessage('Failed to generate next edit suggestions');
            return [];
        } finally {
            this.isAnalyzing = false;
        }
    }

    private async analyzeCode(document: vscode.TextDocument, context: any): Promise<AnalysisResult> {
        const code = document.getText();
        const language = document.languageId;
        
        const analysisPrompt = `You are a code analysis expert. Analyze this ${language} code and identify opportunities for the next logical edit or improvement.

FILE: ${context.currentFile?.fileName || 'unknown'}
LANGUAGE: ${language}

CONTEXT:
${await this.enhancedContextProvider.getFormattedContext(document)}

CODE:
\`\`\`${language}
${code}
\`\`\`

Analyze the code and identify:
1. Incomplete implementations (TODOs, empty functions, missing logic)
2. Missing error handling
3. Opportunities for new features based on existing patterns
4. Missing imports or dependencies
5. Code that could be refactored or optimized
6. Missing tests or documentation
7. Inconsistent patterns that should be unified

Respond in JSON format with this structure:
{
    "incomplete_implementations": [
        {
            "location": "line_number",
            "description": "what's missing",
            "suggestion": "what should be added",
            "priority": "high|medium|low"
        }
    ],
    "missing_error_handling": [
        {
            "location": "line_number", 
            "function": "function_name",
            "suggestion": "error handling to add"
        }
    ],
    "new_features": [
        {
            "description": "feature suggestion based on existing code patterns",
            "location": "where to add it",
            "reasoning": "why this feature makes sense"
        }
    ],
    "missing_imports": [
        {
            "import": "import statement needed",
            "reason": "why it's needed"
        }
    ],
    "refactoring_opportunities": [
        {
            "location": "line_range",
            "type": "extract_function|rename|simplify|optimize",
            "description": "what to refactor and why"
        }
    ]
}`;

        try {
            const response = await this.client.generateCompletion(analysisPrompt, {
                max_tokens: 1000,
                temperature: 0.3,
            });

            // Try to parse JSON response
            try {
                return JSON.parse(response);
            } catch (parseError) {
                // Fallback: extract JSON from response if it's embedded
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                return this.createFallbackAnalysis(document);
            }
        } catch (error) {
            console.error('Error in code analysis:', error);
            return this.createFallbackAnalysis(document);
        }
    }

    private createFallbackAnalysis(document: vscode.TextDocument): AnalysisResult {
        const text = document.getText();
        const lines = text.split('\n');
        
        const analysis: AnalysisResult = {
            incomplete_implementations: [],
            missing_error_handling: [],
            new_features: [],
            missing_imports: [],
            refactoring_opportunities: []
        };

        // Simple pattern-based analysis as fallback
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            
            // Look for TODOs
            if (trimmed.includes('TODO') || trimmed.includes('FIXME')) {
                analysis.incomplete_implementations.push({
                    location: (index + 1).toString(),
                    description: "TODO item found",
                    suggestion: "Complete the TODO item",
                    priority: "medium"
                });
            }

            // Look for empty functions
            if (trimmed.match(/function\s+\w+\s*\([^)]*\)\s*\{\s*\}/) || 
                trimmed.match(/\w+\s*=\s*\([^)]*\)\s*=>\s*\{\s*\}/)) {
                analysis.incomplete_implementations.push({
                    location: (index + 1).toString(),
                    description: "Empty function found",
                    suggestion: "Add implementation to the function",
                    priority: "high"
                });
            }

            // Look for console.log (potential debugging code)
            if (trimmed.includes('console.log')) {
                analysis.refactoring_opportunities.push({
                    location: (index + 1).toString(),
                    type: "cleanup",
                    description: "Remove or replace console.log with proper logging"
                });
            }
        });

        return analysis;
    }

    private async generateEditSuggestions(document: vscode.TextDocument, analysis: AnalysisResult): Promise<NextEditSuggestion[]> {
        const suggestions: NextEditSuggestion[] = [];

        // Process incomplete implementations
        if (analysis.incomplete_implementations) {
            for (const impl of analysis.incomplete_implementations.slice(0, 3)) {
                const lineNumber = Math.max(0, parseInt(impl.location) - 1);
                const line = document.lineAt(Math.min(lineNumber, document.lineCount - 1));
                
                const suggestion = await this.generateSpecificEdit(document, lineNumber, impl.suggestion, 'function');
                if (suggestion) {
                    suggestions.push({
                        description: impl.description,
                        location: new vscode.Range(lineNumber, 0, lineNumber, line.text.length),
                        newText: suggestion,
                        confidence: impl.priority === 'high' ? 0.9 : 0.7,
                        type: 'function'
                    });
                }
            }
        }

        // Process missing error handling
        if (analysis.missing_error_handling) {
            for (const errorHandling of analysis.missing_error_handling.slice(0, 2)) {
                const lineNumber = Math.max(0, parseInt(errorHandling.location) - 1);
                
                const suggestion = await this.generateErrorHandling(document, lineNumber, errorHandling.function);
                if (suggestion) {
                    suggestions.push({
                        description: `Add error handling to ${errorHandling.function}`,
                        location: new vscode.Range(lineNumber, 0, lineNumber + 1, 0),
                        newText: suggestion,
                        confidence: 0.8,
                        type: 'enhancement'
                    });
                }
            }
        }

        // Process missing imports
        if (analysis.missing_imports) {
            for (const missingImport of analysis.missing_imports.slice(0, 2)) {
                suggestions.push({
                    description: `Add missing import: ${missingImport.import}`,
                    location: new vscode.Range(0, 0, 0, 0),
                    newText: missingImport.import + '\n',
                    confidence: 0.9,
                    type: 'import'
                });
            }
        }

        // Process new features
        if (analysis.new_features) {
            for (const feature of analysis.new_features.slice(0, 2)) {
                const suggestion = await this.generateFeatureImplementation(document, feature);
                if (suggestion) {
                    const insertLine = this.findBestInsertionPoint(document, feature.location);
                    suggestions.push({
                        description: feature.description,
                        location: new vscode.Range(insertLine, 0, insertLine, 0),
                        newText: suggestion,
                        confidence: 0.6,
                        type: 'enhancement'
                    });
                }
            }
        }

        return suggestions.slice(0, 5); // Limit to 5 suggestions
    }

    private async generateSpecificEdit(
        document: vscode.TextDocument, 
        lineNumber: number, 
        suggestion: string, 
        type: string
    ): Promise<string | null> {
        const context = await this.enhancedContextProvider.getFormattedContext(document);
        const surroundingLines = this.getSurroundingLines(document, lineNumber, 5);
        
        const prompt = `Generate a specific code implementation for this ${document.languageId} code.

CONTEXT:
${context}

SURROUNDING CODE:
\`\`\`${document.languageId}
${surroundingLines}
\`\`\`

TASK: ${suggestion}

Generate only the code that should be added or replace the current line. Match the existing code style and indentation. Do not include explanations or markdown formatting.

CODE:`;

        try {
            const response = await this.client.generateCompletion(prompt, {
                max_tokens: 200,
                temperature: 0.2,
            });

            return this.cleanCodeResponse(response);
        } catch (error) {
            console.error('Error generating specific edit:', error);
            return null;
        }
    }

    private async generateErrorHandling(
        document: vscode.TextDocument, 
        lineNumber: number, 
        functionName: string
    ): Promise<string | null> {
        const surroundingLines = this.getSurroundingLines(document, lineNumber, 10);
        
        const prompt = `Add appropriate error handling to this ${document.languageId} function.

FUNCTION: ${functionName}

CODE:
\`\`\`${document.languageId}
${surroundingLines}
\`\`\`

Add try-catch blocks, null checks, or other appropriate error handling. Match the existing code style and indentation.

ERROR HANDLING CODE:`;

        try {
            const response = await this.client.generateCompletion(prompt, {
                max_tokens: 150,
                temperature: 0.2,
            });

            return this.cleanCodeResponse(response);
        } catch (error) {
            console.error('Error generating error handling:', error);
            return null;
        }
    }

    private async generateFeatureImplementation(document: vscode.TextDocument, feature: any): Promise<string | null> {
        const context = await this.enhancedContextProvider.getFormattedContext(document);
        
        const prompt = `Implement this new feature for the ${document.languageId} code.

CONTEXT:
${context}

FEATURE: ${feature.description}
REASONING: ${feature.reasoning}
LOCATION: ${feature.location}

Generate the code implementation for this feature. Follow the existing code patterns and style.

IMPLEMENTATION:`;

        try {
            const response = await this.client.generateCompletion(prompt, {
                max_tokens: 300,
                temperature: 0.3,
            });

            return this.cleanCodeResponse(response);
        } catch (error) {
            console.error('Error generating feature implementation:', error);
            return null;
        }
    }

    private getSurroundingLines(document: vscode.TextDocument, lineNumber: number, range: number): string {
        const startLine = Math.max(0, lineNumber - range);
        const endLine = Math.min(document.lineCount - 1, lineNumber + range);
        
        const lines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
            const line = document.lineAt(i);
            if (i === lineNumber) {
                lines.push(`>>> ${line.text} <<<`); // Mark the target line
            } else {
                lines.push(line.text);
            }
        }
        
        return lines.join('\n');
    }

    private findBestInsertionPoint(document: vscode.TextDocument, location: string): number {
        // Simple heuristic to find good insertion points
        if (location.includes('end') || location.includes('bottom')) {
            return document.lineCount;
        } else if (location.includes('function') || location.includes('class')) {
            // Find last function/class and insert after
            const text = document.getText();
            const matches = text.match(/(function|class)\s+\w+/g);
            if (matches) {
                const lastMatch = matches[matches.length - 1];
                const lines = text.split('\n');
                for (let i = lines.length - 1; i >= 0; i--) {
                    if (lines[i].includes(lastMatch)) {
                        return i + 1;
                    }
                }
            }
        }
        
        return Math.floor(document.lineCount / 2); // Default to middle
    }

    private cleanCodeResponse(response: string): string {
        // Remove markdown formatting
        response = response.replace(/^```[\w]*\n/gm, '').replace(/```$/gm, '');
        
        // Remove explanatory text
        const codeLines = response.split('\n').filter(line => {
            const trimmed = line.trim().toLowerCase();
            return !trimmed.startsWith('here') && 
                   !trimmed.startsWith('this') && 
                   !trimmed.startsWith('the') &&
                   !trimmed.includes('explanation') &&
                   trimmed !== 'code:' &&
                   trimmed !== '';
        });
        
        return codeLines.join('\n').trim();
    }

    // Public method to show suggestions in UI
    async showNextEditSuggestions(): Promise<void> {
        const suggestions = await this.suggestNextEdit();
        
        if (suggestions.length === 0) {
            vscode.window.showInformationMessage('No next edit suggestions found for the current file.');
            return;
        }

        // Show suggestions in a quick pick
        const items = suggestions.map(suggestion => ({
            label: suggestion.description,
            detail: `${suggestion.type} - confidence: ${Math.round(suggestion.confidence * 100)}%`,
            suggestion
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a next edit suggestion to apply',
            title: 'CodePilot: Next Edit Suggestions'
        });

        if (selected) {
            await this.applySuggestion(selected.suggestion);
        }
    }

    private async applySuggestion(suggestion: NextEditSuggestion): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const edit = new vscode.WorkspaceEdit();
        
        if (suggestion.type === 'import') {
            // Insert at beginning of file
            edit.insert(editor.document.uri, new vscode.Position(0, 0), suggestion.newText);
        } else {
            // Replace or insert at the suggested location
            edit.replace(editor.document.uri, suggestion.location, suggestion.newText);
        }

        await vscode.workspace.applyEdit(edit);
        
        vscode.window.showInformationMessage(`Applied: ${suggestion.description}`);
    }
}