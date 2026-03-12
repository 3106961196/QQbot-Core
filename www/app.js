const API_BASE = '';

class QQBotManager {
    constructor() {
        this.bots = [];
        this.init();
    }

    init() {
        try {
            this.bindElements();
            this.bindEvents();
            this.loadSettings();
            this.loadBots();
        } catch (error) {
            console.error('初始化失败:', error);
            this.toast('页面初始化失败: ' + error.message, 'error');
        }
    }

    loadSettings() {
        const savedKey = localStorage.getItem('apiKey');
        if (savedKey && this.apiKeyInput) {
            this.apiKeyInput.value = savedKey;
        }
    }

    saveApiKey() {
        try {
            const apiKey = this.apiKeyInput ? this.apiKeyInput.value.trim() : '';
            if (apiKey) {
                localStorage.setItem('apiKey', apiKey);
                this.toast('API Key 已保存', 'success');
                this.loadBots();
            } else {
                localStorage.removeItem('apiKey');
                this.toast('API Key 已清除', 'warning');
            }
        } catch (error) {
            console.error('保存API Key失败:', error);
            this.toast('保存失败: ' + error.message, 'error');
        }
    }

    getApiKey() {
        return localStorage.getItem('apiKey') || '';
    }

    bindElements() {
        this.botList = document.getElementById('botList');
        this.emptyState = document.getElementById('emptyState');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.modalOverlay = document.getElementById('modalOverlay');
        this.fabAdd = document.getElementById('fabAdd');
        this.modalClose = document.getElementById('modalClose');
        this.btnCancel = document.getElementById('btnCancel');
        this.btnSubmit = document.getElementById('btnSubmit');
        this.appIdInput = document.getElementById('appId');
        this.appSecretInput = document.getElementById('appSecret');
        this.toastContainer = document.getElementById('toastContainer');
        this.saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
        this.apiKeyInput = document.getElementById('apiKey');
        
        this.botSettingsOverlay = document.getElementById('botSettingsOverlay');
        this.botSettingsClose = document.getElementById('botSettingsClose');
        this.botSettingsCancel = document.getElementById('botSettingsCancel');
        this.botSettingsSave = document.getElementById('botSettingsSave');
        this.addMasterBtn = document.getElementById('addMasterBtn');
        this.newMasterId = document.getElementById('newMasterId');
        
        this.currentBotId = null;
        this.currentAppId = null;
        
        if (!this.saveApiKeyBtn) console.warn('saveApiKeyBtn 元素未找到');
        if (!this.apiKeyInput) console.warn('apiKey 元素未找到');
        if (!this.toastContainer) console.warn('toastContainer 元素未找到');
    }

