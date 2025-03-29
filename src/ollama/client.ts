import axios from 'axios';
import * as vscode from 'vscode';

export class OllamaClient {
  private readonly baseUrl: string;
  private model: string;
  private abortControllers: Map<string, AbortController> = new Map();
  private systemPrompt: string;

  constructor() {
    this.systemPrompt = `You are AI Copilot, an AI programming assistant embedded in Visual Studio Code.

    YOUR CAPABILITIES:
    - Provide clear, concise code solutions in response to user questions
    - Explain complex programming concepts and algorithms
    - Help debug issues and troubleshoot errors
    - Suggest improvements to existing code
    - Recommend best practices and design patterns
    - Generate documentation for code

    INTERACTION GUIDELINES:
    - Be helpful, respectful, and direct
    - When asked to generate code, provide working solutions with appropriate comments
    - Explain your reasoning when suggesting code changes or improvements
    - Tailor explanations to the user's apparent experience level
    - Provide reasonably-sized code snippets that focus on the user's specific needs
    - When dealing with multiple possible approaches, briefly mention alternatives
    - If you're unsure about something, clearly state your limitations
    - Format your responses using Markdown for readability

    RESTRICTIONS:
    - Do not generate harmful, malicious, or deceptive code
    - Do not attempt to access, modify, or request sensitive information
    - Avoid generating excessively long responses
    - If you don't know how to solve a problem, say so rather than providing incorrect solutions
    - Do not engage with non-programming related requests

    The user is currently working in a VS Code environment and may share code snippets, error messages, or questions about their project. Provide concise, practical responses that help them accomplish their programming tasks efficiently.`;
    const config = vscode.workspace.getConfiguration('ai-assistant');
    this.baseUrl = config.get('ollamaServerUrl') || 'http://localhost:11434';
    this.model = config.get('defaultModel') || 'gemma3:1b';
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`);
      return response.data.models.map((model: any) => model.name);
    } catch (error) {
      console.error('Error listing models:', error);
      throw new Error('Failed to connect to Ollama server');
    }
  }

  async generateCompletion(prompt: string, options: any = {}): Promise<string> {
    console.log('generateCompletion', prompt, options);
    const requestId = Date.now().toString();
    const abortController = new AbortController();

    try {
      this.abortControllers.set(requestId, abortController);

      const response = await axios.post(`${this.baseUrl}/api/generate`, {
        model: this.model,
        prompt,
        options: options,
        stream: false,
        system: this.systemPrompt
      }, {
        signal: abortController.signal
      });

      this.abortControllers.delete(requestId);
      console.log(response.data.response);
      return response.data.response;
    } catch (error) {
      this.abortControllers.delete(requestId);

      if (axios.isCancel(error)) {
        console.log('Request was cancelled');
        return '';
      }

      console.error('Error generating completion:', error);
      throw new Error('Failed to generate completion');
    }
  }

  async streamCompletion(prompt: string, onChunk: (text: string) => void, options: any = {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
  }): Promise<{ requestId: string }> {
    console.log('streamCompletion', prompt, options);
    const requestId = Date.now().toString();
    const abortController = new AbortController();

    try {
      this.abortControllers.set(requestId, abortController);

      const response = await axios.post(`${this.baseUrl}/api/generate`, {
        model: this.model,
        prompt,
        stream: true,
        options: options,
        system: this.systemPrompt
      }, {
        responseType: 'stream',
        signal: abortController.signal
      });

      response.data.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        try {
          const json = JSON.parse(text);
          if (json.response) {
            onChunk(json.response);
          }
        } catch (e) {
          // Ignore parsing errors from incomplete chunks
        }
      });

      response.data.on('end', () => {
        console.log('Streaming completed.');
        onChunk('__END__'); // Send a special end marker to notify completion
        this.abortControllers.delete(requestId);
      });

      response.data.on('error', (err: any) => {
        if (!axios.isCancel(err)) {
          console.error('Stream error:', err);
          onChunk(`__ERROR__${err.message || 'Unknown error'}`);
        } else {
          onChunk('__CANCELLED__');
        }
        this.abortControllers.delete(requestId);
      });

      return { requestId };
    } catch (error) {
      this.abortControllers.delete(requestId);

      if (axios.isCancel(error)) {
        console.log('Stream request was cancelled');
        onChunk('__CANCELLED__');
        return { requestId };
      }

      console.error('Error streaming completion:', error);
      onChunk(`__ERROR__Failed to stream completion`);
      throw new Error('Failed to stream completion');
    }
  }

  abortRequest(requestId: string): boolean {
    const controller = this.abortControllers.get(requestId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(requestId);
      return true;
    }
    return false;
  }

  abortAllRequests(): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
  }

  setModel(model: string): void {
    this.model = model;
  }

  getCurrentModel(): string {
    return this.model;
  }
}



