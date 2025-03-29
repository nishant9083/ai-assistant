const vscode = acquireVsCodeApi();
const chatHistory = document.getElementById("chat-history");
const questionInput = document.getElementById("question-input");
const askButton = document.getElementById("ask-button");
const stopButton = document.getElementById("stop-button");
// const templateSelector = document.getElementById("template-selector");
const modelNameElement = document.getElementById("model-name");
const fileContextButton = document.getElementById("file-context-button");
const togglePopup = document.getElementById("history-btn");
const popup = document.getElementById("hist-popup");
const slashCommandMenu = document.getElementById("slash-command-menu");
const slashCommandList = document.getElementById("slash-command-list");
const templateIndicator = document.getElementById("template-indicator");
const templateName = document.getElementById("template-name");
const clearTemplateBtn = document.getElementById("clear-template");
const menu = document.getElementById("context-menu");
const deletebtn = document.getElementById("delete-chat-btn");

// Add these new variables
const newChatButton = document.getElementById("new-chat-btn");
const chatList = document.getElementById("hist-popup");
const contextMenu = document.getElementById("chat-context-menu");
const editChatTitleMenuItem = document.getElementById("edit-chat-title");
const deleteChatMenuItem = document.getElementById("delete-chat");
const renameDialog = document.getElementById("rename-dialog");
const newChatTitleInput = document.getElementById("new-chat-title");
const cancelRenameButton = document.getElementById("cancel-rename");
const confirmRenameButton = document.getElementById("confirm-rename");

let chats = [];
let currentChatId = null;
let contextMenuTargetChatId = null;

let currentResponseElement = null;
let currentResponseText = "";
let isGenerating = false;
let selectedText = "";

// Store templates received from the extension
let availableTemplates = [];
let currentTemplate = null;
let isSlashCommandMenuOpen = false;
let selectedCommandIndex = -1;

// history popup toggle
togglePopup.addEventListener("click", () => {
  console.log("clicked button");
  popup.style.display = popup.style.display === "block" ? "none" : "block";
});

// Close popup if clicked outside
document.addEventListener("click", (event) => {
  if (!togglePopup.contains(event.target) && !popup.contains(event.target)) {
    popup.style.display = "none";
  }
});

// Template selector change handler
// templateSelector.addEventListener("change", () => {
//   vscode.postMessage({
//     command: "selectTemplate",
//     templateId: templateSelector.value,
//   });
// });

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

// Initialize event listeners for chat history features
newChatButton.addEventListener("click", () => {
  vscode.postMessage({
    command: "newChat",
  });
});

// Context menu for chat items
document.addEventListener("contextmenu", (e) => {
  // Check if the click is on a chat item
  const chatItem = e.target.closest(".chat-item");
  if (chatItem) {
    e.preventDefault();

    // Store the chat ID for later use
    contextMenuTargetChatId = chatItem.dataset.id;

    // Position and show the context menu
    contextMenu.style.left = `${e.pageX}px`;
    contextMenu.style.top = `${e.pageY}px`;
    contextMenu.style.display = "block";
  }
});

// Hide context menu when clicking elsewhere
document.addEventListener("click", () => {
  contextMenu.style.display = "none";
});

// Handle menu items
editChatTitleMenuItem.addEventListener("click", () => {
  if (contextMenuTargetChatId) {
    const chat = chats.find((c) => c.id === contextMenuTargetChatId);
    if (chat) {
      newChatTitleInput.value = chat.title;
      renameDialog.style.display = "flex";
    }
  }
});

deleteChatMenuItem.addEventListener("click", () => {
  if (contextMenuTargetChatId) {
    // if (confirm("Are you sure you want to delete this chat?")) {
    vscode.postMessage({
      command: "deleteChat",
      chatId: contextMenuTargetChatId,
    });
    // }
  }
});

deletebtn.addEventListener("click", () => {
  vscode.postMessage({
    command: "deleteChat",
    chatId: null,
  }); 
});

// Rename dialog interactions
cancelRenameButton.addEventListener("click", () => {
  renameDialog.style.display = "none";
});

