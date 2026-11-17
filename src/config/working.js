// Working Configuration Dashboard
console.log('Configuration dashboard loading...');

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing config...');
    
    // Initialize the configuration
    initializeConfig();
});

function initializeConfig() {
    // Setup tab switching
    setupTabs();
    
    // Setup color pickers
    setupColorPickers();
    
    // Setup sliders
    setupSliders();
    
    // Setup pose selection
    setupPoseSelection();
    
    // Setup outfit selection
    setupOutfitSelection();
    
    // Setup body customization
    setupBodyCustomization();
    
    // Setup face customization
    setupFaceCustomization();
    
    // Setup checkboxes
    setupCheckboxes();
    
    // Setup action buttons
    setupActionButtons();
    
    console.log('Configuration initialized successfully!');
}

function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => {
            console.log(`Tab clicked: ${tab.textContent}`);
            
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
}

function setupColorPickers() {
    const colorInputs = [
        { color: 'hairColor', text: 'hairColorText' },
        { color: 'eyeColor', text: 'eyeColorText' },
        { color: 'skinTone', text: 'skinToneText' },
        { color: 'clothingColor', text: 'clothingColorText' },
        { color: 'shoeColor', text: 'shoeColorText' },
        { color: 'accessoryColor', text: 'accessoryColorText' }
    ];
    
    colorInputs.forEach(({ color, text }) => {
        const colorInput = document.getElementById(color);
        const textInput = document.getElementById(text);
        
        if (colorInput && textInput) {
            colorInput.addEventListener('change', (e) => {
                textInput.value = e.target.value;
                console.log(`${color} changed to ${e.target.value}`);
                updateAvatar();
            });
            
            textInput.addEventListener('change', (e) => {
                colorInput.value = e.target.value;
                console.log(`${color} text changed to ${e.target.value}`);
                updateAvatar();
            });
        }
    });
}

function setupSliders() {
    const sliders = [
        { id: 'avatarSize', valueId: 'sizeValue', property: 'size' },
        { id: 'bodyHeight', valueId: 'bodyHeightValue', property: 'bodyHeight' },
        { id: 'bodyWidth', valueId: 'bodyWidthValue', property: 'bodyWidth' },
        { id: 'animSpeed', valueId: 'animSpeedValue', property: 'animSpeed' },
        { id: 'speechRate', valueId: 'speechRateValue', property: 'speechRate' },
        { id: 'volume', valueId: 'volumeValue', property: 'volume' }
    ];
    
    sliders.forEach(({ id, valueId, property }) => {
        const slider = document.getElementById(id);
        const valueDisplay = document.getElementById(valueId);
        
        if (slider && valueDisplay) {
            slider.addEventListener('input', (e) => {
                valueDisplay.textContent = e.target.value;
                console.log(`${property} changed to ${e.target.value}`);
                updateAvatar();
            });
        }
    });
}

function setupPoseSelection() {
    const poseCards = document.querySelectorAll('.pose-card');
    poseCards.forEach(card => {
        card.addEventListener('click', () => {
            console.log(`Pose selected: ${card.dataset.pose}`);
            poseCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            updateAvatar();
        });
    });
}

function setupOutfitSelection() {
    const outfitCards = document.querySelectorAll('.outfit-card');
    outfitCards.forEach(card => {
        card.addEventListener('click', () => {
            console.log(`Outfit selected: ${card.dataset.outfit}`);
            outfitCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            updateAvatar();
        });
    });
}

function setupBodyCustomization() {
    // Body type selection
    const bodyTypes = document.querySelectorAll('.body-type-card');
    bodyTypes.forEach(card => {
        card.addEventListener('click', () => {
            console.log(`Body type selected: ${card.dataset.bodyType}`);
            bodyTypes.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            updateAvatar();
        });
    });
    
    // Body shape sliders
    const bodySliders = ['bodyHeight', 'bodyWidth', 'shoulderWidth', 'waistSize'];
    bodySliders.forEach(sliderId => {
        const slider = document.getElementById(sliderId);
        const valueDisplay = document.getElementById(sliderId + 'Value');
        
        if (slider && valueDisplay) {
            slider.addEventListener('input', (e) => {
                valueDisplay.textContent = e.target.value;
                updateAvatar();
            });
        }
    });
}

function setupFaceCustomization() {
    // Face shape selection
    const faceShapes = document.querySelectorAll('.face-shape-card');
    faceShapes.forEach(card => {
        card.addEventListener('click', () => {
            console.log(`Face shape selected: ${card.dataset.faceShape}`);
            faceShapes.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            updateAvatar();
        });
    });
    
    // Eye style selection
    const eyeStyles = document.querySelectorAll('.eye-style-card');
    eyeStyles.forEach(card => {
        card.addEventListener('click', () => {
            console.log(`Eye style selected: ${card.dataset.eyeStyle}`);
            eyeStyles.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            updateAvatar();
        });
    });
    
    // Hair style selection
    const hairStyles = document.querySelectorAll('.hair-style-card');
    hairStyles.forEach(card => {
        card.addEventListener('click', () => {
            console.log(`Hair style selected: ${card.dataset.hairStyle}`);
            hairStyles.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            updateAvatar();
        });
    });
    
    // Facial features sliders
    const featureSliders = ['eyeSize', 'noseSize', 'mouthSize', 'faceRoundness'];
    featureSliders.forEach(sliderId => {
        const slider = document.getElementById(sliderId);
        const valueDisplay = document.getElementById(sliderId + 'Value');
        
        if (slider && valueDisplay) {
            slider.addEventListener('input', (e) => {
                valueDisplay.textContent = e.target.value;
                updateAvatar();
            });
        }
    });
}

function setupCheckboxes() {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            console.log(`Checkbox ${e.target.id} changed to ${e.target.checked}`);
            updateAvatar();
        });
    });
}

