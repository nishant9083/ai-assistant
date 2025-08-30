import * as vscode from 'vscode';
import { OllamaClient } from './ollama/client';
import { InlineSuggestionProvider } from './features/inlineSuggestions';
import { ChatInterface } from './features/chatInterface';
import { ContextProvider } from './features/contextProvider';
import { ModelSelector } from './features/modelSelector';
import { PromptTemplates } from './features/promptTemplates';
import { CodeActionsProvider } from './features/codeActions';
import { FileContextSelector } from './features/fileContextSelector';
import { FileIndexService } from './services/fileIndexService';
import { EnhancedContextProvider } from './features/enhancedContextProvider';
import { NextEditProvider } from './features/nextEditProvider';
import { AICodeLensProvider, registerCodeLensCommands } from './features/aiCodeLensProvider';
import { AIHoverProvider } from './features/aiHoverProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('CodePilot is now active!');
  
  // Initialize core services
  const fileIndexService = new FileIndexService();
  const ollamaClient = new OllamaClient();
  const contextProvider = new ContextProvider();
  const enhancedContextProvider = new EnhancedContextProvider(fileIndexService);
  const promptTemplates = new PromptTemplates();
  const fileContextSelector = new FileContextSelector();
  
  // Initialize feature providers
  const inlineSuggestionProvider = new InlineSuggestionProvider(ollamaClient, contextProvider, fileIndexService);
  const modelSelector = new ModelSelector(ollamaClient);
  const codeActionsProvider = new CodeActionsProvider(ollamaClient, contextProvider, promptTemplates);
  const chatInterface = new ChatInterface(ollamaClient, contextProvider, context, promptTemplates, fileContextSelector);
  const nextEditProvider = new NextEditProvider(ollamaClient, fileIndexService);
  const aiCodeLensProvider = new AICodeLensProvider(ollamaClient, fileIndexService);
  const aiHoverProvider = new AIHoverProvider(ollamaClient, fileIndexService);
  
  // Connect the chat interface to the code actions provider
  codeActionsProvider.setCodeActionHandler(chatInterface);
  
  // Start building the file index in the background
  setTimeout(() => {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      fileIndexService.buildFullIndex();
    }
  }, 1000); // Wait 1 second after activation to start indexing
  
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

  // Register AI Code Lens provider
  const codeLensProvider = vscode.languages.registerCodeLensProvider(
    { 
      pattern: '**/*.{ts,js,tsx,jsx,py,java,c,cpp,cs,go,rs,php,rb,swift,kt}' 
    },
    aiCodeLensProvider
  );

  // Register AI Hover provider
  const hoverProvider = vscode.languages.registerHoverProvider(
    { 
      pattern: '**/*.{ts,js,tsx,jsx,py,java,c,cpp,cs,go,rs,php,rb,swift,kt}' 
    },
    aiHoverProvider
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

  // Next Edit command
  const suggestNextEditCommand = vscode.commands.registerCommand(
    'ai-assistant.suggestNextEdit',
    async (uri?: vscode.Uri) => {
      const document = uri ? await vscode.workspace.openTextDocument(uri) : undefined;
      await nextEditProvider.showNextEditSuggestions();
    }
  );

  // Rebuild Index command
  const rebuildIndexCommand = vscode.commands.registerCommand(
    'ai-assistant.rebuildIndex',
    async () => {
      await fileIndexService.buildFullIndex();
      vscode.window.showInformationMessage('File index rebuilt successfully');
    }
  );

  // Show Index Stats command
  const showIndexStatsCommand = vscode.commands.registerCommand(
    'ai-assistant.showIndexStats',
    () => {
      const stats = fileIndexService.getWorkspaceStats();
      const lastIndexed = new Date(fileIndexService.getLastIndexedTime()).toLocaleString();
      
      vscode.window.showInformationMessage(
        `CodePilot Index: ${stats.totalFiles} files, ${stats.totalSymbols} symbols, ${stats.languages.length} languages. Last indexed: ${lastIndexed}`
      );
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
  
  // Add clear chat history command
  const clearChatHistoryCommand = vscode.commands.registerCommand(
    'ai-assistant.clearChatHistory',
    async () => {
      const answer = await vscode.window.showWarningMessage(
        'Are you sure you want to clear all chat history? This cannot be undone.',
        'Yes', 'No'
      );
      
      if (answer === 'Yes') {
        // This requires access to the ChatHistoryService
        // We'll have the chatInterface expose this functionality
        await vscode.commands.executeCommand('ai-assistant.askOllama'); // First make sure chat is open
        vscode.commands.executeCommand('ai-assistant.clearCurrentChatHistory');
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

  // Register code lens commands
  registerCodeLensCommands(context, ollamaClient, fileIndexService);
  
  // Add disposables to context
  context.subscriptions.push(
    inlineCompletionProvider,
    codeActionProvider,
    codeLensProvider,
    hoverProvider,
    askOllamaCommand,
    toggleInlineSuggestionsCommand,
    configureOllamaCommand,
    selectModelCommand,
    selectContextFilesCommand,
    explainCodeCommand,
    refactorCodeCommand,
    documentCodeCommand,
    stopGenerationCommand,
    clearChatHistoryCommand,
    suggestNextEditCommand,
    rebuildIndexCommand,
    showIndexStatsCommand,
    modelSelector
  );
}

export function deactivate() {
  // Make sure to abort any pending requests on extension deactivation
  const ollamaClient = new OllamaClient();
  ollamaClient.abortAllRequests();
}
