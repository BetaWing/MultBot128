// ══════════════════════════════════════════════════════
//  MODULE: StatusPanel
//  Painel de status em tempo real de todos os módulos
//
//  PDCA - correcao desta rodada: _getTownName local removido,
//  usa this.getTownName (herdado de MultUtil).
//
//  PDCA - nesta rodada: adicionadas linhas de Auto Ataque,
//  Auto Fuga (Dodge), Sacrificio de Ares e Auto Pesquisa,
//  que ja existiam no bot mas nao apareciam no painel.
// ══════════════════════════════════════════════════════
var StatusPanel = class extends MultUtil {
    constructor(c, s) {
        super(c, s);
        this._interval = null;
        this._refreshTimeoutId = null;
        this._countdownInterval = null;
        this._nextRefreshAt = null;
        this._refreshMinutes = this.storage.load('refresh_minutes', 0);

        if (this._refreshMinutes > 0) {
            this._scheduleRefresh();
        }
    }

    settings = () => {
        requestAnimationFrame(() => this._startVisuals());
        requestAnimationFrame(() => this._wireQuickSettings());
        const sleeperEnabled = this.storage.load('sleeper_enabled', false);
        const sleeperStart = this.storage.load('sleeper_start', '23:00');
        const sleeperEnd = this.storage.load('sleeper_end', '07:00');
        const toastsEnabled = this.storage.load('toasts_enabled', true) !== false;
        return `
        <div style="padding:5px 8px;border-bottom:1px solid rgba(0,0,0,0.1);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:bold;font-size:12px;">${this.t('sleeper_label')}</span>
            <input id="sleeper_start_input" type="time" value="${sleeperStart}" style="padding:2px 5px;" />
            <span style="font-size:11px;">${this.t('sleeper_to')}</span>
            <input id="sleeper_end_input" type="time" value="${sleeperEnd}" style="padding:2px 5px;" />
            ${this.getButtonHtml('btn_set_sleeper', this.t('apply'), this._applySleeper)}
            ${sleeperEnabled ? this.getButtonHtml('btn_disable_sleeper', this.t('sleeper_disable'), this._disableSleeper) : ''}
            <span id="sleeper_status" style="font-size:11px;font-weight:bold;"></span>
        </div>
        <div style="padding:1px 8px 6px;font-size:10px;color:#8a7a5a;">
            ${this.t('sleeper_desc')}
        </div>
        <div style="padding:5px 8px;border-bottom:1px solid rgba(0,0,0,0.1);display:flex;align-items:center;gap:8px;">
            <span style="font-weight:bold;font-size:12px;">${this.t('auto_refresh_label')}</span>
            <input id="refresh_minutes_input" type="number" min="0" max="999" value="${this._refreshMinutes}"
                style="width:55px;padding:2px 5px;" placeholder="min" />
            ${this.getButtonHtml('btn_set_refresh', this.t('apply'), this._applyRefresh)}
            <span id="refresh_status" style="font-size:11px;color:#5a3a0a;"></span>
            <span id="refresh_countdown" style="font-size:11px;color:#3a2a0a;font-weight:bold;margin-left:auto;"></span>
        </div>
        <div style="padding:5px 8px;border-bottom:1px solid rgba(0,0,0,0.1);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:bold;font-size:12px;">${this.t('qol_toasts_label')}</span>
            <input id="toasts_enabled_input" type="checkbox" ${toastsEnabled ? 'checked' : ''} style="cursor:pointer;" />
            <span style="font-size:10px;color:#8a7a5a;">${this.t('qol_toasts_desc')}</span>
        </div>
        <div style="padding:5px 8px;border-bottom:1px solid rgba(0,0,0,0.1);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:bold;font-size:12px;">${this.t('backup_label')}</span>
            ${this.getButtonHtml('btn_export_settings', '💾 ' + this.t('backup_export'), this._exportSettings, '')}
            ${this.getButtonHtml('btn_import_settings', '📂 ' + this.t('backup_import'), this._importSettings, '')}
            <input id="multbot_import_file" type="file" accept=".json,application/json" style="display:none;" />
            <span id="backup_status" style="font-size:11px;color:#5a3a0a;"></span>
        </div>
        <div style="padding:3px 8px;border-bottom:1px solid rgba(0,0,0,0.1);display:flex;align-items:center;gap:8px;">
            <span id="status_summary" style="font-size:11px;font-weight:bold;color:#5a3a0a;"></span>
        </div>
        <div id="status_rows" style="padding:4px;"></div>`;
    };

    /* Liga o checkbox de notificações e o fluxo de importação por arquivo.
       Roda uma vez por render da aba (rAF); os elementos são recriados a
       cada troca de aba, então o bind direto não acumula handlers. */
    _wireQuickSettings = () => {
        const $check = uw.$('#toasts_enabled_input');
        if ($check.length) {
            uw.$(document)
                .off('change.multbot_toasts')
                .on('change.multbot_toasts', '#toasts_enabled_input', (event) => {
                    const enabled = uw.$(event.currentTarget).is(':checked');
                    this.storage.save('toasts_enabled', enabled);
                    this.console.log('[StatusPanel] ' + this.t('qol_toasts_label') + ': ' + (enabled ? this.t('active') : this.t('status_disabled')));
                });
        }

        const $file = uw.$('#multbot_import_file');
        if ($file.length) {
            $file.off('change.multbot_import').on('change.multbot_import', (event) => {
                const file = event.target?.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => this._applyImportedSettings(String(reader.result ?? ''));
                reader.onerror = () => this._backupStatus(this.t('backup_import_error', { msg: 'read error' }), '#f87171');
                reader.readAsText(file);
                event.target.value = '';
            });
        }
    };

    _backupStatus = (message, color) => {
        uw.$('#backup_status').text(message).css('color', color);
    };

    _exportSettings = () => {
        try {
            uw.multBot.storage.exportSettings();
            const msg = this.t('backup_exported');
            this._backupStatus(msg, '#1a6b2a');
            this.console.log('[StatusPanel] ' + msg);
            this.notify(msg, 'success');
        } catch (e) {
            const msg = this.t('backup_import_error', { msg: e?.message ?? e });
            this._backupStatus(msg, '#f87171');
            this.notify(msg, 'error');
        }
    };

    _importSettings = () => {
        uw.$('#multbot_import_file').trigger('click');
    };

    _applyImportedSettings = (text) => {
        if (!confirm(this.t('backup_import_confirm'))) {
            this._backupStatus(this.t('backup_import_cancelled'), '#8a2a2a');
            return;
        }
        const result = uw.multBot.storage.importSettings(text);
        if (!result.ok) {
            const msg = this.t('backup_import_error', { msg: result.error });
            this._backupStatus(msg, '#f87171');
            this.notify(msg, 'error');
            return;
        }
        const msg = this.t('backup_imported', { n: result.count });
        this._backupStatus(msg, '#1a6b2a');
        this.console.log('[StatusPanel] ' + msg);
        this.notify(msg, 'success');
        setTimeout(() => location.reload(), 1200);
    };

    _applySleeper = () => {
        const start = uw.$('#sleeper_start_input').val();
        const end = uw.$('#sleeper_end_input').val();

        if (!start || !end) {
            uw.$('#sleeper_status').text(this.t('sleeper_invalid')).css('color', '#8a2a2a');
            return;
        }

        this.storage.save('sleeper_enabled', true);
        this.storage.save('sleeper_start', start);
        this.storage.save('sleeper_end', end);
        this.console.log(`[Sleeper] ${this.t('sleeper_enabled_log', { start, end })}`);
        this._renderSleeperStatus();
        this._refreshSleeperButtons();
    };

    _disableSleeper = () => {
        this.storage.save('sleeper_enabled', false);
        this.console.log('[Sleeper] ' + this.t('sleeper_disabled_log'));
        this._renderSleeperStatus();
        this._refreshSleeperButtons();
    };

    _refreshSleeperButtons() {
        const enabled = this.storage.load('sleeper_enabled', false);
        const $btn = uw.$('#btn_disable_sleeper');
        if (enabled && $btn.length === 0) {
            uw.$('#btn_set_sleeper').after(this.getButtonHtml('btn_disable_sleeper', this.t('sleeper_disable'), this._disableSleeper));
        } else if (!enabled && $btn.length > 0) {
            $btn.remove();
        }
    }

    _renderSleeperStatus() {
        try {
            const enabled = this.storage.load('sleeper_enabled', false);
            if (!enabled) {
                uw.$('#sleeper_status').text(this.t('status_disabled')).css('color', '#8a2a2a');
                return;
            }
            const sleeping = this.isSleeping();
            const msg = sleeping ? this.t('sleeper_active_now') : this.t('sleeper_scheduled');
            uw.$('#sleeper_status').text(msg).css('color', sleeping ? '#c9a227' : '#1a6b2a');
        } catch (e) {}
    }

    _applyRefresh = () => {
        const val = parseInt(uw.$('#refresh_minutes_input').val(), 10);

        this._clearRefresh();

        if (!val || val <= 0) {
            this._refreshMinutes = 0;
            this.storage.save('refresh_minutes', 0);
            uw.$('#refresh_status').text(this.t('status_disabled')).css('color', '#8a2a2a');
            uw.$('#refresh_countdown').text('');
            return;
        }

        this._refreshMinutes = val;
        this.storage.save('refresh_minutes', val);
        this._scheduleRefresh();
        uw.$('#refresh_status').text(this.t('status_reloads_every', { min: val })).css('color', '#1a6b2a');

        this.console.log(`[StatusPanel] Auto Refresh: ${val} minuto(s) (± jitter).`);
    };

    _clearRefresh() {
        if (this._refreshTimeoutId) {
            clearTimeout(this._refreshTimeoutId);
            this._refreshTimeoutId = null;
        }
        this._nextRefreshAt = null;
    }

    _scheduleRefresh() {
        this._clearRefresh();
        if (this._refreshMinutes <= 0) return;

        const base = this._refreshMinutes * 60 * 1000;
        const jitter = (Math.random() * 60000) - 30000;
        const ms = Math.max(base + jitter, 10000);

        this._nextRefreshAt = Date.now() + ms;
        this._refreshTimeoutId = setTimeout(() => location.reload(), ms);
    }

    _startVisuals() {
        if (this._interval) clearInterval(this._interval);
        this._render();
        // FIX: usa createGuardedInterval (respectSleep=false) em vez de
        // setInterval cru - alem de seguir o padrao do resto do projeto,
        // isso evita que o proprio painel de status (que mostra o estado
        // do Sleeper) fique CONGELADO durante a janela de sono, o que
        // pareceria um bot travado/crashado em vez de so pausado.
        this._interval = this.createGuardedInterval(() => this._render(), 3000, false);

        if (this._countdownInterval) clearInterval(this._countdownInterval);
        this._countdownInterval = this.createGuardedInterval(() => this._updateCountdown(), 1000, false);

        if (this._refreshMinutes > 0 && this._nextRefreshAt) {
            uw.$('#refresh_status').text(this.t('status_reloads_every', { min: this._refreshMinutes })).css('color', '#1a6b2a');
        } else if (this._refreshMinutes > 0) {
            this._scheduleRefresh();
            uw.$('#refresh_status').text(this.t('status_reloads_every', { min: this._refreshMinutes })).css('color', '#1a6b2a');
        }
        this._updateCountdown();
        this._renderSleeperStatus();
    }

    _updateCountdown() {
        if (!this._nextRefreshAt) {
            uw.$('#refresh_countdown').text('');
            return;
        }
        const remaining = Math.max(0, this._nextRefreshAt - Date.now());
        const totalSec = Math.floor(remaining / 1000);
        const mm = Math.floor(totalSec / 60).toString().padStart(2, '0');
        const ss = (totalSec % 60).toString().padStart(2, '0');
        uw.$('#refresh_countdown').text(`⏱ ${mm}:${ss}`);
    }

    /* Painel categorizado: uma linha por módulo do bot, agrupada por
       área (mesma ordem das abas da janela). A contagem do cabeçalho e o
       resumo no topo saem do próprio array de linhas, então um módulo
       novo adicionado aqui aparece no painel e nas contagens sem
       precisar de mais nenhuma mudança. */
    _render() {
        try {
            const bot  = uw.multBot;
            const rows = [];

            const farmActive  = !!bot.autoFarm?.active;
            const ruralActive = !!bot.autoRuralLevel?.enable;
            const buildCount  = Object.keys(bot.autoBuild?.towns_buildings ?? {}).length;
            const trainCount  = Object.keys(bot.autoTrain?.city_troops ?? {}).length;
            const partyActive = !!bot.autoParty?.enable;
            const cel         = this._countCelebrations();
            const celStr      = [cel.party && `${cel.party} ${this.t('label_party')}`, cel.theater && `${cel.theater} ${this.t('label_theater')}`, cel.triumph && `${cel.triumph} ${this.t('label_triumph')}`].filter(Boolean).join(' · ') || '—';
            const gratisActive = !!bot.autoGratis?.autogratis;
            const cssActive   = !!bot.colonizeShipSender?._running;
            const asrActive   = !!bot.autoSendResources?._active;
            const militiaActive    = !!bot.autoMilitia?._active;
            const hideActive       = !!bot.autoHide?._active;
            const questActive      = !!bot.autoQuest?._active;
            const discordActive    = !!bot.discordAlert?._active;
            const sniperPending    = (bot.sniper?._scheduled ?? []).filter(s => s.status === 'pending').length;

            // These modules already existed and already expose
            // _active + toggle(), they just weren't being read here
            // on the panel yet.
            const attackActive   = !!bot.autoAttack?._active;
            const dodgeActive    = !!bot.autoDodge?._active;
            const aresActive     = !!bot.autoSpells?._aresActive;
            const researchActive = !!bot.autoResearch?._active;

            // Módulos que faltavam no painel (rodada de completude):
            // Troca com Rurais (loop por recurso), Bootcamp, Anti Rage
            // (reativo, sem toggle), Auto Trade (manual) e Mult Tools
            // (ações avulsas - mostramos o prefixo de renomeação).
            const rtActive   = !!bot.autoRuralTrade?.auto_trade_resouces_loop;
            const rtResource = bot.autoRuralTrade?.trade_resouce;
            const bootcampActive = !!bot.autoBootcamp?.enable_auto_bootcamp;
            const bootcampMode   = bot.autoBootcamp?.use_def ? this.t('abc_off_def') : this.t('abc_only_off');
            const rageArmed      = !!bot.antiRage?.loop_funct;

            const group = (label, entries) => rows.push({ label, entries });

            group(this.t('cat_farm'), [
                { label: this.t('row_farm'),           active: farmActive,  value: farmActive  ? this.t('active')               : this.t('stopped'), module: 'autoFarm',           method: 'toggle' },
                { label: this.t('row_rural'),    active: ruralActive, value: ruralActive ? this.t('level_label', { n: bot.autoRuralLevel?.rural_level ?? '?' }) : this.t('stopped'), module: 'autoRuralLevel', method: 'toggle' },
                { label: this.t('row_rural_trade'), active: rtActive,   value: rtActive ? this.t('rt_trading', { res: rtResource ?? '?' }) : this.t('stopped'), module: rtActive ? 'autoRuralTrade' : null, method: rtActive ? 'main' : null },
                { label: this.t('row_send_resources'), active: asrActive,   value: asrActive   ? this.t('active') : this.t('stopped'),   module: 'autoSendResources',  method: 'toggle' },
            ]);

            group(this.t('cat_build'), [
                { label: this.t('row_build'),        active: buildCount > 0, value: buildCount > 0 ? this.t('cities_count', { n: buildCount }) : this.t('no_city'), module: null, method: null },
                { label: this.t('row_free_build'), active: gratisActive, value: gratisActive ? this.t('active') : this.t('stopped'), module: 'autoGratis',          method: 'toggle' },
            ]);

            group(this.t('cat_train'), [
                { label: this.t('row_train'),      active: trainCount > 0, value: trainCount > 0 ? this.t('cities_count', { n: trainCount }) : this.t('no_city'), module: null, method: null },
                { label: this.t('row_research'),       active: researchActive, value: researchActive ? this.t('active') : this.t('stopped'), module: 'autoResearch',      method: 'toggle' },
            ]);

            group(this.t('cat_attack'), [
                { label: this.t('row_attack'),        active: attackActive,   value: attackActive   ? this.t('active') : this.t('stopped'),   module: 'autoAttack',        method: 'toggle' },
                { label: this.t('row_bootcamp'), active: bootcampActive, value: bootcampActive ? `${this.t('active')} · ${bootcampMode}` : this.t('stopped'), module: 'autoBootcamp', method: 'toggle' },
                { label: this.t('row_anti_rage'), active: rageArmed, value: rageArmed ? this.t('active') : this.t('ar_armed'), module: null, method: null },
                { label: this.t('row_sniper'),        active: sniperPending > 0, value: sniperPending > 0 ? this.t('row_sniper_pending', { n: sniperPending }) : this.t('stopped'), module: null, method: null },
            ]);

            group(this.t('cat_defense'), [
                { label: this.t('row_militia'),      active: militiaActive, value: militiaActive ? this.t('active') : this.t('stopped'), module: 'autoMilitia', method: militiaActive ? 'stop' : 'start' },
                { label: this.t('row_dodge'),  active: dodgeActive,    value: dodgeActive    ? this.t('active') : this.t('stopped'), module: 'autoDodge',         method: 'toggle' },
            ]);

            group(this.t('cat_spells'), [
                { label: this.t('row_ares'),  active: aresActive,     value: aresActive     ? this.t('active') : this.t('stopped'), module: 'autoSpells', method: '_toggleAres' },
            ]);

            group(this.t('cat_mix'), [
                { label: this.t('row_party'),      active: partyActive, value: partyActive ? celStr : this.t('stopped'),     module: 'autoParty',          method: 'toggle' },
                { label: this.t('row_hide'),          active: hideActive,    value: hideActive    ? this.t('active') : this.t('stopped'),                module: 'autoHide',          method: 'toggle' },
                { label: this.t('row_quest'),         active: questActive,   value: questActive   ? this.t('active') : this.t('stopped'),                module: 'autoQuest',         method: 'toggle' },
            ]);

            group(this.t('cat_mult'), [
                { label: this.t('row_colonize_ship'), active: cssActive,   value: cssActive   ? `→ ${this.getTownName(bot.colonizeShipSender.config.targetTownId)}` : this.t('stopped'), module: 'colonizeShipSender', method: cssActive ? 'stop' : 'start' },
                { label: this.t('row_discord'),       active: discordActive, value: discordActive ? this.t('active') : this.t('stopped'),                module: 'discordAlert',      method: 'toggle' },
                { label: this.t('row_mult_tools'), active: false, value: this.t('mt_prefix_value', { prefix: bot.multTools?._renamePrefix ?? 'OC' }), module: null, method: null },
                { label: this.t('row_trade_manual'), active: false, value: this.t('manual_via_console'), module: null, method: null },
            ]);

            let html = '';
            let activeTotal = 0;
            let total = 0;
            for (const category of rows) {
                const activeCount = category.entries.filter(entry => entry.active).length;
                activeTotal += activeCount;
                total += category.entries.length;
                html += this._categoryHeader(category.label, activeCount, category.entries.length);
                html += category.entries
                    .map(entry => this._row(entry.label, entry.active, entry.value, entry.module, entry.method))
                    .join('');
            }

            uw.$('#status_rows').html(html);
            const $summary = uw.$('#status_summary');
            if ($summary.length) $summary.text(this.t('status_summary', { active: activeTotal, total }));
            this._renderSleeperStatus();
        } catch(e) {
            uw.$('#status_rows').text(`${this.t('error')}: ${e?.message ?? e}`).css({ padding: '5px', color: 'red' });
        }
    }

    /* Cabeçalho de categoria com a contagem de módulos ligados. */
    _categoryHeader(label, activeCount, totalCount) {
        const safeLabel = this.escapeHtml(label);
        return `
        <div style="display:flex;justify-content:space-between;align-items:center;
            padding:4px 8px 2px;margin-top:2px;font-size:11px;font-weight:bold;color:#5a3a0a;
            background:rgba(0,0,0,0.05);border-top:1px solid rgba(0,0,0,0.12);
            border-bottom:1px solid rgba(0,0,0,0.08);text-transform:uppercase;letter-spacing:0.5px;">
            <span>${safeLabel}</span>
            <span style="font-weight:normal;color:#8a7a5a;">${activeCount}/${totalCount}</span>
        </div>`;
    }

    _row(label, active, value, module, method) {
        const safeLabel = this.escapeHtml(label);
        const safeValue = this.escapeHtml(value);
        const onclick = module && method
            ? `window.multBot.${module}.${method}()`
            : null;

        const btn = onclick
            // Não usa a classe "disabled" no estado parado: em alguns
            // clientes ela aplica pointer-events:none e impedia ligar o
            // módulo justamente pelo painel de Status.
            ? `<div class="button_new" onclick="${onclick}" style="cursor:pointer;margin:0;opacity:${active ? '1' : '0.78'};">
                <div class="left"></div><div class="right"></div>
                <div class="caption js-caption">${active ? this.t('active') : this.t('stopped')}<div class="effect js-effect"></div></div>
               </div>`
            : `<span style="font-size:11px;color:#3a2a0a;font-style:italic;">${active ? '● ' + this.t('active') : '○ —'}</span>`;

        return `
        <div style="display:flex;justify-content:space-between;align-items:center;
            padding:4px 8px;border-bottom:1px solid rgba(0,0,0,0.08);
            ${active ? 'background:rgba(0,80,0,0.05);' : ''}">
            <span style="font-weight:bold;font-size:12px;">${safeLabel}</span>
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:11px;color:#5a3a0a;">${safeValue}</span>
                ${btn}
            </div>
        </div>`;
    }

    _countCelebrations() {
        const result = { party: 0, theater: 0, triumph: 0 };
        try {
            const models = uw.MM.getModels().Celebration;
            if (!models) return result;
            for (const key in models) {
                const type = models[key].attributes.celebration_type;
                if (type in result) result[type]++;
            }
        } catch(e) {}
        return result;
    }
};