confirmRenameButton.addEventListener("click", () => {
  if (contextMenuTargetChatId && newChatTitleInput.value.trim() !== "") {
    vscode.postMessage({
      command: "updateChatTitle",
      chatId: contextMenuTargetChatId,
      title: newChatTitleInput.value.trim(),
    });
    renameDialog.style.display = "none";
  }
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
      const aiDiv = createMessageHeader("ai");
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
      systemMessageElement.innerHTML = DOMPurify.sanitize(
        marked.parse(message.content)
      );
      chatHistory.appendChild(systemMessageElement);
      chatHistory.scrollTop = chatHistory.scrollHeight;
      break;

    case "updateChatList":
      chats = message.chats;
      currentChatId = message.currentChatId;
      updateChatListUI();
      break;

    case "loadChatHistory":
      chatHistory.innerHTML = "";
      message.messages.forEach(renderChatMessage);
      break;

    case "clearChat":
      chatHistory.innerHTML = "";
      break;
  }
});

// Update the function for button states and UI
function updateUI() {
  if (isGenerating) {
    stopButton.classList.add("visible");
    askButton.disabled = true;
    askButton.style.display = "none";
    questionInput.disabled = true;
  } else {
    stopButton.classList.remove("visible");
    askButton.disabled = false;
    questionInput.disabled = false;
    askButton.style.display = "block";
    questionInput.focus();
  }
}

// function updateTemplateSelector(templates, currentTemplate) {
//   // Clear existing options
//   templateSelector.innerHTML = "";

//   // Add new options
//   templates.forEach((template) => {
//     const option = document.createElement("option");
//     option.value = template.id;
//     option.text = template.name;
//     option.title = template.description;

//     if (template.id === currentTemplate) {
//       option.selected = true;
//     }

//     templateSelector.appendChild(option);
//   });
// }

function updateFileContextButton(count) {
  if (count === 0) {
    fileContextButton.textContent = "No files selected";
  } else {
    fileContextButton.textContent = `${count} files selected`;
  }
}

askButton.addEventListener("click", () => askQuestion());
questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !isSlashCommandMenuOpen) {
    e.preventDefault();
    askQuestion();
  }
});

function askQuestion() {
  const question = questionInput.value.trim();
  if (question) {
    const userMessageElement = document.createElement("div");
    userMessageElement.className = "user-message";
    userMessageElement.textContent = question;
    const userDiv = createMessageHeader("user");
    chatHistory.appendChild(userDiv);
    chatHistory.appendChild(userMessageElement);

    vscode.postMessage({
      command: "ask",
      text: question,
    });

    questionInput.value = "";
    chatHistory.scrollTop = chatHistory.scrollHeight;
    const textarea = document.getElementById("question-input");
    textarea.style.height = "auto"; // Reset height to auto before setting new height
  }
}

// Add copy buttons to code blocks with VSCode style
function addCopyButtons() {
  document.querySelectorAll("pre").forEach((block) => {
    if (!block.querySelector(".copy-button")) {
      const button = document.createElement("button");
      button.className = "copy-button";
      button.textContent = "Copy";
      button.addEventListener("click", () => {
        // Clone the pre element and find code content without the button
        const preClone = block.cloneNode(true);
        const buttonClone = preClone.querySelector(".copy-button");
        if (buttonClone) {
          buttonClone.remove();
        }
        navigator.clipboard.writeText(preClone.textContent);
        button.textContent = "Copied!";
        setTimeout(() => {
          button.textContent = "Copy";
        }, 2000);
      });
      block.appendChild(button);
    }
  });
}

// Update chat list display
function updateChatListUI() {
  chatList.innerHTML = "";

  if (chats.length === 0) {
    chatList.innerHTML = '<div class="empty-chats">No chats found</div>';
    return;
  }

  // Add each chat to the list
  chats.forEach((chat) => {
    const chatItem = document.createElement("div");
    chatItem.className = "chat-item";
    chatItem.dataset.id = chat.id;

    if (chat.id === currentChatId) {
      chatItem.classList.add("active");
    }

    // Format date
    const date = new Date(chat.updatedAt);
    const formattedDate = date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });

    chatItem.innerHTML = `
      <div class="chat-title">${escapeHtml(chat.title)}</div>
      <div class="chat-date">${formattedDate}</div>
    `;

    chatItem.addEventListener("click", () => {
      vscode.postMessage({
        command: "loadChat",
        chatId: chat.id,
      });
    });

    chatList.appendChild(chatItem);
  });
}

