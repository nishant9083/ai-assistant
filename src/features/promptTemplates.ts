import * as vscode from 'vscode';

export interface IPromptTemplate {
    id: string;
    name: string;
    description: string;
    template: string;
}

export class PromptTemplates {
    private templates: Map<string, IPromptTemplate>;
    
    constructor() {
        this.templates = new Map();
        this.initializeDefaultTemplates();
    }
    
    private initializeDefaultTemplates(): void {
        // Code action templates
        this.addTemplate({
            id: 'explain_code',
            name: 'Explain Code',
            description: 'Explain what the selected code does',
            template: 'You are an expert AI programming assistant. Explain the following code in detail:\n\n{fileContext}\n\nCode to explain:\n```\n{selectedCode}\n```\n\nProvide a clear explanation of what this code does, its purpose, and how it works. Break down complex parts if necessary.'
        });
        
        this.addTemplate({
            id: 'refactor_code',
            name: 'Refactor Code',
            description: 'Refactor the selected code for better performance/readability',
            template: 'You are expert an AI programming assistant. Refactor the following code to improve its quality, readability, or performance:\n\n{fileContext}\n\nCode to refactor:\n```\n{selectedCode}\n```\n\nProvide a refactored version with explanations of what you changed and why. Focus on best practices and code quality.'
        });
        
        this.addTemplate({
            id: 'document_code',
            name: 'Document Code',
            description: 'Add documentation to the selected code',
            template: 'You are an expert AI programming assistant. Add proper documentation to the following code:\n\n{fileContext}\n\nCode to document:\n```\n{selectedCode}\n```\n\nAdd clear and comprehensive documentation (comments, JSDoc, etc.) to this code. Explain parameters, return values, and the purpose of functions/methods/classes.'
        });
        
        // Chat templates
        this.addTemplate({
            id: 'general_coding',
            name: 'General Coding',
            description: 'General programming assistance',
            template: 'You are an expert AI programming assistant. Help me with the following programming task:\n\n{question}'
        });
        
        this.addTemplate({
            id: 'debug_help',
            name: 'Debug Help',
            description: 'Help debugging an issue',
            template: 'You are an expert AI programming assistant. Help me debug the following issue:\n\n{context}\n\nThe issue I\'m facing is:\n{question}\n\nProvide step-by-step debugging advice and potential solutions.'
        });
        
        this.addTemplate({
            id: 'code_generation',
            name: 'Code Generation',
            description: 'Generate code based on requirements',
            template: 'You are an expert AI programming assistant. Generate code based on the following requirements:\n\n{context}\n\nRequirements:\n{question}\n\nProvide complete, well-commented code that satisfies these requirements.'
        });
    }
    
    public addTemplate(template: IPromptTemplate): void {
        this.templates.set(template.id, template);
    }
    
    public getAllTemplates(): IPromptTemplate[] {
        return Array.from(this.templates.values());
    }
    
    public getTemplate(id: string): IPromptTemplate | undefined {
        return this.templates.get(id);
    }
    
    public getChatTemplates(): IPromptTemplate[] {
        return this.getAllTemplates().filter(t => 
            // !t.id.includes('code_') && 
            !t.id.startsWith('explain_') &&
            !t.id.startsWith('refactor_') && 
            !t.id.startsWith('document_')
        );
    }
    
    public getExplainCodePrompt(fileContext: string, selectedCode: string): string {
        const template = this.getTemplate('explain_code');
        if (!template) {
            return `Explain this code:\n\n${selectedCode}`;
        }
        
        return template.template
            .replace('{fileContext}', fileContext)
            .replace('{selectedCode}', selectedCode);
    }
    
    public getRefactorCodePrompt(fileContext: string, selectedCode: string): string {
        const template = this.getTemplate('refactor_code');
        if (!template) {
            return `Refactor this code:\n\n${selectedCode}`;
        }
        
        return template.template
            .replace('{fileContext}', fileContext)
            .replace('{selectedCode}', selectedCode);
    }
    
    public getDocumentCodePrompt(fileContext: string, selectedCode: string): string {
        const template = this.getTemplate('document_code');
        if (!template) {
            return `Document this code:\n\n${selectedCode}`;
        }
        
        return template.template
            .replace('{fileContext}', fileContext)
            .replace('{selectedCode}', selectedCode);
    }
    
    public applyChatTemplate(id: string, context: string, question: string): string {
        const template = this.getTemplate(id);
        if (!template) {
            return question;
        }
        
        return template.template
            .replace('{context}', context)
            .replace('{question}', question);
    }
}
