// Simple configuration dashboard
console.log('Config dashboard loading...');

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing config...');
    
    // Add basic functionality
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    if (tabs.length === 0) {
        console.error('No tabs found');
        return;
    }
    
    console.log(`Found ${tabs.length} tabs and ${tabContents.length} tab contents`);
    
    // Tab switching
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => {
            console.log(`Tab ${index} clicked: ${tab.textContent}`);
            
            // Remove active class from all tabs and contents
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked tab and corresponding content
            tab.classList.add('active');
            if (tabContents[index]) {
                tabContents[index].classList.add('active');
            }
        });
    });
    
    // Color inputs
    const colorInputs = ['hairColor', 'eyeColor', 'skinTone'];
    colorInputs.forEach(field => {
        const colorInput = document.getElementById(field);
        const textInput = document.getElementById(field + 'Text');
        
        if (colorInput && textInput) {
            console.log(`Setting up color input for ${field}`);
            
            colorInput.addEventListener('change', (e) => {
                textInput.value = e.target.value;
                console.log(`${field} changed to ${e.target.value}`);
            });
            
            textInput.addEventListener('change', (e) => {
                colorInput.value = e.target.value;
                console.log(`${field} text changed to ${e.target.value}`);
            });
        }
    });
    
    // Pose selection
    const poseCards = document.querySelectorAll('.pose-card');
    poseCards.forEach(card => {
        card.addEventListener('click', () => {
            console.log(`Pose selected: ${card.dataset.pose}`);
            poseCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
        });
    });
    
    // Outfit selection
    const outfitCards = document.querySelectorAll('.outfit-card');
    outfitCards.forEach(card => {
        card.addEventListener('click', () => {
            console.log(`Outfit selected: ${card.dataset.outfit}`);
            outfitCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
        });
    });
    
    // Sliders
    const setupSlider = (sliderId, valueId, callback) => {
        const slider = document.getElementById(sliderId);
        const valueDisplay = document.getElementById(valueId);
        
        if (slider && valueDisplay) {
            slider.addEventListener('input', (e) => {
                valueDisplay.textContent = e.target.value;
                if (callback) callback(e.target.value);
            });
        }
    };
    
    setupSlider('avatarSize', 'sizeValue');
    setupSlider('animSpeed', 'animSpeedValue');
    setupSlider('speechRate', 'speechRateValue');
    setupSlider('volume', 'volumeValue');
    
    // Checkboxes
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            console.log(`Checkbox ${e.target.id} changed to ${e.target.checked}`);
        });
    });
    
    // Action buttons
    const saveBtn = document.querySelector('[onclick="saveSettings()"]');
    const applyBtn = document.querySelector('[onclick="applySettings()"]');
    const testBtn = document.querySelector('[onclick="testVoice()"]');
    const resetBtn = document.querySelector('[onclick="resetSettings()"]');
    const clearBtn = document.querySelector('[onclick="clearCache()"]');
    
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            console.log('Save settings clicked');
            showNotification('Settings saved!', 'success');
        });
    }
    
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            console.log('Apply settings clicked');
            showNotification('Settings applied!', 'info');
        });
    }
    
    if (testBtn) {
        testBtn.addEventListener('click', () => {
            console.log('Test voice clicked');
            showNotification('Voice test!', 'info');
        });
    }
    
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (confirm('Reset all settings?')) {
                console.log('Settings reset');
                location.reload();
            }
        });
    }
    
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            console.log('Cache cleared');
            showNotification('Cache cleared!', 'info');
        });
    }
    
    console.log('Configuration dashboard initialized successfully!');
});

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 600;
        z-index: 1000;
        background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#17a2b8'};
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Global functions for onclick handlers
window.switchTab = function(tabName) {
    console.log(`Switching to tab: ${tabName}`);
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    
    tabs.forEach(tab => {
        if (tab.textContent.toLowerCase().includes(tabName)) {
            tab.classList.add('active');
        }
    });
    
    const targetContent = document.getElementById(tabName);
    if (targetContent) {
        targetContent.classList.add('active');
    }
};

window.saveSettings = function() {
    console.log('Save settings called');
    showNotification('Settings saved!', 'success');
};

window.applySettings = function() {
    console.log('Apply settings called');
    showNotification('Settings applied!', 'info');
};

window.testVoice = function() {
    console.log('Test voice called');
    showNotification('Voice test!', 'info');
};

window.resetSettings = function() {
    if (confirm('Reset all settings?')) {
        location.reload();
    }
};

window.clearCache = function() {
    showNotification('Cache cleared!', 'info');
};

console.log('Simple config script loaded');