// Helper function to escape HTML
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Render a chat message
function renderChatMessage(message) {
  switch (message.role) {
    case "user":
      const userDiv = createMessageHeader("user");
      chatHistory.appendChild(userDiv);

      const userMessage = document.createElement("div");
      userMessage.className = "user-message";
      userMessage.innerHTML = DOMPurify.sanitize(marked.parse(message.content));
      // Apply syntax highlighting
      if (typeof Prism !== "undefined") {
        Prism.highlightAllUnder(userMessage);
      }
      chatHistory.appendChild(userMessage);
      break;

    case "assistant":
      const aiDiv = createMessageHeader("ai");
      chatHistory.appendChild(aiDiv);

      const botMessage = document.createElement("div");
      botMessage.className = "bot-message";
      botMessage.innerHTML = DOMPurify.sanitize(marked.parse(message.content));

      // Apply syntax highlighting
      if (typeof Prism !== "undefined") {
        Prism.highlightAllUnder(botMessage);
      }

      chatHistory.appendChild(botMessage);
      break;

    case "system":
      const systemMessage = document.createElement("div");
      systemMessage.className = "system-message";
      systemMessage.innerHTML = marked.parse(message.content);
      chatHistory.appendChild(systemMessage);
      break;
  }

  // Add copy buttons to code blocks
  addCopyButtons();

  // Scroll to bottom
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function createMessageHeader(role) {
  const headerDiv = document.createElement("div");
  headerDiv.className = `${role}-title`;
  const imgDiv = document.createElement("div");
  imgDiv.className = "img-div";
  const image = document.createElement("img");
  image.className = `${role}-icon`;
  image.src = role === "user" ? userImgUri : aiImgUri;
  image.alt = role === "user" ? "User" : "CodePilot";
  const text = document.createElement("p");
  text.textContent = role === "user" ? "User" : "CodePilot";
  imgDiv.appendChild(image);
  headerDiv.appendChild(imgDiv);
  headerDiv.appendChild(text);
  return headerDiv;
}

// Call this function after rendering markdown
addCopyButtons();
// Initialize UI state
updateUI();

document.addEventListener("DOMContentLoaded", () => {
  // const sidebar = document.getElementById("sidebar");
  // const toggleButton = document.getElementById("toggle-sidebar-btn");
  // const container = document.querySelector(".container");

  // toggleButton.addEventListener("click", () => {
  //   sidebar.classList.toggle("hidden");
  //   container.classList.toggle("sidebar-hidden");
  // });
  // document.addEventListener("click", (e) => {
  //   if()
  document.addEventListener("contextmenu", (event) => {    
    // Check if the clicked element is textarea
    if (event.target.tagName === "TEXTAREA") {
      menu.style.display = "none"; // Hide the menu if not in a message
      return; // Allow default context menu for textarea
    } 
    event.preventDefault(); // Prevent the default context menu from appearing
    const target =
      event.target.closest(".user-message") ||
      event.target.closest(".bot-message");
    if (target) {
      selectedText = target.textContent; // Store the selected text

      menu.style.top = `${event.clientY}px`;
      menu.style.left = `${event.clientX}px`;
      menu.style.display = "block";
    }
    else{
      selectedText = ""; // Clear the selected text if not in a message
      menu.style.display = "none"; // Hide the menu if not in a message
    }

    // Otherwise prevent default context menu (optional)
    // event.preventDefault();
  });
  document.addEventListener("click", () => {
    menu.style.display = "none"; // Hide menu on click
  });

  const textarea = document.getElementById("question-input");

  textarea.addEventListener("input", function () {
    // Reset to content-less height first
    this.style.height = "auto";
    // Then set to scrollHeight (capped at 150px)
    this.style.height = Math.min(this.scrollHeight - 4, 150) + "px";
  });
});

function handleCopy(event) {  
  if (selectedText) {
    navigator.clipboard.writeText(selectedText);
    selectedText = ""; // Clear the selected text after copying
  }
}

// For handling slash commands
questionInput.addEventListener("input", handleSlashCommands);
questionInput.addEventListener("keydown", handleSlashCommandNavigation);

// Close slash command menu when clicking elsewhere
document.addEventListener("click", (e) => {
  if (
    !questionInput.contains(e.target) &&
    !slashCommandMenu.contains(e.target)
  ) {
    hideSlashCommandMenu();
  }
});

// Clear selected template
clearTemplateBtn.addEventListener("click", () => {
  clearSelectedTemplate();
});

// Function to handle slash commands
function handleSlashCommands() {
  const text = questionInput.value;

  // Reset menu state if input is empty
  if (!text) {
    hideSlashCommandMenu();
    return;
  }

  // Check if the input starts with "/" and not just spaces
  if (text.trim().startsWith("/")) {
    const query = text.trim().substring(1).toLowerCase();

    // Show and populate the slash command menu
    showSlashCommandMenu(query);
  } else {
    // Hide the menu if not a slash command
    hideSlashCommandMenu();
  }
}

// Function to show and populate the slash command menu
function showSlashCommandMenu(query = "") {
  isSlashCommandMenuOpen = true;
  slashCommandMenu.style.display = "block";

  // Filter templates based on query
  const filteredTemplates = availableTemplates.filter(
    (template) =>
      template.name.toLowerCase().includes(query) ||
      template.description.toLowerCase().includes(query)
  );

  // Clear previous items
  slashCommandList.innerHTML = "";

  if (filteredTemplates.length === 0) {
    const noResults = document.createElement("div");
    noResults.className = "slash-command-item";
    noResults.textContent = "No matching templates found";
    slashCommandList.appendChild(noResults);
  } else {
    // Add filtered templates to the menu
    filteredTemplates.forEach((template, index) => {
      const item = document.createElement("div");
      item.className = "slash-command-item";
      item.setAttribute("data-template-id", template.id);
      item.innerHTML = `
        <span class="slash-command-name">${template.name}</span>
        <span class="slash-command-description">${template.description}</span>
      `;

      // Highlight if selected
      if (index === selectedCommandIndex) {
        item.classList.add("selected");
      }

      // Select template on click
      item.addEventListener("click", () => {
        selectTemplate(template);
        hideSlashCommandMenu();
      });

      slashCommandList.appendChild(item);
    });
  }
}

// Function to hide the slash command menu
function hideSlashCommandMenu() {
  isSlashCommandMenuOpen = false;
  slashCommandMenu.style.display = "none";
  selectedCommandIndex = -1;
}

// Function to navigate through slash commands with keyboard
function handleSlashCommandNavigation(e) {
  if (!isSlashCommandMenuOpen) {
    return;
  }

  const items = slashCommandList.querySelectorAll(".slash-command-item");
  if (items.length === 0) {
    return;
  }

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      selectedCommandIndex = (selectedCommandIndex + 1) % items.length;
      updateSelectedCommand();
      break;

    case "ArrowUp":
      e.preventDefault();
      selectedCommandIndex =
        (selectedCommandIndex - 1 + items.length) % items.length;
      updateSelectedCommand();
      break;

    case "Enter":
    case "Tab":
      if (selectedCommandIndex >= 0) {
        e.preventDefault();
        const selectedItem = items[selectedCommandIndex];
        const templateId = selectedItem.getAttribute("data-template-id");
        const template = availableTemplates.find((t) => t.id === templateId);
        if (template) {
          selectTemplate(template);
          hideSlashCommandMenu();
        }
      }
      break;

    case "Escape":
      e.preventDefault();
      hideSlashCommandMenu();
      break;
  }
}