function setupActionButtons() {
    // Action buttons
    const saveBtn = document.querySelector('[onclick="saveSettings()"]');
    const applyBtn = document.querySelector('[onclick="applySettings()"]');
    const testBtn = document.querySelector('[onclick="testVoice()"]');
    const resetBtn = document.querySelector('[onclick="resetSettings()"]');
    const clearBtn = document.querySelector('[onclick="clearCache()"]');
    
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            console.log('Save settings clicked');
            saveSettings();
        });
    }
    
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            console.log('Apply settings clicked');
            applySettings();
        });
    }
    
    if (testBtn) {
        testBtn.addEventListener('click', () => {
            console.log('Test voice clicked');
            testVoice();
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
}

function updateAvatar() {
    // Collect all configuration values
    const config = collectConfiguration();
    
    // Send update to avatar window
    if (window.api && window.api.updateAvatar) {
        window.api.updateAvatar(config);
    }
    
    // Send to main process for persistence
    if (window.api && window.api.updateAvatarAppearance) {
        window.api.updateAvatarAppearance(config.appearance);
    }
    
    console.log('Avatar updated with config:', config);
}

function collectConfiguration() {
    return {
        appearance: {
            // Colors
            hairColor: document.getElementById('hairColor')?.value || '#8B4513',
            eyeColor: document.getElementById('eyeColor')?.value || '#4169E1',
            skinTone: document.getElementById('skinTone')?.value || '#FDBCB4',
            clothingColor: document.getElementById('clothingColor')?.value || '#4169E1',
            shoeColor: document.getElementById('shoeColor')?.value || '#333333',
            accessoryColor: document.getElementById('accessoryColor')?.value || '#FFD700',
            
            // Body
            bodyType: document.querySelector('.body-type-card.selected')?.dataset.bodyType || 'average',
            bodyHeight: parseInt(document.getElementById('bodyHeight')?.value || '150'),
            bodyWidth: parseInt(document.getElementById('bodyWidth')?.value || '100'),
            shoulderWidth: parseInt(document.getElementById('shoulderWidth')?.value || '100'),
            waistSize: parseInt(document.getElementById('waistSize')?.value || '80'),
            
            // Face
            faceShape: document.querySelector('.face-shape-card.selected')?.dataset.faceShape || 'oval',
            eyeStyle: document.querySelector('.eye-style-card.selected')?.dataset.eyeStyle || 'normal',
            hairStyle: document.querySelector('.hair-style-card.selected')?.dataset.hairStyle || 'short',
            eyeSize: parseInt(document.getElementById('eyeSize')?.value || '50'),
            noseSize: parseInt(document.getElementById('noseSize')?.value || '50'),
            mouthSize: parseInt(document.getElementById('mouthSize')?.value || '50'),
            faceRoundness: parseInt(document.getElementById('faceRoundness')?.value || '50'),
            
            // Outfit
            outfit: document.querySelector('.outfit-card.selected')?.dataset.outfit || 'casual',
            pose: document.querySelector('.pose-card.selected')?.dataset.pose || 'idle',
            size: parseInt(document.getElementById('avatarSize')?.value || '150')
        },
        behavior: {
            position: {
                x: parseInt(document.getElementById('posX')?.value || '100'),
                y: parseInt(document.getElementById('posY')?.value || '100')
            },
            alwaysOnTop: document.getElementById('alwaysOnTop')?.checked || false,
            clickThrough: document.getElementById('clickThrough')?.checked || false,
            autoHide: document.getElementById('autoHide')?.checked || false,
            animSpeed: parseFloat(document.getElementById('animSpeed')?.value || '1.0'),
            floatingAnim: document.getElementById('floatingAnim')?.checked || false,
            idleRotation: document.getElementById('idleRotation')?.checked || false
        },
        voice: {
            engine: document.getElementById('voiceEngine')?.value || 'system',
            rate: parseFloat(document.getElementById('speechRate')?.value || '1.0'),
            volume: parseInt(document.getElementById('volume')?.value || '100'),
            enabled: document.getElementById('voiceEnabled')?.checked !== false,
            inputEnabled: document.getElementById('voiceInput')?.checked || false
        },
        advanced: {
            port: parseInt(document.getElementById('serverPort')?.value || '8080'),
            logLevel: document.getElementById('logLevel')?.value || 'info',
            debugMode: document.getElementById('enableDebug')?.checked || false
        }
    };
}

function saveSettings() {
    const config = collectConfiguration();
    
    // Save to localStorage
    localStorage.setItem('avatarConfig', JSON.stringify(config));
    
    // Send to main process
    if (window.api && window.api.saveConfig) {
        window.api.saveConfig(config);
    }
    
    showNotification('Settings saved successfully!', 'success');
}

function applySettings() {
    const config = collectConfiguration();
    
    // Send to main process for immediate application
    if (window.api && window.api.applyConfig) {
        window.api.applyConfig(config);
    }
    
    showNotification('Settings applied!', 'info');
}

function testVoice() {
    const text = document.getElementById('testText')?.value || 'Hello! I\'m your avatar assistant.';
    const voiceConfig = collectConfiguration().voice;
    
    if (window.api && window.api.testVoice) {
        window.api.testVoice(text, voiceConfig);
        showNotification('Voice test initiated', 'info');
    }
}

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
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
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

window.saveSettings = saveSettings;
window.applySettings = applySettings;
window.testVoice = testVoice;
window.resetSettings = function() {
    if (confirm('Reset all settings?')) {
        localStorage.removeItem('avatarConfig');
        location.reload();
    }
};

window.clearCache = function() {
    localStorage.clear();
    showNotification('Cache cleared!', 'info');
};

console.log('Working config script loaded');
