import * as vscode from 'vscode';
import { OllamaClient } from './ollama/client';
import { InlineSuggestionProvider } from './features/inlineSuggestions';
import { ChatInterface } from './features/chatInterface';
import { ContextProvider } from './features/contextProvider';
import { ModelSelector } from './features/modelSelector';
import { PromptTemplates } from './features/promptTemplates';
import { CodeActionsProvider } from './features/codeActions';
import { FileContextSelector } from './features/fileContextSelector';

export function activate(context: vscode.ExtensionContext) {
  console.log('AI Assistant is now active!');
  
  // Initialize components
  const ollamaClient = new OllamaClient();
  const contextProvider = new ContextProvider();
  const promptTemplates = new PromptTemplates();
  const fileContextSelector = new FileContextSelector();
  
  const inlineSuggestionProvider = new InlineSuggestionProvider(ollamaClient, contextProvider);
  const modelSelector = new ModelSelector(ollamaClient);
  const codeActionsProvider = new CodeActionsProvider(ollamaClient, contextProvider, promptTemplates);
  const chatInterface = new ChatInterface(ollamaClient, contextProvider, context, promptTemplates, fileContextSelector);
  
  // Connect the chat interface to the code actions provider
  codeActionsProvider.setCodeActionHandler(chatInterface);
  
  // Register inline suggestion provider
  const inlineCompletionProvider = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' }, // All files
    inlineSuggestionProvider
  );
  
  // Register code actions provider
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    { pattern: '**' },
    codeActionsProvider,
    {
      providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite]
    }
  );
  
  // Register commands
  const askOllamaCommand = vscode.commands.registerCommand('ai-assistant.askOllama', () => {
    chatInterface.open();
  });
  
  const toggleInlineSuggestionsCommand = vscode.commands.registerCommand(
    'ai-assistant.toggleInlineSuggestions',
    () => {
      const enabled = inlineSuggestionProvider.toggleEnabled();
      vscode.window.showInformationMessage(
        `Inline suggestions ${enabled ? 'enabled' : 'disabled'}`
      );
    }
  );
  
  const configureOllamaCommand = vscode.commands.registerCommand(
    'ai-assistant.configureOllama',
    async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'ai-assistant'
      );
    }
  );
  
  const selectModelCommand = vscode.commands.registerCommand(
    'ai-assistant.selectModel',
    async () => {
      await modelSelector.selectModel();
    }
  );
  
  const selectContextFilesCommand = vscode.commands.registerCommand(
    'ai-assistant.selectContextFiles',
    async () => {
      await fileContextSelector.selectFiles();
    }
  );
  
  // Code action commands
  const explainCodeCommand = vscode.commands.registerCommand(
    'ai-assistant.explainCode',
    async (document: vscode.TextDocument, range: vscode.Range, selectedText: string) => {
      if (!document || !range) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          document = editor.document;
          range = editor.selection;
          selectedText = editor.document.getText(range);
        } else {
          vscode.window.showErrorMessage('No active text editor or selection');
          return;
        }
      }
      
      await codeActionsProvider.performCodeAction('explain', document, range, selectedText);
    }
  );
  
  const refactorCodeCommand = vscode.commands.registerCommand(
    'ai-assistant.refactorCode',
    async (document: vscode.TextDocument, range: vscode.Range, selectedText: string) => {
      if (!document || !range) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          document = editor.document;
          range = editor.selection;
          selectedText = editor.document.getText(range);
        } else {
          vscode.window.showErrorMessage('No active text editor or selection');
          return;
        }
      }
      
      await codeActionsProvider.performCodeAction('refactor', document, range, selectedText);
    }
  );
  
  const documentCodeCommand = vscode.commands.registerCommand(
    'ai-assistant.documentCode',
    async (document: vscode.TextDocument, range: vscode.Range, selectedText: string) => {
      if (!document || !range) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          document = editor.document;
          range = editor.selection;
          selectedText = editor.document.getText(range);
        } else {
          vscode.window.showErrorMessage('No active text editor or selection');
          return;
        }
      }
      
      await codeActionsProvider.performCodeAction('document', document, range, selectedText);
    }
  );
  
  // Add stop generation command
  const stopGenerationCommand = vscode.commands.registerCommand(
    'ai-assistant.stopGeneration',
    () => {
      if (chatInterface) {
        chatInterface.stopGeneration();
      }
    }
  );
  
  // Handle webview messages
  context.subscriptions.push(vscode.window.registerWebviewPanelSerializer('aiAssistantChat', {
    async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
      webviewPanel.webview.onDidReceiveMessage(
        async message => {
          if (message.command === 'stopGeneration') {
            chatInterface.stopGeneration();
          }
        }
      );
    }
  }));
  
  // Add disposables to context
  context.subscriptions.push(
    inlineCompletionProvider,
    codeActionProvider,
    askOllamaCommand,
    toggleInlineSuggestionsCommand,
    configureOllamaCommand,
    selectModelCommand,
    selectContextFilesCommand,
    explainCodeCommand,
    refactorCodeCommand,
    documentCodeCommand,
    stopGenerationCommand,
    modelSelector
  );
}

export function deactivate() {
  // Make sure to abort any pending requests on extension deactivation
  const ollamaClient = new OllamaClient();
  ollamaClient.abortAllRequests();
}