// Update the selected command highlight
function updateSelectedCommand() {
  const items = slashCommandList.querySelectorAll(".slash-command-item");
  items.forEach((item, index) => {
    if (index === selectedCommandIndex) {
      item.classList.add("selected");
      item.scrollIntoView({ block: "nearest" });
    } else {
      item.classList.remove("selected");
    }
  });
}

// Select a template
function selectTemplate(template) {
  currentTemplate = template;
  templateName.textContent = template.name;
  templateIndicator.classList.add("active");

  // Clear the slash command from input
  questionInput.value = "";

  // Notify the extension about template selection
  vscode.postMessage({
    command: "selectTemplate",
    templateId: template.id,
  });
}

// Clear the selected template
function clearSelectedTemplate() {
  currentTemplate = null;
  templateIndicator.classList.remove("active");

  // Reset to default template
  vscode.postMessage({
    command: "selectTemplate",
    templateId: "general_coding", // Default template ID
  });
}

// Update the original templateSelector function
function updateTemplateSelector(templates, currentTemplateId) {
  // Store templates for slash commands
  availableTemplates = templates;

  // Set current template if one is selected
  const template = templates.find((t) => t.id === currentTemplateId);
  if (template) {
    currentTemplate = template;
    templateName.textContent = template.name;
    templateIndicator.classList.add("active");
  } else {
    templateIndicator.classList.remove("active");
  }
}
