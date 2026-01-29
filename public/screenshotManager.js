/**
 * Screenshot Manager
 * Handles screenshot upload, editing, deletion, and map marker display
 */
(function() {
  const API_BASE = '/api';
  let screenshots = [];
  let currentScreenshot = null;
  let contextX = null;
  let contextY = null;

  const modal = document.getElementById('screenshots-window');
  const closeBtn = document.getElementById('screenshots-close-btn');
  const saveBtn = document.getElementById('screenshot-save-btn');
  const deleteBtn = document.getElementById('screenshot-delete-btn');
  const cancelBtn = document.getElementById('screenshot-cancel-btn');
  const fileInput = document.getElementById('screenshot-file-input');
  const previewDiv = document.getElementById('screenshot-preview');
  const previewImg = document.getElementById('screenshot-preview-img');
  const listDiv = document.getElementById('screenshots-list');

  const nameEnInput = document.getElementById('screenshot-name-en');
  const nameDeInput = document.getElementById('screenshot-name-de');
  const nameEsInput = document.getElementById('screenshot-name-es');
  const descEnInput = document.getElementById('screenshot-desc-en');
  const descDeInput = document.getElementById('screenshot-desc-de');
  const descEsInput = document.getElementById('screenshot-desc-es');
  const locationInput = document.getElementById('screenshot-location');
  const charactersInput = document.getElementById('screenshot-characters');
  const xInput = document.getElementById('screenshot-x');
  const yInput = document.getElementById('screenshot-y');

  // Make window draggable
  function initDraggable() {
    const header = document.getElementById('screenshots-header');
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    header.addEventListener('mousedown', (e) => {
      if (e.target === closeBtn) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = modal.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      modal.style.transform = 'none';
      modal.style.left = startLeft + 'px';
      modal.style.top = startTop + 'px';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      modal.style.left = (startLeft + dx) + 'px';
      modal.style.top = (startTop + dy) + 'px';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  async function loadScreenshots() {
    try {
      const headers = {};
      if (window.gameState && window.gameState.sessionToken) {
        headers['X-Session-Token'] = window.gameState.sessionToken;
      }
      const res = await fetch(`${API_BASE}/screenshots`, { 
        method: 'GET', 
        headers, 
        credentials: 'same-origin' 
      });
      const data = await res.json();
      if (data.success) {
        screenshots = data.screenshots || [];
        renderScreenshots();
      } else {
        console.error('Failed to load screenshots:', data.error);
      }
    } catch (e) {
      console.error('Failed to load screenshots:', e);
    }
  }

  function getScreenshotUrl(filename) {
    return `https://cor-forum.de/regnum/RegnumNostalgia/screenshots/${filename}`;
  }

  function renderScreenshots() {
    if (screenshots.length === 0) {
      listDiv.innerHTML = '<div style="text-align: center; color: #888; font-size: 10px; padding: 20px;">No screenshots</div>';
      return;
    }

    listDiv.innerHTML = '';
    screenshots.forEach(s => {
      const div = document.createElement('div');
      div.style.cssText = 'padding: 6px; background: rgba(0,0,0,0.3); border: 1px solid #2a3f5f; border-radius: 2px; cursor: pointer; font-size: 10px; color: #e0e0e0; transition: all 0.15s;';
      div.addEventListener('mouseenter', () => {
        div.style.background = 'rgba(0,0,0,0.5)';
        div.style.borderColor = '#3b82f6';
      });
      div.addEventListener('mouseleave', () => {
        div.style.background = 'rgba(0,0,0,0.3)';
        div.style.borderColor = '#2a3f5f';
      });

      const name = s.name?.en || s.name?.de || s.name?.es || 'Unnamed';
      const coords = `[${s.x}, ${s.y}]`;
      
      div.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</div>
        <div style="color: #888; font-size: 9px;">${coords}</div>
        <div style="margin-top: 4px; max-height: 60px; overflow: hidden;">
          <img src="${getScreenshotUrl(s.filename)}" style="width: 100%; height: auto; border-radius: 2px;">
        </div>
      `;

      div.addEventListener('click', () => {
        loadScreenshotToForm(s);
      });

      listDiv.appendChild(div);
    });
  }

  function loadScreenshotToForm(s) {
    currentScreenshot = s;
    
    nameEnInput.value = s.name?.en || '';
    nameDeInput.value = s.name?.de || '';
    nameEsInput.value = s.name?.es || '';
    descEnInput.value = s.description?.en || '';
    descDeInput.value = s.description?.de || '';
    descEsInput.value = s.description?.es || '';
    locationInput.value = s.location || '';
    charactersInput.value = s.visibleCharacters || '';
    xInput.value = s.x;
    yInput.value = s.y;

    // Show existing screenshot preview
    previewImg.src = getScreenshotUrl(s.filename);
    previewDiv.style.display = 'block';

    // Disable file input (cannot change file on edit)
    fileInput.disabled = true;
    fileInput.style.opacity = '0.5';

    // Show delete button, hide file requirement
    deleteBtn.style.display = 'block';
    saveBtn.textContent = 'Update';
  }

  function clearForm() {
    currentScreenshot = null;
    
    nameEnInput.value = '';
    nameDeInput.value = '';
    nameEsInput.value = '';
    descEnInput.value = '';
    descDeInput.value = '';
    descEsInput.value = '';
    locationInput.value = '';
    charactersInput.value = '';
    xInput.value = contextX !== null ? contextX : '';
    yInput.value = contextY !== null ? contextY : '';

    fileInput.value = '';
    fileInput.disabled = false;
    fileInput.style.opacity = '1';
    previewDiv.style.display = 'none';
    previewImg.src = '';

    deleteBtn.style.display = 'none';
    saveBtn.textContent = 'Save';
  }

  function openModal(x, y) {
    contextX = x;
    contextY = y;
    clearForm();
    loadScreenshots();
    modal.style.display = 'flex';
  }

  function closeModal() {
    modal.style.display = 'none';
    clearForm();
  }

  // File preview
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        previewImg.src = ev.target.result;
        previewDiv.style.display = 'block';
      };
      reader.readAsDataURL(file);
    } else {
      previewDiv.style.display = 'none';
      previewImg.src = '';
    }
  });

  // Save screenshot
  saveBtn.addEventListener('click', async () => {
    const x = parseInt(xInput.value);
    const y = parseInt(yInput.value);

    if (isNaN(x) || isNaN(y)) {
      alert('X and Y coordinates are required');
      return;
    }

    try {
      saveBtn.disabled = true;
      saveBtn.textContent = currentScreenshot ? 'Updating...' : 'Saving...';

      if (currentScreenshot) {
        // Update existing screenshot
        const formData = new URLSearchParams();
        formData.append('name_en', nameEnInput.value);
        formData.append('name_de', nameDeInput.value);
        formData.append('name_es', nameEsInput.value);
        formData.append('description_en', descEnInput.value);
        formData.append('description_de', descDeInput.value);
        formData.append('description_es', descEsInput.value);
        formData.append('location', locationInput.value);
        formData.append('visible_characters', charactersInput.value);
        formData.append('x', x);
        formData.append('y', y);

        const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        if (window.gameState && window.gameState.sessionToken) {
          headers['X-Session-Token'] = window.gameState.sessionToken;
        }

        const res = await fetch(`${API_BASE}/screenshots/${currentScreenshot.id}`, {
          method: 'PUT',
          headers,
          body: formData.toString(),
          credentials: 'same-origin'
        });

        const data = await res.json();
        if (data.success) {
          alert('Screenshot updated successfully');
          clearForm();
          await loadScreenshots();
          // Refresh map markers
          if (typeof window.loadAndDisplayScreenshots === 'function') {
            window.loadAndDisplayScreenshots();
          }
        } else {
          alert('Failed to update screenshot: ' + (data.error || 'Unknown error'));
        }
      } else {
        // Create new screenshot
        if (!fileInput.files[0]) {
          alert('Please select a screenshot file');
          return;
        }

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('name_en', nameEnInput.value);
        formData.append('name_de', nameDeInput.value);
        formData.append('name_es', nameEsInput.value);
        formData.append('description_en', descEnInput.value);
        formData.append('description_de', descDeInput.value);
        formData.append('description_es', descEsInput.value);
        formData.append('location', locationInput.value);
        formData.append('visible_characters', charactersInput.value);
        formData.append('x', x);
        formData.append('y', y);

        const headers = {};
        if (window.gameState && window.gameState.sessionToken) {
          headers['X-Session-Token'] = window.gameState.sessionToken;
        }

        const res = await fetch(`${API_BASE}/screenshots`, {
          method: 'POST',
          headers,
          body: formData,
          credentials: 'same-origin'
        });

        const data = await res.json();
        if (data.success) {
          alert('Screenshot added successfully');
          clearForm();
          await loadScreenshots();
          // Refresh map markers
          if (typeof window.loadAndDisplayScreenshots === 'function') {
            window.loadAndDisplayScreenshots();
          }
        } else {
          alert('Failed to add screenshot: ' + (data.error || 'Unknown error'));
        }
      }
    } catch (e) {
      console.error('Failed to save screenshot:', e);
      alert('Failed to save screenshot: ' + e.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = currentScreenshot ? 'Update' : 'Save';
    }
  });

  // Delete screenshot
  deleteBtn.addEventListener('click', async () => {
    if (!currentScreenshot) return;
    
    if (!confirm(`Delete screenshot "${currentScreenshot.name?.en || currentScreenshot.name?.de || currentScreenshot.name?.es || 'Unnamed'}"?`)) {
      return;
    }

    try {
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';

      const headers = {};
      if (window.gameState && window.gameState.sessionToken) {
        headers['X-Session-Token'] = window.gameState.sessionToken;
      }

      const res = await fetch(`${API_BASE}/screenshots/${currentScreenshot.id}`, {
        method: 'DELETE',
        headers,
        credentials: 'same-origin'
      });

      const data = await res.json();
      if (data.success) {
        alert('Screenshot deleted successfully');
        clearForm();
        await loadScreenshots();
        // Refresh map markers
        if (typeof window.loadAndDisplayScreenshots === 'function') {
          window.loadAndDisplayScreenshots();
        }
      } else {
        alert('Failed to delete screenshot: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      console.error('Failed to delete screenshot:', e);
      alert('Failed to delete screenshot: ' + e.message);
    } finally {
      deleteBtn.disabled = false;
      deleteBtn.textContent = 'Delete';
    }
  });

  // Cancel/Close
  cancelBtn.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);

  // Initialize draggable
  initDraggable();

  // Expose API
  window.screenshotManager = {
    openModal,
    getScreenshotUrl
  };
})();
