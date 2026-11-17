// Configuration Dashboard JavaScript
// This file provides the functionality for the configuration dashboard

// Wait for DOM to be loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('Configuration dashboard loaded');
    
    // Check if we're in the Electron environment
    if (window.api) {
        console.log('Electron API available');
        initializeConfig();
    } else {
        console.log('Running in browser mode');
        initializeBrowserMode();
    }
});

function initializeConfig() {
    // Load current configuration
    loadConfiguration();
    
    // Setup event listeners
    setupEventListeners();
    
    // Check service status
    updateServiceStatus();
    
    // Periodic status check
    setInterval(updateServiceStatus, 5000);
}

function initializeBrowserMode() {
    // Browser fallback mode
    console.log('Browser mode - limited functionality');
    setupBasicEventListeners();
}

async function loadConfiguration() {
    try {
        const config = await window.api.getConfig();
        if (config) {
            updateUIWithConfig(config);
        }
    } catch (error) {
        console.error('Failed to load configuration:', error);
    }
}

function updateUIWithConfig(config) {
    // Update appearance settings
    if (config.appearance) {
        updateAppearanceUI(config.appearance);
    }
    
    // Update behavior settings
    if (config.behavior) {
        updateBehaviorUI(config.behavior);
    }
    
    // Update voice settings
    if (config.voice) {
        updateVoiceUI(config.voice);
    }
    
    // Update advanced settings
    if (config.advanced) {
        updateAdvancedUI(config.advanced);
    }
}

function updateAppearanceUI(appearance) {
    // Update color inputs
    ['hairColor', 'eyeColor', 'skinTone'].forEach(field => {
        const colorInput = document.getElementById(field);
        const textInput = document.getElementById(field + 'Text');
        
        if (colorInput && appearance[field]) {
            colorInput.value = appearance[field];
            if (textInput) textInput.value = appearance[field];
        }
    });
    
    // Update pose selection
    if (appearance.pose) {
        document.querySelectorAll('.pose-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.pose === appearance.pose);
        });
    }
    
    // Update outfit selection
    if (appearance.outfit) {
        document.querySelectorAll('.outfit-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.outfit === appearance.outfit);
        });
    }
    
    // Update size
    if (appearance.size) {
        const sizeSlider = document.getElementById('avatarSize');
        const sizeValue = document.getElementById('sizeValue');
        if (sizeSlider) sizeSlider.value = appearance.size;
        if (sizeValue) sizeValue.textContent = appearance.size;
    }
}

function updateBehaviorUI(behavior) {
    // Update position
    if (behavior.position) {
        const posX = document.getElementById('posX');
        const posY = document.getElementById('posY');
        if (posX) posX.value = behavior.position.x || 100;
        if (posY) posY.value = behavior.position.y || 100;
    }
    
    // Update checkboxes
    const checkboxes = {
        'alwaysOnTop': behavior.alwaysOnTop,
        'clickThrough': behavior.clickThrough,
        'autoHide': behavior.autoHide,
        'floatingAnim': behavior.floatingAnim,
        'idleRotation': behavior.idleRotation
    };
    
    Object.entries(checkboxes).forEach(([id, value]) => {
        const checkbox = document.getElementById(id);
        if (checkbox) checkbox.checked = value;
    });
    
    // Update animation speed
    if (behavior.animSpeed) {
        const animSpeed = document.getElementById('animSpeed');
        const animSpeedValue = document.getElementById('animSpeedValue');
        if (animSpeed) animSpeed.value = behavior.animSpeed;
        if (animSpeedValue) animSpeedValue.textContent = behavior.animSpeed;
    }
}

function updateVoiceUI(voice) {
    // Update voice engine
    if (voice.engine) {
        const voiceEngine = document.getElementById('voiceEngine');
        if (voiceEngine) voiceEngine.value = voice.engine;
    }
    
    // Update sliders
    if (voice.rate) {
        const speechRate = document.getElementById('speechRate');
        const speechRateValue = document.getElementById('speechRateValue');
        if (speechRate) speechRate.value = voice.rate;
        if (speechRateValue) speechRateValue.textContent = voice.rate;
    }
    
    if (voice.volume !== undefined) {
        const volume = document.getElementById('volume');
        const volumeValue = document.getElementById('volumeValue');
        if (volume) volume.value = voice.volume;
        if (volumeValue) volumeValue.textContent = voice.volume;
    }
    
    // Update checkboxes
    const voiceEnabled = document.getElementById('voiceEnabled');
    const voiceInput = document.getElementById('voiceInput');
    if (voiceEnabled) voiceEnabled.checked = voice.enabled !== false;
    if (voiceInput) voiceInput.checked = voice.inputEnabled || false;
}

