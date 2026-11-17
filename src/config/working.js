// Working Configuration Dashboard
console.log('Configuration dashboard loading...');

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing config...');
    
    // Initialize the configuration
    initializeConfig();
});

function getIPC() {
    return window.configAPI || window.api || null;
}

async function initializeConfig() {
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
    setupBehaviorAndVoiceInputs();
    setupVoiceList();
    
    // Setup action buttons
    setupActionButtons();

    // Load current configuration from Electron main process
    const ipc = getIPC();
    if (ipc && ipc.getConfig) {
        try {
            const saved = await ipc.getConfig();
            if (saved && saved.appearance) {
                const a = saved.appearance;
                ['hairColor', 'eyeColor', 'skinTone', 'clothingColor', 'shoeColor', 'accessoryColor'].forEach((f) => {
                    if (a[f]) {
                        const cEl = document.getElementById(f);
                        const tEl = document.getElementById(f + 'Text');
                        if (cEl) cEl.value = a[f];
                        if (tEl) tEl.value = a[f];
                    }
                });
                if (a.outfit) {
                    document.querySelectorAll('.outfit-card').forEach((c) => {
                        c.classList.toggle('selected', c.dataset.outfit === a.outfit);
                    });
                }
                if (a.pose) {
                    document.querySelectorAll('.pose-card').forEach((c) => {
                        c.classList.toggle('selected', c.dataset.pose === a.pose);
                    });
                }
                const cards = [
                    ['.face-shape-card', 'faceShape', 'faceShape'],
                    ['.eye-style-card', 'eyeStyle', 'eyeStyle'],
                    ['.hair-style-card', 'hairStyle', 'hairStyle'],
                    ['.body-type-card', 'bodyType', 'bodyType'],
                ];
                cards.forEach(([sel, key, ds]) => {
                    if (!a[key]) return;
                    document.querySelectorAll(sel).forEach((c) => c.classList.toggle('selected', c.dataset[ds] === a[key]));
                });
                ['eyeSize', 'noseSize', 'mouthSize', 'faceRoundness', 'bodyHeight', 'bodyWidth', 'shoulderWidth', 'waistSize'].forEach((k) => {
                    if (a[k] === undefined) return;
                    const el = document.getElementById(k);
                    const val = document.getElementById(k + 'Value');
                    if (el) el.value = a[k];
                    if (val) val.textContent = a[k];
                });
                if (window.__updatePreview) {
                    window.__updatePreview(a);
                }
                if (a.size !== undefined) setVal('avatarSize', a.size, 'sizeValue');
            }
            if (saved && saved.behavior) {
                const b = saved.behavior;
                if (b.position) {
                    setVal('posX', b.position.x);
                    setVal('posY', b.position.y);
                }
                ['alwaysOnTop', 'clickThrough', 'autoHide', 'floatingAnim', 'idleRotation', 'idleRoam'].forEach((k) => {
                    const el = document.getElementById(k);
                    if (el && b[k] !== undefined) el.checked = !!b[k];
                });
                if (b.animSpeed !== undefined) setVal('animSpeed', b.animSpeed, 'animSpeedValue');
                if (b.idleRoamDelay !== undefined) setVal('idleRoamDelay', b.idleRoamDelay, 'idleRoamDelayValue');
                if (window.__previewBehavior) window.__previewBehavior(b);
            }
            if (saved && saved.voice) {
                const v = saved.voice;
                if (v.engine) {
                    const sel = document.getElementById('voiceEngine');
                    if (sel) sel.dataset.wanted = v.engine;
                    setVal('voiceEngine', v.engine);
                    populateVoices();
                }
                if (v.rate !== undefined) setVal('speechRate', v.rate, 'speechRateValue');
                if (v.volume !== undefined) setVal('volume', v.volume, 'volumeValue');
                const en = document.getElementById('voiceEnabled');
                if (en && v.enabled !== undefined) en.checked = !!v.enabled;
                const inp = document.getElementById('voiceInput');
                if (inp && v.inputEnabled !== undefined) inp.checked = !!v.inputEnabled;
            }
            if (saved && saved.runtime) {
                setVal('hermesUrl', saved.runtime.wsUrl || '');
                const ls = document.getElementById('startLocalServer');
                if (ls) ls.checked = !!saved.runtime.startLocalServer;
            }
            if (saved && saved.advanced) {
                const ad = saved.advanced;
                if (ad.port) setVal('serverPort', ad.port);
                if (ad.logLevel) setVal('logLevel', ad.logLevel);
                const dbg = document.getElementById('enableDebug');
                if (dbg && ad.debugMode !== undefined) dbg.checked = !!ad.debugMode;
            }
        } catch (err) {
            console.warn('Could not load initial config:', err);
        }
    }
    
    setupServiceStatus();
    console.log('Configuration initialized successfully!');
}

