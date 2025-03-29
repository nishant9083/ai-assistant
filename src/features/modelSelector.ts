import * as vscode from 'vscode';
import { OllamaClient } from '../ollama/client';

export class ModelSelector {
    private statusBarItem: vscode.StatusBarItem;
    private client: OllamaClient;
    private availableModels: string[] = [];
    private isConnected: boolean = false;

    constructor(client: OllamaClient) {
        this.client = client;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'ai-assistant.selectModel';
        this.updateStatusBarItem();
        this.statusBarItem.show();
        this.refreshModelList();
    }

    public async refreshModelList(): Promise<void> {
        try {
            this.availableModels = await this.client.listModels();
            this.isConnected = true;
            this.updateStatusBarItem();
        } catch (error) {
            this.isConnected = false;
            this.updateStatusBarItem();
            vscode.window.showErrorMessage('Failed to connect to Ollama server');
        }
    }

    public async selectModel(): Promise<void> {
        if (!this.isConnected) {
            const reconnect = await vscode.window.showErrorMessage(
                'Not connected to Ollama server',
                'Try reconnect'
            );
            if (reconnect === 'Try reconnect') {
                await this.refreshModelList();
            }
            return;
        }

        if (this.availableModels.length === 0) {
            vscode.window.showInformationMessage('No models available');
            return;
        }

        const selectedModel = await vscode.window.showQuickPick(this.availableModels, {
            placeHolder: 'Select a model'
        });

        if (selectedModel) {
            await vscode.workspace.getConfiguration('ai-assistant').update(
                'defaultModel',
                selectedModel,
                vscode.ConfigurationTarget.Global
            );
            this.client.setModel(selectedModel);
            this.updateStatusBarItem();
            vscode.window.showInformationMessage(`Model changed to ${selectedModel}`);
        }
    }

    private updateStatusBarItem(): void {
        const model = this.client.getCurrentModel();
        
        if (this.isConnected) {
            this.statusBarItem.text = `$(hubot) ${model}`;
            this.statusBarItem.tooltip = `CodePilot: Using ${model} (Click to change)`;
            this.statusBarItem.backgroundColor = undefined;
        } else {
            this.statusBarItem.text = `$(warning) Ollama: Disconnected`;
            this.statusBarItem.tooltip = 'Ollama server not connected (Click to retry)';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
    }

    public dispose(): void {
        this.statusBarItem.dispose();
    }
}
