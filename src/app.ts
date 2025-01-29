// Types
interface Note {
  id?: number;
  text: string;
  date: string;
}

// DOM Elements with null checks
function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id) as T;
  if (!element) throw new Error(`Element with id '${id}' not found`);
  return element;
}

const noteInput = getElement<HTMLTextAreaElement>('noteInput');
const saveBtn = getElement<HTMLButtonElement>('saveBtn');
const notesList = getElement<HTMLDivElement>('notesList');
const darkModeToggle = getElement<HTMLButtonElement>('darkModeToggle');
const searchInput = getElement<HTMLInputElement>('searchInput');
const searchToggle = getElement<HTMLButtonElement>('searchToggle');
const sidebarToggle = getElement<HTMLButtonElement>('sidebarToggle');
const sidebar = document.querySelector('.sidebar') as HTMLElement;
const loadingState = getElement<HTMLDivElement>('loadingState');
const emptyState = getElement<HTMLDivElement>('emptyState');
const errorToast = getElement<HTMLDivElement>('errorToast');
const wordCount = getElement<HTMLDivElement>('wordCount');
const boldBtn = getElement<HTMLButtonElement>('boldBtn');
const italicBtn = getElement<HTMLButtonElement>('italicBtn');
const underlineBtn = getElement<HTMLButtonElement>('underlineBtn');

// Database Management
class NotesDB {
  private db: IDBDatabase | null = null;
  private readonly DB_NAME = 'notesApp';
  private readonly STORE_NAME = 'notes';
  private readonly VERSION = 1;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.VERSION);

      request.onerror = () => reject(new Error('Failed to open database'));

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
    });
  }

  async getAllNotes(): Promise<Note[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Failed to fetch notes'));
    });
  }

  async addNote(note: Omit<Note, 'id'>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.add(note);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to add note'));
    });
  }

  async updateNote(note: Note): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.put(note);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to update note'));
    });
  }

  async deleteNote(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete note'));
    });
  }

  async getNoteById(id: number): Promise<Note> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Failed to fetch note'));
    });
  }
}

// App State
const db = new NotesDB();
let currentNoteId: number | null = null;
let undoStack: string[] = [];
let redoStack: string[] = [];

// UI Functions
function showToast(message: string, isError = false): void {
  errorToast.textContent = message;
  errorToast.className = `toast visible ${isError ? 'error' : 'success'}`;
  setTimeout(() => {
    errorToast.className = 'toast';
  }, 3000);
}

function updateLoadingState(loading: boolean, empty: boolean): void {
  loadingState.hidden = !loading;
  emptyState.hidden = !empty;
  notesList.style.display = loading || empty ? 'none' : 'block';
}

// Word Count
function updateWordCount(): void {
  const text = noteInput.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  wordCount.textContent = `Words: ${words} | Characters: ${chars}`;
}