function setVal(id, value, labelId) {
    const el = document.getElementById(id);
    if (el) el.value = value;
    if (labelId) {
        const l = document.getElementById(labelId);
        if (l) l.textContent = value;
    }
}

// Advanced tab: live service status
function setupServiceStatus() {
    const box = document.getElementById('serviceStatus');
    const hb = document.getElementById('hermesStatus');
    const errBox = document.getElementById('serviceError');
    if (!box) return;
    const setBox = (el, state, text) => {
        if (!el) return;
        el.classList.toggle('online', state === 'on');
        el.classList.toggle('offline', state === 'off');
        el.style.background = state === 'idle' ? '#eceff3' : '';
        el.style.color = state === 'idle' ? '#555' : '';
        const label = el.querySelector('span:last-child');
        if (label) label.textContent = text;
    };
    const render = (st) => {
        if (!st) {
            setBox(box, 'off', 'Servidor local: estado desconhecido');
            return;
        }
        // local server
        if (st.running) setBox(box, 'on', `Servidor local a correr (porta ${st.port})`);
        else if (!st.localEnabled) setBox(box, 'idle', 'Servidor local desligado (não é necessário quando ligado ao Hermes)');
        else setBox(box, 'off', 'Servidor local parado');
        if (errBox) errBox.textContent = st.localEnabled && st.error ? (st.running ? 'Aviso: ' : 'Motivo: ') + st.error : '';
        // avatar ↔ server connection
        const c = st.connection || {};
        const target = st.hermesUrl || (st.localEnabled ? `servidor local (ws://localhost:${st.port})` : '');
        if (!target) setBox(hb, 'off', 'Sem endereço do Hermes: preenche o campo abaixo');
        else if (c.connected) setBox(hb, 'on', `Avatar ligado a ${st.hermesUrl || 'servidor local'}`);
        else setBox(hb, 'off', `Avatar sem ligação a ${target}${c.error ? ' (' + c.error + ')' : ''} — a tentar de novo…`);
    };
    const ipc = getIPC();
    if (!ipc || !ipc.getServiceStatus) {
        render(null);
        return;
    }
    const poll = () => ipc.getServiceStatus().then(render).catch(() => render(null));
    poll();
    setInterval(poll, 3000);
    if (ipc.onServiceStatusChange) ipc.onServiceStatusChange(render);
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
                focusPreviewFor(tabContents[index].id);
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
        { id: 'idleRoamDelay', valueId: 'idleRoamDelayValue', property: 'idleRoamDelay' },
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

const OUTFIT_PALETTES = {
    casual: { clothingColor: '#0D0D12', accessoryColor: '#D9B35E', shoeColor: '#0D0D12' },
    formal: { clothingColor: '#1E2738', accessoryColor: '#D9B35E', shoeColor: '#1A1A1E' },
    sporty: { clothingColor: '#F06A5B', accessoryColor: '#FFFFFF', shoeColor: '#FFFFFF' },
    elegant: { clothingColor: '#7E9A6E', accessoryColor: '#DCE6D5', shoeColor: '#D9B35E' },
    cyberpunk: { clothingColor: '#111116', accessoryColor: '#E8E8F0', shoeColor: '#111116' },
    fantasy: { clothingColor: '#9EC5F8', accessoryColor: '#E6F0FF', shoeColor: '#C9DDF8' },
};

function setupOutfitSelection() {
    const outfitCards = document.querySelectorAll('.outfit-card');
    outfitCards.forEach(card => {
        card.addEventListener('click', () => {
            const style = card.dataset.outfit;
            console.log(`Outfit selected: ${style}`);
            outfitCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');

            const pal = OUTFIT_PALETTES[style];
            if (pal) {
                ['clothingColor', 'accessoryColor', 'shoeColor'].forEach((f) => {
                    const cEl = document.getElementById(f);
                    const tEl = document.getElementById(f + 'Text');
                    if (cEl) cEl.value = pal[f];
                    if (tEl) tEl.value = pal[f];
                });
            }
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

// Voice Engine: list the voices actually installed on this computer (grouped by language)
function populateVoices() {
    const sel = document.getElementById('voiceEngine');
    if (!sel || !window.speechSynthesis) return;
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    const wanted = sel.dataset.wanted || sel.value || 'system';
    const byLang = {};
    voices.forEach((v) => {
        const lang = v.lang || 'other';
        (byLang[lang] = byLang[lang] || []).push(v);
    });
    const langs = Object.keys(byLang).sort((a, b) => {
        const pref = (l) => (l.startsWith('pt') ? 0 : l.startsWith('en') ? 1 : 2);
        return pref(a) - pref(b) || a.localeCompare(b);
    });
    sel.innerHTML = '';
    const sys = document.createElement('option');
    sys.value = 'system';
    sys.textContent = 'Automática (voz do sistema na língua do texto)';
    sel.appendChild(sys);
    langs.forEach((lang) => {
        const g = document.createElement('optgroup');
        g.label = lang;
        byLang[lang].forEach((v) => {
            const o = document.createElement('option');
            o.value = v.name;
            o.textContent = v.name + (v.default ? ' (predefinida)' : '');
            g.appendChild(o);
        });
        sel.appendChild(g);
    });
    // keep the saved choice (also maps old values like "samantha" to the real voice name)
    const match =
        voices.find((v) => v.name === wanted) ||
        voices.find((v) => v.name.toLowerCase().startsWith(String(wanted).toLowerCase()));
    sel.value = wanted === 'system' || !match ? 'system' : match.name;
}

function setupVoiceList() {
    if (!window.speechSynthesis) return;
    populateVoices();
    speechSynthesis.addEventListener('voiceschanged', populateVoices);
}

function setupBehaviorAndVoiceInputs() {
    const ve = document.getElementById('voiceEngine');
    if (ve) ve.addEventListener('change', () => (ve.dataset.wanted = ve.value));
    ['posX', 'posY', 'voiceEngine', 'logLevel'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => updateAvatar());
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
    // Buttons use their onclick attributes (window.saveSettings, …); nothing else to bind
    // here — binding again made every action run twice.
}

function updateAvatar() {
    const config = collectConfiguration();

    // Update live 3D preview inside Settings window immediately
    if (window.__updatePreview) {
        window.__updatePreview(config.appearance);
    } else {
        window.__pendingPreview = config.appearance;
    }

    if (window.__previewBehavior) window.__previewBehavior(config.behavior);

    const ipc = getIPC();
    if (ipc && ipc.updateAvatarAppearance) {
        ipc.updateAvatarAppearance(config.appearance);
    }
    // behaviour and voice settings apply live too (debounced; Save persists them)
    clearTimeout(window.__liveTimer);
    window.__liveTimer = setTimeout(() => {
        if (ipc && ipc.updateAvatarBehavior) ipc.updateAvatarBehavior(config.behavior);
        if (ipc && ipc.applyConfig) ipc.applyConfig({ voice: config.voice });
    }, 250);
}

function collectConfiguration() {
    return {
        appearance: {
            // Colors
            hairColor: document.getElementById('hairColor')?.value || '#C9A15A',
            eyeColor: document.getElementById('eyeColor')?.value || '#7A4A1C',
            skinTone: document.getElementById('skinTone')?.value || '#F7DCC0',
            clothingColor: document.getElementById('clothingColor')?.value || '#0D0D12',
            shoeColor: document.getElementById('shoeColor')?.value || '#0D0D12',
            accessoryColor: document.getElementById('accessoryColor')?.value || '#D9B35E',
            
            // Body
            bodyType: document.querySelector('.body-type-card.selected')?.dataset.bodyType || 'average',
            bodyHeight: parseInt(document.getElementById('bodyHeight')?.value || '150'),
            bodyWidth: parseInt(document.getElementById('bodyWidth')?.value || '100'),
            shoulderWidth: parseInt(document.getElementById('shoulderWidth')?.value || '100'),
            waistSize: parseInt(document.getElementById('waistSize')?.value || '80'),
            
            // Face
            faceShape: document.querySelector('.face-shape-card.selected')?.dataset.faceShape || 'oval',
            eyeStyle: document.querySelector('.eye-style-card.selected')?.dataset.eyeStyle || 'normal',
            hairStyle: document.querySelector('.hair-style-card.selected')?.dataset.hairStyle || 'long',
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
            idleRotation: document.getElementById('idleRotation')?.checked || false,
            idleRoam: document.getElementById('idleRoam')?.checked || false,
            idleRoamDelay: parseInt(document.getElementById('idleRoamDelay')?.value || '60')
        },
        voice: {
            engine: document.getElementById('voiceEngine')?.value || 'system',
            rate: parseFloat(document.getElementById('speechRate')?.value || '1.0'),
            volume: parseInt(document.getElementById('volume')?.value || '100'),
            enabled: document.getElementById('voiceEnabled')?.checked !== false,
            inputEnabled: document.getElementById('voiceInput')?.checked || false
        },
        connection: {
            wsUrl: document.getElementById('hermesUrl')?.value.trim() || '',
            startLocalServer: document.getElementById('startLocalServer')?.checked || false
        },
        advanced: {
            port: parseInt(document.getElementById('serverPort')?.value || '8080'),
            logLevel: document.getElementById('logLevel')?.value || 'info',
            debugMode: document.getElementById('enableDebug')?.checked || false
        }
    };
}

async function saveSettings() {
    const config = collectConfiguration();
    localStorage.setItem('avatarConfig', JSON.stringify(config));

    if (window.__updatePreview) {
        window.__updatePreview(config.appearance);
    }

    const ipc = getIPC();
    if (ipc && ipc.saveConfig) {
        await ipc.saveConfig(config);
    }

    showNotification('Settings saved and applied!', 'success');
}

async function applySettings() {
    const config = collectConfiguration();

    if (window.__updatePreview) {
        window.__updatePreview(config.appearance);
    }

    const ipc = getIPC();
    if (ipc && ipc.applyConfig) {
        await ipc.applyConfig(config);
    } else if (ipc && ipc.updateAvatarAppearance) {
        await ipc.updateAvatarAppearance(config.appearance);
    }

    showNotification('Changes applied immediately!', 'success');
}

function testVoice() {
    const text = document.getElementById('testText')?.value || 'Hello! I\'m your avatar assistant.';
    const voiceConfig = collectConfiguration().voice;
    const ipc = getIPC();

    if (ipc && ipc.testVoice) {
        ipc.testVoice(text, voiceConfig);
        showNotification('A testar a voz…', 'info');
    } else if (window.speechSynthesis) {
        // outside the desktop app: speak right here
        const u = new SpeechSynthesisUtterance(text);
        u.rate = voiceConfig.rate;
        u.volume = voiceConfig.volume / 100;
        const v = speechSynthesis.getVoices().find((x) => voiceConfig.engine !== 'system' && x.name === voiceConfig.engine);
        if (v) u.voice = v;
        speechSynthesis.speak(u);
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
    focusPreviewFor(tabName);
};

// Close-up of the head in the 3D preview while editing the face
function focusPreviewFor(tabName) {
    if (window.__previewFocus) window.__previewFocus(tabName === 'face' ? 'head' : 'body');
}

window.saveSettings = saveSettings;
window.applySettings = applySettings;
window.testVoice = testVoice;
window.resetSettings = async function() {
    if (!confirm('Repor todas as definições de origem?')) return;
    localStorage.removeItem('avatarConfig');
    const ipc = getIPC();
    if (ipc && ipc.resetConfig) await ipc.resetConfig();
    location.reload();
};

window.clearCache = async function() {
    localStorage.clear();
    const ipc = getIPC();
    if (ipc && ipc.clearCache) await ipc.clearCache();
    showNotification('Cache limpa!', 'info');
};

console.log('Working config script loaded');


async function testHermesConnection() {
    const ipc = getIPC();
    const out = document.getElementById('hermesTestResult');
    const url = document.getElementById('hermesUrl')?.value.trim() || '';
    if (!ipc || !ipc.testHermes) return;
    if (out) {
        out.style.color = '#555';
        out.textContent = 'A testar…';
    }
    try {
        const r = await ipc.testHermes(url);
        if (out) {
            out.style.color = r.ok ? '#155724' : '#721c24';
            out.textContent = `${r.ok ? '✅' : '❌'} ${r.url || ''} — ${r.message}${r.ok ? ' · carrega em Apply/Save para o avatar usar este endereço' : ''}`;
        }
    } catch (e) {
        if (out) out.textContent = '❌ ' + (e && e.message ? e.message : e);
    }
}
window.testHermesConnection = testHermesConnection;