function updateAdvancedUI(advanced) {
    // Update port
    if (advanced.port) {
        const serverPort = document.getElementById('serverPort');
        if (serverPort) serverPort.value = advanced.port;
    }
    
    // Update log level
    if (advanced.logLevel) {
        const logLevel = document.getElementById('logLevel');
        if (logLevel) logLevel.value = advanced.logLevel;
    }
    
    // Update debug mode
    const enableDebug = document.getElementById('enableDebug');
    if (enableDebug) enableDebug.checked = advanced.debugMode || false;
}

function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            switchTab(e.target.textContent.toLowerCase());
        });
    });
    
    // Color inputs
    ['hairColor', 'eyeColor', 'skinTone'].forEach(field => {
        const colorInput = document.getElementById(field);
        const textInput = document.getElementById(field + 'Text');
        
        if (colorInput && textInput) {
            colorInput.addEventListener('change', (e) => {
                textInput.value = e.target.value;
                updateAppearanceConfig(field, e.target.value);
            });
            
            textInput.addEventListener('change', (e) => {
                colorInput.value = e.target.value;
                updateAppearanceConfig(field, e.target.value);
            });
        }
    });
    
    // Pose selection
    document.querySelectorAll('.pose-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.pose-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            updateAppearanceConfig('pose', card.dataset.pose);
        });
    });
    
    // Outfit selection
    document.querySelectorAll('.outfit-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.outfit-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            updateAppearanceConfig('outfit', card.dataset.outfit);
        });
    });
    
    // Sliders
    setupSlider('avatarSize', 'sizeValue', 'appearance', 'size', parseInt);
    setupSlider('animSpeed', 'animSpeedValue', 'behavior', 'animSpeed', parseFloat);
    setupSlider('speechRate', 'speechRateValue', 'voice', 'rate', parseFloat);
    setupSlider('volume', 'volumeValue', 'voice', 'volume', parseInt);
    
    // Checkboxes
    setupCheckboxListeners();
    
    // Action buttons
    setupActionButtons();
}

function setupSlider(sliderId, valueId, category, field, converter) {
    const slider = document.getElementById(sliderId);
    const valueDisplay = document.getElementById(valueId);
    
    if (slider && valueDisplay) {
        slider.addEventListener('input', (e) => {
            const value = converter(e.target.value);
            valueDisplay.textContent = e.target.value;
            updateConfig(category, field, value);
        });
    }
}

function setupCheckboxListeners() {
    const checkboxMappings = {
        'alwaysOnTop': ['behavior', 'alwaysOnTop'],
        'clickThrough': ['behavior', 'clickThrough'],
        'autoHide': ['behavior', 'autoHide'],
        'floatingAnim': ['behavior', 'floatingAnim'],
        'idleRotation': ['behavior', 'idleRotation'],
        'voiceEnabled': ['voice', 'enabled'],
        'voiceInput': ['voice', 'inputEnabled'],
        'enableDebug': ['advanced', 'debugMode']
    };
    
    Object.entries(checkboxMappings).forEach(([id, [category, field]]) => {
        const checkbox = document.getElementById(id);
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                updateConfig(category, field, e.target.checked);
            });
        }
    });
}

