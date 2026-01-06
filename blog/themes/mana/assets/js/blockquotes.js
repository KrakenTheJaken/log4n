/**
 * Blockquote/Alert toggle functionality
 * Handles collapsible alerts/admonitions
 */
(function () {
  'use strict';

  // Initialize alert toggles
  function initAlertToggles() {
    const alertHeaders = document.querySelectorAll('.alert-collapsible .alert-header');
    
    alertHeaders.forEach((header) => {
      // Skip if already initialized
      if (header.dataset.initialized === 'true') {
        return;
      }
      
      header.dataset.initialized = 'true';
      header.addEventListener('click', function () {
        const alert = this.closest('.alert-collapsible');
        const content = alert.querySelector('.alert-content');
        const toggle = alert.querySelector('.alert-toggle');
        
        if (!content || !toggle) {
          return;
        }
        
        const isCollapsed = content.style.display === 'none' || 
                           alert.dataset.collapsed === 'true';
        
        if (isCollapsed) {
          content.style.display = 'block';
          toggle.textContent = '−';
          alert.dataset.collapsed = 'false';
        } else {
          content.style.display = 'none';
          toggle.textContent = '+';
          alert.dataset.collapsed = 'true';
        }
      });
    });
  }

  // Initialize on DOM content loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAlertToggles);
  } else {
    initAlertToggles();
  }

  // Re-initialize for dynamically loaded content
  if (typeof window !== 'undefined') {
    window.initAlertToggles = initAlertToggles;
  }
})();

