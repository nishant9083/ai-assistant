import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Starting all tests.');

	test('Extension should be present', () => {
		assert.ok(vscode.extensions.getExtension('nishant-vscode-ext.code-pilot'));
	});

	test('Should register commands', async () => {
		const commands = await vscode.commands.getCommands();
		
		assert.ok(commands.includes('ai-assistant.askOllama'));
		assert.ok(commands.includes('ai-assistant.explainCode'));
		assert.ok(commands.includes('ai-assistant.refactorCode'));
		assert.ok(commands.includes('ai-assistant.documentCode'));
		assert.ok(commands.includes('ai-assistant.toggleInlineSuggestions'));
		assert.ok(commands.includes('ai-assistant.configureOllama'));
		assert.ok(commands.includes('ai-assistant.selectModel'));
		assert.ok(commands.includes('ai-assistant.selectContextFiles'));
		assert.ok(commands.includes('ai-assistant.stopGeneration'));
	});
});