function setupActionButtons() {
    // Save button
    const saveBtn = document.querySelector('[onclick="saveSettings()"]');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveSettings);
    }
    
    // Apply button
    const applyBtn = document.querySelector('[onclick="applySettings()"]');
    if (applyBtn) {
        applyBtn.addEventListener('click', applySettings);
    }
    
    // Test voice button
    const testBtn = document.querySelector('[onclick="testVoice()"]');
    if (testBtn) {
        testBtn.addEventListener('click', testVoice);
    }
    
    // Reset button
    const resetBtn = document.querySelector('[onclick="resetSettings()"]');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetSettings);
    }
    
    // Clear cache button
    const clearBtn = document.querySelector('[onclick="clearCache()"]');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearCache);
    }
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    
    // Find and activate the correct tab
    document.querySelectorAll('.tab').forEach(tab => {
        if (tab.textContent.toLowerCase().includes(tabName)) {
            tab.classList.add('active');
        }
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    const targetContent = document.getElementById(tabName);
    if (targetContent) {
        targetContent.classList.add('active');
    }
}

function updateConfig(category, field, value) {
    // This would typically update a local config object
    console.log(`Config update: ${category}.${field} = ${value}`);
}

function updateAppearanceConfig(field, value) {
    if (window.api && window.api.updateAvatarAppearance) {
        window.api.updateAvatarAppearance({ [field]: value });
    }
}

async function updateServiceStatus() {
    if (window.api && window.api.getServiceStatus) {
        try {
            const status = await window.api.getServiceStatus();
            const statusElement = document.getElementById('serviceStatus');
            
            if (statusElement) {
                if (status.running) {
                    statusElement.className = 'status-indicator online';
                    statusElement.innerHTML = '<span class="status-dot"></span><span>Service Running</span>';
                } else {
                    statusElement.className = 'status-indicator offline';
                    statusElement.innerHTML = '<span class="status-dot"></span><span>Service Stopped</span>';
                }
            }
        } catch (error) {
            console.error('Failed to get service status:', error);
        }
    }
}

async function saveSettings() {
    try {
        if (window.api && window.api.saveConfig) {
            const config = collectCurrentConfig();
            await window.api.saveConfig(config);
            showNotification('Settings saved successfully!', 'success');
        }
    } catch (error) {
        console.error('Failed to save settings:', error);
        showNotification('Failed to save settings', 'error');
    }
}

async function applySettings() {
    try {
        if (window.api && window.api.applyConfig) {
            const config = collectCurrentConfig();
            await window.api.applyConfig(config);
            showNotification('Settings applied!', 'info');
        }
    } catch (error) {
        console.error('Failed to apply settings:', error);
        showNotification('Failed to apply settings', 'error');
    }
}

function collectCurrentConfig() {
    // Collect all form data into a config object
    const config = {
        appearance: collectAppearanceConfig(),
        behavior: collectBehaviorConfig(),
        voice: collectVoiceConfig(),
        advanced: collectAdvancedConfig()
    };
    
    return config;
}

function collectAppearanceConfig() {
    return {
        hairColor: document.getElementById('hairColor')?.value || '#8B4513',
        eyeColor: document.getElementById('eyeColor')?.value || '#4169E1',
        skinTone: document.getElementById('skinTone')?.value || '#FDBCB4',
        pose: document.querySelector('.pose-card.selected')?.dataset.pose || 'idle',
        outfit: document.querySelector('.outfit-card.selected')?.dataset.outfit || 'casual',
        size: parseInt(document.getElementById('avatarSize')?.value || '150')
    };
}

function collectBehaviorConfig() {
    return {
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
    };
}

function collectVoiceConfig() {
    return {
        engine: document.getElementById('voiceEngine')?.value || 'system',
        rate: parseFloat(document.getElementById('speechRate')?.value || '1.0'),
        volume: parseInt(document.getElementById('volume')?.value || '100'),
        enabled: document.getElementById('voiceEnabled')?.checked || false,
        inputEnabled: document.getElementById('voiceInput')?.checked || false
    };
}

function collectAdvancedConfig() {
    return {
        port: parseInt(document.getElementById('serverPort')?.value || '8080'),
        logLevel: document.getElementById('logLevel')?.value || 'info',
        debugMode: document.getElementById('enableDebug')?.checked || false
    };
}

async function testVoice() {
    try {
        const text = document.getElementById('testText')?.value || 'Hello! I\'m your avatar assistant.';
        const voiceConfig = collectVoiceConfig();
        
        if (window.api && window.api.testVoice) {
            await window.api.testVoice(text, voiceConfig);
            showNotification('Voice test initiated', 'info');
        }
    } catch (error) {
        console.error('Failed to test voice:', error);
        showNotification('Failed to test voice', 'error');
    }
}

function resetSettings() {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
        localStorage.removeItem('avatarConfig');
        location.reload();
    }
}

function clearCache() {
    if (confirm('Are you sure you want to clear the cache?')) {
        localStorage.clear();
        showNotification('Cache cleared!', 'info');
    }
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

function setupBasicEventListeners() {
    // Basic tab switching for browser mode
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            switchTab(e.target.textContent.toLowerCase());
        });
    });
}

// Export functions for global access
window.switchTab = switchTab;
window.saveSettings = saveSettings;
window.applySettings = applySettings;
window.testVoice = testVoice;
window.resetSettings = resetSettings;
window.clearCache = clearCache;