    bindEvents() {
        if (this.fabAdd) this.fabAdd.addEventListener('click', () => this.showModal());
        if (this.modalClose) this.modalClose.addEventListener('click', () => this.hideModal());
        if (this.btnCancel) this.btnCancel.addEventListener('click', () => this.hideModal());
        if (this.btnSubmit) this.btnSubmit.addEventListener('click', () => this.handleSubmit());
        if (this.saveApiKeyBtn) this.saveApiKeyBtn.addEventListener('click', () => this.saveApiKey());
        if (this.apiKeyInput) {
            this.apiKeyInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.saveApiKey();
                }
            });
        }
        if (this.modalOverlay) {
            this.modalOverlay.addEventListener('click', (e) => {
                if (e.target === this.modalOverlay) {
                    this.hideModal();
                }
            });
        }
        
        if (this.botSettingsClose) this.botSettingsClose.addEventListener('click', () => this.hideBotSettings());
        if (this.botSettingsCancel) this.botSettingsCancel.addEventListener('click', () => this.hideBotSettings());
        if (this.botSettingsSave) this.botSettingsSave.addEventListener('click', () => this.saveBotSettings());
        if (this.addMasterBtn) this.addMasterBtn.addEventListener('click', () => this.addMasterFromSettings());
        if (this.botSettingsOverlay) {
            this.botSettingsOverlay.addEventListener('click', (e) => {
                if (e.target === this.botSettingsOverlay) {
                    this.hideBotSettings();
                }
            });
        }
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.modalOverlay?.classList.contains('show')) {
                    this.hideModal();
                }
                if (this.settingsOverlay?.classList.contains('show')) {
                    this.hideSettings();
                }
                if (this.botSettingsOverlay?.classList.contains('show')) {
                    this.hideBotSettings();
                }
            }
        });
    }

    async loadBots() {
        try {
            const response = await this.fetch('/api/qqbot/status');
            if (response && response.success) {
                this.bots = response.bots || [];
                this.renderBots();
                this.updateConnectionStatus();
            } else {
                this.renderEmptyState();
                if (response && response.message) {
                    this.toast(response.message, 'error');
                }
            }
        } catch (error) {
            console.error('加载机器人列表失败:', error);
            this.renderEmptyState();
        }
    }

    renderBots() {
        if (this.bots.length === 0) {
            this.renderEmptyState();
            return;
        }

        this.emptyState.style.display = 'none';
        this.botList.innerHTML = this.bots.map(bot => this.createBotCard(bot)).join('');
        
        this.botList.querySelectorAll('.btn-disconnect').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const botId = e.currentTarget.dataset.id;
                this.disconnectBot(botId);
            });
        });

        this.botList.querySelectorAll('.btn-reconnect').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const appId = e.currentTarget.dataset.appId;
                this.reconnectBot(appId);
            });
        });

        this.botList.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const appId = e.currentTarget.dataset.appId;
                this.deleteBot(appId);
            });
        });

        this.botList.querySelectorAll('.btn-bot-settings').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const botId = e.currentTarget.dataset.id;
                const appId = e.currentTarget.dataset.appId;
                this.showBotSettings(botId, appId);
            });
        });
    }

    createBotCard(bot) {
        const initial = bot.nickname ? bot.nickname.charAt(0).toUpperCase() : bot.id.charAt(0);
        const isOnline = bot.status === 'online';
        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? '在线' : '离线';
        
        const actionButton = isOnline 
            ? `<button class="btn btn-secondary btn-sm btn-disconnect" data-id="${bot.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
                    <line x1="12" y1="2" x2="12" y2="12"/>
                </svg>
                断开
               </button>`
            : `<button class="btn btn-success btn-sm btn-reconnect" data-app-id="${bot.appId}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M23 4v6h-6"/>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
                重连
               </button>`;
        
        return `
            <div class="bot-card ${isOnline ? '' : 'offline'}" data-id="${bot.id}" data-app-id="${bot.appId}">
                <div class="bot-card-header">
                    <div class="bot-info">
                        <div class="bot-avatar">${initial}</div>
                        <div>
                            <div class="bot-name">${bot.nickname || bot.id}</div>
                            <div class="bot-id">ID: ${bot.id}</div>
                        </div>
                    </div>
                    <div class="bot-status ${statusClass}">
                        <span class="bot-status-dot"></span>
                        <span>${statusText}</span>
                    </div>
                </div>
                <div class="bot-card-body">
                    <div class="bot-detail">
                        <span class="bot-detail-label">启动时间</span>
                        <span class="bot-detail-value">${isOnline ? this.formatTime(bot.startTime) : '-'}</span>
                    </div>
                    <div class="bot-detail">
                        <span class="bot-detail-label">AppID</span>
                        <span class="bot-detail-value">${bot.appId || '-'}</span>
                    </div>
                </div>
                <div class="bot-card-actions">
                    ${actionButton}
                    <button class="btn btn-danger btn-sm btn-delete" data-app-id="${bot.appId}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3,6 5,6 21,6"/>
                            <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/>
                        </svg>
                        删除
                    </button>
                    <button class="btn-icon btn-bot-settings" data-id="${bot.id}" data-app-id="${bot.appId}" title="设置">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    renderEmptyState() {
        this.emptyState.style.display = 'flex';
        this.botList.innerHTML = '';
        this.botList.appendChild(this.emptyState);
    }

    updateConnectionStatus() {
        const hasOnline = this.bots.some(bot => bot.status === 'online');
        if (hasOnline) {
            this.connectionStatus.classList.add('online');
            this.connectionStatus.querySelector('.status-text').textContent = '已连接';
        } else {
            this.connectionStatus.classList.remove('online');
            this.connectionStatus.querySelector('.status-text').textContent = '未连接';
        }
    }

    showModal() {
        this.modalOverlay.classList.add('show');
        this.appIdInput.value = '';
        if (this.appSecretInput) this.appSecretInput.value = '';
        this.appIdInput.focus();
    }

    hideModal() {
        this.modalOverlay.classList.remove('show');
        this.resetSubmitButton();
    }

    resetSubmitButton() {
        const btnText = this.btnSubmit.querySelector('.btn-text');
        const btnLoading = this.btnSubmit.querySelector('.btn-loading');
        btnText.style.display = '';
        btnLoading.style.display = 'none';
        this.btnSubmit.disabled = false;
    }

    setLoadingState() {
        const btnText = this.btnSubmit.querySelector('.btn-text');
        const btnLoading = this.btnSubmit.querySelector('.btn-loading');
        btnText.style.display = 'none';
        btnLoading.style.display = '';
        this.btnSubmit.disabled = true;
    }

    async handleSubmit() {
        const appId = this.appIdInput.value.trim();
        const appSecret = this.appSecretInput ? this.appSecretInput.value.trim() : '';

        if (!appId || !appSecret) {
            this.toast('请填写 AppID 和 AppSecret', 'warning');
            return;
        }

        this.setLoadingState();

        try {
            const testResponse = await this.fetch('/api/qqbot/test-connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appId, clientSecret: appSecret })
            });

            if (!testResponse.success) {
                this.toast('连接测试失败: ' + (testResponse.message || '未知错误'), 'error');
                this.resetSubmitButton();
                return;
            }

            const addResponse = await this.fetch('/api/qqbot/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appId, clientSecret: appSecret, name: appId })
            });

            if (addResponse.success) {
                this.toast('机器人添加成功', 'success');
                this.hideModal();
                await this.loadBots();
            } else {
                this.toast('添加失败: ' + (addResponse.message || '未知错误'), 'error');
                this.resetSubmitButton();
            }
        } catch (error) {
            console.error('添加机器人失败:', error);
            this.toast('添加失败: ' + error.message, 'error');
            this.resetSubmitButton();
        }
    }

    async disconnectBot(botId) {
        try {
            const response = await this.fetch(`/api/qqbot/disconnect/${botId}`, {
                method: 'POST'
            });
            if (response.success) {
                this.toast('已断开连接', 'success');
                await this.loadBots();
            } else {
                this.toast('断开失败: ' + (response.message || '未知错误'), 'error');
            }
        } catch (error) {
            this.toast('断开失败: ' + error.message, 'error');
        }
    }

    async reconnectBot(appId) {
        try {
            this.toast('正在重连...', 'info');
            const response = await this.fetch(`/api/qqbot/reconnect/${appId}`, {
                method: 'POST'
            });
            if (response.success) {
                this.toast('重连成功', 'success');
                await this.loadBots();
            } else {
                this.toast('重连失败: ' + (response.message || '未知错误'), 'error');
            }
        } catch (error) {
            this.toast('重连失败: ' + error.message, 'error');
        }
    }

    async deleteBot(appId) {
        if (!confirm('确定要删除这个机器人吗？')) {
            return;
        }

        try {
            const response = await this.fetch(`/api/qqbot/accounts/${appId}`, {
                method: 'DELETE'
            });
            if (response.success) {
                this.toast('已删除', 'success');
                await this.loadBots();
            } else {
                this.toast('删除失败: ' + (response.message || '未知错误'), 'error');
            }
        } catch (error) {
            this.toast('删除失败: ' + error.message, 'error');
        }
    }

    async addMaster(botId) {
        const userId = prompt('请输入要添加的QQ管理员 user_id:');
        if (!userId || !userId.trim()) {
            return;
        }

        try {
            const response = await this.fetch(`/api/qqbot/master/${encodeURIComponent(botId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId.trim() })
            });
            if (response.success) {
                this.toast('添加主人成功', 'success');
            } else {
                this.toast('添加失败: ' + (response.message || '未知错误'), 'error');
            }
        } catch (error) {
            this.toast('添加失败: ' + error.message, 'error');
        }
    }

    async showBotSettings(botId, appId) {
        this.currentBotId = botId;
        this.currentAppId = appId;
        
        const bot = this.bots.find(b => b.id === botId);
        if (!bot) {
            this.toast('机器人不存在', 'error');
            return;
        }
        
        document.getElementById('botSettingName').textContent = bot.nickname || bot.id;
        document.getElementById('botSettingAppId').textContent = appId;
        document.getElementById('botSettingStatus').textContent = bot.status === 'online' ? '在线' : '离线';
        
        await this.loadBotMasters(botId);
        await this.loadBotConfig(botId, appId);
        
        this.botSettingsOverlay.classList.add('show');
    }

    hideBotSettings() {
        this.botSettingsOverlay.classList.remove('show');
        this.currentBotId = null;
        this.currentAppId = null;
    }

    async loadBotMasters(botId) {
        try {
            const response = await this.fetch(`/api/qqbot/master/${encodeURIComponent(botId)}`);
            const masterList = document.getElementById('masterList');
            
            if (response.success && response.masters && response.masters.length > 0) {
                masterList.innerHTML = response.masters.map(master => `
                    <div class="master-item">
                        <span class="master-id">${master}</span>
                        <button class="btn-icon btn-sm btn-remove-master" data-master="${master}" title="移除">
                            ✕
                        </button>
                    </div>
                `).join('');
                
                masterList.querySelectorAll('.btn-remove-master').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const master = e.currentTarget.dataset.master;
                        this.removeMaster(botId, master);
                    });
                });
            } else {
                masterList.innerHTML = '<p class="empty-hint">暂无主人</p>';
            }
        } catch (error) {
            console.error('加载主人列表失败:', error);
        }
    }

    async loadBotConfig(botId, appId) {
        try {
            const response = await this.fetch(`/api/qqbot/accounts/${appId}/config`);
            if (response.success && response.config) {
                const config = response.config;
                document.getElementById('botSettingSandbox').checked = config.sandbox === true;
                document.getElementById('botSettingMaxRetry').value = config.maxRetry || 10;
                document.getElementById('botSettingTimeout').value = Math.round((config.timeout || 30000) / 1000);
                document.getElementById('botSettingMarkdown').checked = config.markdownSupport === true;
                document.getElementById('botSettingToQRCode').checked = config.toQRCode !== false;
                document.getElementById('botSettingToCallback').checked = config.toCallback !== false;
                document.getElementById('botSettingToBotUpload').checked = config.toBotUpload !== false;
                document.getElementById('botSettingHideGuildRecall').checked = config.hideGuildRecall === true;
                document.getElementById('botSettingImageLength').value = config.imageLength || 3;
            }
        } catch (error) {
            console.error('加载机器人配置失败:', error);
        }
    }

    async addMasterFromSettings() {
        const userId = this.newMasterId.value.trim();
        if (!userId) {
            this.toast('请输入用户ID', 'error');
            return;
        }

        try {
            const response = await this.fetch(`/api/qqbot/master/${encodeURIComponent(this.currentBotId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId })
            });
            if (response.success) {
                this.toast('添加成功', 'success');
                this.newMasterId.value = '';
                await this.loadBotMasters(this.currentBotId);
            } else {
                this.toast('添加失败: ' + (response.message || '未知错误'), 'error');
            }
        } catch (error) {
            this.toast('添加失败: ' + error.message, 'error');
        }
    }

    async removeMaster(botId, master) {
        try {
            const response = await this.fetch(`/api/qqbot/master/${encodeURIComponent(botId)}/${encodeURIComponent(master)}`, {
                method: 'DELETE'
            });
            if (response.success) {
                this.toast('移除成功', 'success');
                await this.loadBotMasters(botId);
            } else {
                this.toast('移除失败: ' + (response.message || '未知错误'), 'error');
            }
        } catch (error) {
            this.toast('移除失败: ' + error.message, 'error');
        }
    }

    async saveBotSettings() {
        const config = {
            sandbox: document.getElementById('botSettingSandbox').checked,
            maxRetry: parseInt(document.getElementById('botSettingMaxRetry').value) || 10,
            timeout: Math.max(1000, (parseInt(document.getElementById('botSettingTimeout').value) || 30) * 1000),
            markdownSupport: document.getElementById('botSettingMarkdown').checked,
            toQRCode: document.getElementById('botSettingToQRCode').checked,
            toCallback: document.getElementById('botSettingToCallback').checked,
            toBotUpload: document.getElementById('botSettingToBotUpload').checked,
            hideGuildRecall: document.getElementById('botSettingHideGuildRecall').checked,
            imageLength: parseFloat(document.getElementById('botSettingImageLength').value) || 3
        };

        try {
            const response = await this.fetch(`/api/qqbot/accounts/${this.currentAppId}/config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            if (response.success) {
                this.toast('保存成功', 'success');
                this.hideBotSettings();
            } else {
                this.toast('保存失败: ' + (response.message || '未知错误'), 'error');
            }
        } catch (error) {
            this.toast('保存失败: ' + error.message, 'error');
        }
    }

    async fetch(url, options = {}) {
        const apiKey = this.getApiKey();
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        
        const response = await fetch(API_BASE + url, {
            ...options,
            headers
        });
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            let errorMessage = `HTTP ${response.status}`;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.message || errorJson.error || errorMessage;
            } catch {
                if (errorText) errorMessage = errorText;
            }
            throw new Error(errorMessage);
        }
        
        return response.json();
    }

    toast(message, type = 'info') {
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${icons[type]}</span>
            <span>${message}</span>
        `;

        this.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    formatTime(timestamp) {
        if (!timestamp) return '-';
        const date = new Date(timestamp * 1000);
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    showSettings() {
        this.settingsOverlay.classList.add('show');
        this.loadSettingsData();
    }

    hideSettings() {
        this.settingsOverlay.classList.remove('show');
    }

    async loadSettingsData() {
        try {
            const response = await this.fetch('/api/qqbot/config');
            if (response && response.success) {
                const toQRCode = document.getElementById('settingToQRCode');
                const toCallback = document.getElementById('settingToCallback');
                const toBotUpload = document.getElementById('settingToBotUpload');
                const hideGuildRecall = document.getElementById('settingHideGuildRecall');
                const imageLength = document.getElementById('settingImageLength');
                const sandbox = document.getElementById('settingSandbox');
                const maxRetry = document.getElementById('settingMaxRetry');
                const timeout = document.getElementById('settingTimeout');
                const markdownSupport = document.getElementById('settingMarkdownSupport');
                
                if (toQRCode) toQRCode.checked = response.toQRCode !== false;
                if (toCallback) toCallback.checked = response.toCallback !== false;
                if (toBotUpload) toBotUpload.checked = response.toBotUpload !== false;
                if (hideGuildRecall) hideGuildRecall.checked = response.hideGuildRecall === true;
                if (imageLength) imageLength.value = response.imageLength || 3;
                
                if (response.bot) {
                    if (sandbox) sandbox.checked = response.bot.sandbox === true;
                    if (maxRetry) maxRetry.value = response.bot.maxRetry || 10;
                    if (timeout) timeout.value = Math.round((response.bot.timeout || 30000) / 1000);
                }
                
                if (markdownSupport) markdownSupport.checked = response.defaultMarkdownSupport === true;
            }
        } catch (error) {
            console.error('加载设置失败:', error);
        }
    }

    async saveSettings() {
        try {
            const timeoutValue = parseInt(document.getElementById('settingTimeout')?.value) || 30;

            const config = {
                toQRCode: document.getElementById('settingToQRCode')?.checked ?? true,
                toCallback: document.getElementById('settingToCallback')?.checked ?? true,
                toBotUpload: document.getElementById('settingToBotUpload')?.checked ?? true,
                hideGuildRecall: document.getElementById('settingHideGuildRecall')?.checked ?? false,
                imageLength: parseFloat(document.getElementById('settingImageLength')?.value) || 3,
                bot: {
                    sandbox: document.getElementById('settingSandbox')?.checked ?? false,
                    maxRetry: parseInt(document.getElementById('settingMaxRetry')?.value) || 10,
                    timeout: Math.max(1000, timeoutValue * 1000)
                },
                defaultMarkdownSupport: document.getElementById('settingMarkdownSupport')?.checked ?? false
            };

            const response = await this.fetch('/api/qqbot/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            if (response && response.success) {
                this.toast('设置已保存', 'success');
                this.hideSettings();
            } else {
                this.toast('保存失败: ' + (response?.message || '未知错误'), 'error');
            }
        } catch (error) {
            console.error('保存设置失败:', error);
            this.toast('保存失败: ' + error.message, 'error');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new QQBotManager();
});
