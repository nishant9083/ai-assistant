const vscode = acquireVsCodeApi();
const chatHistory = document.getElementById("chat-history");
const questionInput = document.getElementById("question-input");
const askButton = document.getElementById("ask-button");
const stopButton = document.getElementById("stop-button");
const templateSelector = document.getElementById("template-selector");
const modelNameElement = document.getElementById("model-name");
const fileContextButton = document.getElementById("file-context-button");

let currentResponseElement = null;
let currentResponseText = "";
let isGenerating = false;

// Template selector change handler
templateSelector.addEventListener("change", () => {
  vscode.postMessage({
    command: "selectTemplate",
    templateId: templateSelector.value,
  });
});

// File context selector
fileContextButton.addEventListener("click", () => {
  vscode.postMessage({
    command: "selectFiles",
  });
});

// Stop generation button
stopButton.addEventListener("click", () => {
  vscode.postMessage({
    command: "stopGeneration",
  });
});

// Listen for messages from the extension
window.addEventListener("message", (event) => {
  const message = event.data;

  if (message.hasOwnProperty("isGenerating")) {
    isGenerating = message.isGenerating;
    updateUI();
  }

  switch (message.type) {
    case "updateTemplates":
      updateTemplateSelector(message.templates, message.currentTemplate);
      break;

    case "updateModel":
      modelNameElement.textContent = message.model;
      break;

    case "updateFileContext":
      updateFileContextButton(message.count);
      break;

    case "startResponse":
      const aiDiv = document.createElement("div");
      aiDiv.className = "ai-title";
      const image = document.createElement("img");
      image.className = "ai-icon";
      image.src = aiImgUri; // Using the global variable defined in HTML
      image.alt = "AI Assistant";
      const aiText = document.createElement("p");
      aiText.textContent = "AI Assistant";
      aiDiv.appendChild(image);
      aiDiv.appendChild(aiText);
      chatHistory.appendChild(aiDiv);
      currentResponseElement = document.createElement("div");
      currentResponseElement.className = "bot-message";
      chatHistory.appendChild(currentResponseElement);
      break;

    case "textChunk":
      if (currentResponseElement && message.content) {
        currentResponseText += message.content;
        currentResponseElement.innerHTML = marked.parse(currentResponseText);
        // For Prism.js - Highlight all code blocks in the response
        if (typeof Prism !== "undefined") {
          Prism.highlightAllUnder(currentResponseElement);
        }
        addCopyButtons();
        chatHistory.scrollTop = chatHistory.scrollHeight;
      }
      break;

    case "endResponse":
      currentResponseElement = null;
      currentResponseText = "";
      chatHistory.scrollTop = chatHistory.scrollHeight;
      addCopyButtons();
      break;

    case "cancelled":
      if (currentResponseElement) {
        const cancelMsg = document.createElement("div");
        cancelMsg.className = "cancelled-message";
        cancelMsg.textContent = "[Generation stopped]";
        chatHistory.appendChild(cancelMsg);
      }
      currentResponseElement = null;
      currentResponseText = "";
      chatHistory.scrollTop = chatHistory.scrollHeight;
      break;

    case "error":
      currentResponseText = "";
      const errorElement = document.createElement("div");
      errorElement.className = "bot-message error";
      errorElement.textContent = message.content;
      chatHistory.appendChild(errorElement);
      chatHistory.scrollTop = chatHistory.scrollHeight;
      break;

    case "systemMessage":
      const systemMessageElement = document.createElement("div");
      systemMessageElement.className = "system-message";
      systemMessageElement.innerHTML = marked.parse(message.content);
      chatHistory.appendChild(systemMessageElement);
      chatHistory.scrollTop = chatHistory.scrollHeight;
      break;
  }
});

function updateUI() {
  if (isGenerating) {
    stopButton.classList.add("visible");
    askButton.disabled = true;
    questionInput.disabled = true;
  } else {
    stopButton.classList.remove("visible");
    askButton.disabled = false;
    questionInput.disabled = false;
  }
}

function updateTemplateSelector(templates, currentTemplate) {
  // Clear existing options
  templateSelector.innerHTML = "";

  // Add new options
  templates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.text = template.name;
    option.title = template.description;

    if (template.id === currentTemplate) {
      option.selected = true;
    }

    templateSelector.appendChild(option);
  });
}

function updateFileContextButton(count) {
  if (count === 0) {
    fileContextButton.textContent = "No files selected";
  } else {
    fileContextButton.textContent = `${count} files selected`;
  }
}

askButton.addEventListener("click", () => askQuestion());
questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    askQuestion();
  }
});

function askQuestion() {
  const question = questionInput.value.trim();
  if (question) {
    const userMessageElement = document.createElement("div");
    userMessageElement.className = "user-message";
    userMessageElement.textContent = question;
    const userDiv = document.createElement("div");
    userDiv.className = "user-title";
    const userImage = document.createElement("img");
    userImage.className = "user-icon";
    userImage.src = userImgUri; // Using the global variable defined in HTML
    userImage.alt = "User";
    const userText = document.createElement("p");
    userText.textContent = "User";
    userDiv.appendChild(userImage);
    userDiv.appendChild(userText);
    chatHistory.appendChild(userDiv);
    chatHistory.appendChild(userMessageElement);

    vscode.postMessage({
      command: "ask",
      text: question,
    });

    questionInput.value = "";
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }
}

// Add to your script.js
function addCopyButtons() {
  document.querySelectorAll("pre").forEach((block) => {
    if (!block.querySelector(".copy-button")) {
      const button = document.createElement("button");
      button.className = "copy-button";
      button.textContent = "Copy";
      button.addEventListener("click", () => {
        navigator.clipboard.writeText(block.textContent);
        button.textContent = "Copied!";
        setTimeout(() => {
          button.textContent = "Copy";
        }, 2000);
      });
      block.appendChild(button);
    }
  });
}

// Call this function after rendering markdown
addCopyButtons();
// Initialize UI state
updateUI();