// Note Management
async function loadNotes(searchTerm = ''): Promise<void> {
  try {
    updateLoadingState(true, false);
    const notes = await db.getAllNotes();
    const filteredNotes = notes
      .filter(note => note.text.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    updateLoadingState(false, filteredNotes.length === 0);
    renderNotesList(filteredNotes);
  } catch (error) {
    showToast('Failed to load notes', true);
    console.error(error);
  }
}

function renderNotesList(notes: Note[]): void {
  notesList.innerHTML = notes.map(note => `
    <div class="note" data-id="${note.id}">
      <div class="note-content">
        <div class="note-title">${note.text.split('\n')[0].substring(0, 40)}</div>
        <div class="note-timestamp">${new Date(note.date).toLocaleString()}</div>
      </div>
      <div class="note-buttons">
        <button class="edit-btn" aria-label="Edit note">✏️</button>
        <button class="delete-btn" aria-label="Delete note">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function saveNote(): Promise<void> {
  try {
    const noteText = noteInput.value.trim();
    if (!noteText) {
      showToast('Note cannot be empty', true);
      return;
    }

    const note: Note = {
      text: noteText,
      date: new Date().toISOString()
    };

    if (currentNoteId) {
      note.id = currentNoteId;
      await db.updateNote(note);
    } else {
      await db.addNote(note);
    }

    showToast('Note saved successfully');
    noteInput.value = '';
    currentNoteId = null;
    await loadNotes();
    updateWordCount();
  } catch (error) {
    showToast('Failed to save note', true);
    console.error(error);
  }
}

// Text Formatting
function applyFormat(format: string): void {
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const selectedText = noteInput.value.substring(start, end);

  undoStack.push(noteInput.value);
  redoStack = [];

  let newText = selectedText;
  let selectionOffset = 0;

  switch (format) {
    case 'bold':
      if (selectedText.startsWith('<strong>') && selectedText.endsWith('</strong>')) {
        newText = selectedText.slice(8, -9);
        selectionOffset = -8;
      } else {
        newText = `<strong>${selectedText}</strong>`;
        selectionOffset = 8;
      }
      break;
    case 'italic':
      if (selectedText.startsWith('<em>') && selectedText.endsWith('</em>')) {
        newText = selectedText.slice(4, -5);
        selectionOffset = -4;
      } else {
        newText = `<em>${selectedText}</em>`;
        selectionOffset = 4;
      }
      break;
    case 'underline':
      if (selectedText.startsWith('<u>') && selectedText.endsWith('</u>')) {
        newText = selectedText.slice(3, -4);
        selectionOffset = -3;
      } else {
        newText = `<u>${selectedText}</u>`;
        selectionOffset = 3;
      }
      break;
  }

  noteInput.setRangeText(newText, start, end, 'select');
  noteInput.focus();

  // Keep the text selected after formatting
  const newEnd = end + (newText.length - selectedText.length);
  noteInput.setSelectionRange(start, newEnd);
  
  updateWordCount();
}

// History Management
function undo(): void {
  if (undoStack.length > 0) {
    redoStack.push(noteInput.value);
    noteInput.value = undoStack.pop() || '';
    noteInput.focus();
    updateWordCount();
  }
}

function redo(): void {
  if (redoStack.length > 0) {
    undoStack.push(noteInput.value);
    noteInput.value = redoStack.pop() || '';
    noteInput.focus();
    updateWordCount();
  }
}

// Event Listeners
function setupEventListeners(): void {
  // Note Operations
  saveBtn.addEventListener('click', saveNote);
  
  notesList.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const noteElement = target.closest('.note') as HTMLElement;
    if (!noteElement) return;

    const noteId = Number(noteElement.dataset.id);
    
    if (target.classList.contains('delete-btn')) {
      if (confirm('Are you sure you want to delete this note?')) {
        try {
          await db.deleteNote(noteId);
          showToast('Note deleted successfully');
          await loadNotes();
        } catch (error) {
          showToast('Failed to delete note', true);
          console.error(error);
        }
      }
    } else if (target.classList.contains('edit-btn') || target === noteElement) {
      try {
        const note = await db.getNoteById(noteId);
        noteInput.value = note.text;
        currentNoteId = noteId;
        noteInput.focus();
        updateWordCount();
      } catch (error) {
        showToast('Failed to load note', true);
        console.error(error);
      }
    }
  });

  // Search
  const debounce = <T extends (...args: any[]) => void>(
    fn: T,
    delay: number
  ): ((...args: Parameters<T>) => void) => {
    let timeoutId: number;
    return (...args: Parameters<T>) => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => fn(...args), delay);
    };
  };

  searchInput.addEventListener('input', debounce((e) => {
    loadNotes((e.target as HTMLInputElement).value);
  }, 300));

  // UI Controls
  darkModeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode').toString());
  });

  searchToggle.addEventListener('click', () => {
    searchInput.classList.toggle('active');
    if (searchInput.classList.contains('active')) {
      searchInput.focus();
    }
  });

  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed').toString());
    if (sidebar.classList.contains('collapsed')) {
      sidebarToggle.style.left = '0';
      sidebarToggle.style.right = 'auto';
    } else {
      sidebarToggle.style.left = 'auto';
      sidebarToggle.style.right = '-20px';
    }
  });

  // Formatting buttons
  boldBtn.addEventListener('click', () => applyFormat('bold'));
  italicBtn.addEventListener('click', () => applyFormat('italic'));
  underlineBtn.addEventListener('click', () => applyFormat('underline'));

  // Text Editor
  noteInput.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) {
      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault();
          applyFormat('bold');
          break;
        case 'i':
          e.preventDefault();
          applyFormat('italic');
          break;
        case 'u':
          e.preventDefault();
          applyFormat('underline');
          break;
        case 'z':
          e.preventDefault();
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
          break;
        case 'y':
          e.preventDefault();
          redo();
          break;
        case 's':
          e.preventDefault();
          saveNote();
          break;
      }
    }
  });

  // Word count updates
  noteInput.addEventListener('input', updateWordCount);

  // Save changes before unload
  window.addEventListener('beforeunload', () => {
    if (noteInput.value.trim()) {
      saveNote();
    }
  });
}

// Initialize App
async function initializeApp(): Promise<void> {
  try {
    // Initialize database
    await db.init();
    
    // Setup event listeners
    setupEventListeners();
    
    // Load initial data
    await loadNotes();
    
    // Initialize word count
    updateWordCount();
    
    // Restore dark mode preference
    // Restore UI preferences
    const darkMode = localStorage.getItem('darkMode') === 'true';
    const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    
    if (darkMode) document.body.classList.add('dark-mode');
    if (sidebarCollapsed) sidebar.classList.add('collapsed');
  } catch (error) {
    showToast('Failed to initialize app', true);
    console.error(error);
  }
}

// Start the app
document.addEventListener('DOMContentLoaded', initializeApp);
