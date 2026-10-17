// ══════════════════════════════════════════════════════
//  MODULE: AutoSendResources  (v2.1 - Anti-Overflow Fix)
//
//  MODOS DE OPERACAO:
//  ─────────────────────────────────────────────────────
//  [balance]  Balanceamento global:
//             Calcula a media de cada recurso entre TODAS
//             as cidades. Cidades acima da media enviam o
//             excedente para cidades abaixo da media.
//             Gatilho extra: qualquer cidade que bater 90%
//             do armazem envia IMEDIATAMENTE para a cidade
//             com menor desenvolvimento (valvula de alivio).
//
//  [manual]   Destino FIXO escolhido pelo usuario.
//             Cidades que batem 90% de armazem enviam para
//             essa cidade escolhida. Mesma logica de antes,
//             agora com percentual de gatilho configuravel.
//
//  REGRAS GERAIS:
//  - Remetente precisa ter mercado ativo (nivel >= 1)
//  - Capacidade minima de 200 unidades de comercio
//  - Nunca envia se o destino ja tiver > 90% de armazem
//    em QUALQUER recurso individualmente (fix v2.1)
//  - Margem de seguranca de 10% no destino (fix v2.1)
//  - Espaco minimo real por recurso verificado antes do envio
// ══════════════════════════════════════════════════════
var AutoSendResources = class extends MultUtil {
    constructor(c, s) {
        super(c, s);
        this._generation = 0;
        this._restoreTimeout = null;
        this._active        = false;
        this._intervalId    = null;

        this.mode                 = this.storage.load('asr_mode', 'balance');
        this.manualTargetId       = this.storage.load('asr_manual_target', null);
        this.checkIntervalMinutes = this.storage.load('asr_interval_min', 20);
        this.overflowThreshold    = this.storage.load('asr_overflow_pct', 90); // % do armazem
        this.sendThreshold        = this.storage.load('asr_send_pct', 60);     // excedente acima de X%

        if (this.storage.load('asr_active', false)) {
            this._restoreTimeout = setTimeout(() => this.start(), 2500);
        }
    }

    // ── Lista de tipos de construcao (para calculo de pontuacao) ──
    BUILDING_TYPES = [
        'main', 'storage', 'farm', 'academy', 'temple',
        'barracks', 'docks', 'market', 'hide',
        'lumber', 'stoner', 'ironer', 'wall'
    ];

    // ─────────────────────────────────────────────────────────────
    //  UI - Settings Panel
    // ─────────────────────────────────────────────────────────────
    settings = () => {
        requestAnimationFrame(() => {
            this._updateTitle();
            this._updateModeButtons();
        });
        return '' +
        '<div class="game_border" style="margin-bottom:20px;">' +
        '  <div class="game_border_top"></div><div class="game_border_bottom"></div>' +
        '  <div class="game_border_left"></div><div class="game_border_right"></div>' +
        '  <div class="game_border_corner corner1"></div><div class="game_border_corner corner2"></div>' +
        '  <div class="game_border_corner corner3"></div><div class="game_border_corner corner4"></div>' +
        this.getTitleHtml('asr_title', '⚖ Auto Envio de Recursos', this.toggle, '', this._active) +

        // Descricao do modo
        '  <div style="padding:5px 10px 2px;font-weight:bold;font-size:12px;">' +
        '    Balanceia recursos entre cidades e aciona envio urgente quando alguma cidade bater o limite de armazém.' +
        '  </div>' +

        // Seletor de modo
        '  <div style="padding:4px 10px;display:flex;gap:6px;align-items:center;">' +
        '    <span style="font-size:11px;font-weight:bold;">Modo:</span>' +
        this.getButtonHtml('asr_mode_balance', '⚖ Balancear', this.setMode, 'balance') +
        this.getButtonHtml('asr_mode_manual',  '📌 Manual',   this.setMode, 'manual') +
        '  </div>' +

        // Parametros globais
        '  <div style="padding:4px 10px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +

        '    <span style="font-size:11px;font-weight:bold;">Verificar a cada</span>' +
        '    <input id="asr_interval_input" type="number" min="1" max="1440" value="' + this.checkIntervalMinutes + '" style="width:50px;padding:2px 4px;" />' +
        '    <span style="font-size:11px;">min</span>' +

        '    <span style="font-size:11px;font-weight:bold;margin-left:8px;">Alarme armazém</span>' +
        '    <input id="asr_overflow_input" type="number" min="50" max="99" value="' + this.overflowThreshold + '" style="width:45px;padding:2px 4px;" />' +
        '    <span style="font-size:11px;">%</span>' +

        '    <span style="font-size:11px;font-weight:bold;margin-left:8px;">Enviar excedente ></span>' +
        '    <input id="asr_send_input" type="number" min="10" max="90" value="' + this.sendThreshold + '" style="width:45px;padding:2px 4px;" />' +
        '    <span style="font-size:11px;">%</span>' +

        this.getButtonHtml('asr_save_params_btn', '💾 Salvar', this._saveParams) +
        '  </div>' +
        '  <div id="asr_param_status" style="padding:0 10px 2px;font-size:11px;color:#5a3a0a;min-height:14px;"></div>' +

        // Controles do modo Manual
        '  <div id="asr_manual_controls" style="padding:4px 10px 6px;display:none;">' +
        '    <label style="font-size:11px;font-weight:bold;">🏙 Cidade Destino Fixa</label><br>' +
        '    <div style="display:flex;gap:6px;align-items:center;margin-top:3px;">' +
        '      <select id="asr_manual_target_select" style="flex:1;padding:3px;">' + this._getTownOptionsHtml() + '</select>' +
        this.getButtonHtml('asr_manual_save_btn', 'Salvar', this.saveManualTarget) +
        '    </div>' +
        '    <div id="asr_manual_target_status" style="font-size:11px;color:#5a3a0a;margin-top:3px;">' +
        (this.manualTargetId
            ? '✓ Destino: ' + (uw.ITowns.towns[this.manualTargetId] && uw.ITowns.towns[this.manualTargetId].getName
                ? uw.ITowns.towns[this.manualTargetId].getName()
                : '#' + this.manualTargetId)
            : 'Nenhum destino configurado.') +
        '    </div>' +
        '  </div>' +

        // Log
        '  <div id="asr_log" style="padding:3px 10px 8px;font-size:11px;color:#5a3a0a;min-height:32px;white-space:pre-line;"></div>' +
        '</div>';
    };

    // ─────────────────────────────────────────────────────────────
    //  Controles: start / stop / toggle
    // ─────────────────────────────────────────────────────────────
    toggle = () => {
        if (this._active) this.stop();
        else this.start();
    };

    start() {
        clearTimeout(this._restoreTimeout);
        this._restoreTimeout = null;
        if (this._active) return;
        this._active = true;
        this._generation++;
        this.storage.save('asr_active', true);
        this._updateTitle();
        this.console.log('[AutoRecursos] Iniciado. Modo: ' + this.mode + ' | Intervalo: ' + this.checkIntervalMinutes + ' min | Alarme: ' + this.overflowThreshold + '%');
        this._tick();
        this._intervalId = this.createGuardedInterval(() => this._tick(), this.checkIntervalMinutes * 60 * 1000);
    }

    stop() {
        clearTimeout(this._restoreTimeout);
        this._restoreTimeout = null;
        this._generation++;
        this._active = false;
        this.storage.save('asr_active', false);
        if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
        this._updateTitle();
        this.console.log('[AutoRecursos] Parado.');
        this._setLog('⏹ Módulo parado.');
    }

    _updateTitle() {
        uw.$('#asr_title').css('filter', this._active
            ? 'brightness(100%) saturate(186%) hue-rotate(241deg)' : '');
    }

    // ─────────────────────────────────────────────────────────────
    //  Controles de UI
    // ─────────────────────────────────────────────────────────────
    setMode = (mode) => {
        this.mode = mode;
        this.storage.save('asr_mode', mode);
        this._updateModeButtons();
        this.console.log('[AutoRecursos] Modo: ' + mode);
    };

    _updateModeButtons() {
        if (this.mode === 'manual') {
            uw.$('#asr_mode_balance').addClass('disabled');
            uw.$('#asr_mode_manual').removeClass('disabled');
            uw.$('#asr_manual_controls').show();
        } else {
            uw.$('#asr_mode_manual').addClass('disabled');
            uw.$('#asr_mode_balance').removeClass('disabled');
            uw.$('#asr_manual_controls').hide();
        }
    }

    _saveParams = () => {
        const interval = parseInt(uw.$('#asr_interval_input').val(), 10);
        const overflow = parseInt(uw.$('#asr_overflow_input').val(), 10);
        const send     = parseInt(uw.$('#asr_send_input').val(), 10);

        if (!interval || interval < 1) {
            uw.$('#asr_param_status').text('✗ Intervalo inválido (mín. 1 min).').css('color', '#f87171');
            return;
        }
        if (!overflow || overflow < 50 || overflow > 99) {
            uw.$('#asr_param_status').text('✗ Alarme deve ser entre 50% e 99%.').css('color', '#f87171');
            return;
        }
        if (!send || send < 10 || send > 90) {
            uw.$('#asr_param_status').text('✗ Excedente deve ser entre 10% e 90%.').css('color', '#f87171');
            return;
        }

        this.checkIntervalMinutes = interval;
        this.overflowThreshold    = overflow;
        this.sendThreshold        = send;
        this.storage.save('asr_interval_min', interval);
        this.storage.save('asr_overflow_pct', overflow);
        this.storage.save('asr_send_pct',     send);

        uw.$('#asr_param_status').text('✓ Parâmetros salvos: ' + interval + ' min | alarme ' + overflow + '% | excedente >' + send + '%').css('color', '#1a6b2a');

        if (this._active) {
            if (this._intervalId) clearInterval(this._intervalId);
            this._intervalId = this.createGuardedInterval(() => this._tick(), this.checkIntervalMinutes * 60 * 1000);
        }
        this.console.log('[AutoRecursos] Parâmetros salvos: intervalo=' + interval + 'min, alarme=' + overflow + '%, excedente>' + send + '%');
    };

    saveManualTarget = () => {
        const id = uw.$('#asr_manual_target_select').val();
        if (!id) {
            uw.$('#asr_manual_target_status').text('Selecione uma cidade.').css('color', '#f87171');
            return;
        }
        this.manualTargetId = id;
        this.storage.save('asr_manual_target', id);
        const name = uw.ITowns.towns[id] && uw.ITowns.towns[id].getName ? uw.ITowns.towns[id].getName() : '#' + id;
        uw.$('#asr_manual_target_status').text('✓ Destino: ' + name).css('color', '#1a6b2a');
        this.console.log('[AutoRecursos] Destino manual: ' + name);
    };

    _getTownOptionsHtml() {
        try {
            const towns = uw.ITowns.towns;
            const keys  = Object.keys(towns);
            keys.sort((a, b) => {
                const nameA = towns[a].getName ? towns[a].getName() : '';
                const nameB = towns[b].getName ? towns[b].getName() : '';
                return nameA.localeCompare(nameB);
            });
            let html = '<option value="">Selecione...</option>';
            for (const id of keys) {
                const t    = towns[id];
                const name = t.getName ? t.getName() : ('#' + id);
                const sel  = (String(id) === String(this.manualTargetId)) ? ' selected' : '';
                html += '<option value="' + this.escapeHtml(id) + '"' + sel + '>' + this.escapeHtml(name) + '</option>';
            }
            return html;
        } catch (e) {
            return '<option value="">Erro ao carregar cidades</option>';
        }
    }

    _setLog(msg) {
        uw.$('#asr_log').text(msg);
    }

    // ─────────────────────────────────────────────────────────────
    //  TICK PRINCIPAL
    // ─────────────────────────────────────────────────────────────
    _canRun(generation) {
        return this._active && generation === this._generation
            && !uw.__multbot_captcha_active && !this.isSleeping();
    }

    async _tick() {
        const generation = this._generation;
        if (!this._canRun(generation)) return;
        return this.runExclusive('tick', async () => {
            try {
                const townIds = Object.keys(uw.ITowns.towns);
                if (townIds.length < 2) return;
                // Snapshot em trânsito + reservas locais dos envios deste ciclo.
                const incoming = await this._loadIncomingResources();
                if (!this._canRun(generation)) return;
                const cycle = { generation, incoming };
                if (this.mode === 'manual') {
                    await this._tickManual(townIds, cycle);
                } else {
                    await this._tickBalance(townIds, cycle);
                }
            } catch (error) {
                this.console.log('[' + this.constructor.name + '] Ciclo interrompido: ' + (error?.message ?? error));
            }
        });
    }

    // ─────────────────────────────────────────────────────────────
    //  MODO BALANCEAMENTO
    //  Logica:
    //  1. Detecta cidades em 90%+ (urgente) → envia imediatamente
    //     para a cidade menos desenvolvida com espaco no armazem.
    //  2. Calcula a media de cada recurso entre todas as cidades.
    //  3. Cidades muito acima da media (> sendThreshold%) enviam
    //     o excedente para cidades abaixo da media.
    // ─────────────────────────────────────────────────────────────
    async _tickBalance(townIds, cycle) {
        const lines = [];
        const urgentHandled = new Set();

        // ── PASSO 1: Urgente (90%+) ──────────────────────────────
        const urgentSenders = townIds.filter(id => this._isOverflowing(id));
        if (urgentSenders.length > 0) {
            lines.push('🚨 ' + urgentSenders.length + ' cidade(s) com armazém em ' + this.overflowThreshold + '%+');
            this.console.log('[AutoRecursos] [URGENTE] ' + urgentSenders.length + ' cidade(s) em ' + this.overflowThreshold + '%+');

            // Destino: menos desenvolvida com espaco
            const devTargets = this._findLeastDevelopedTowns(townIds, cycle);
            for (const fromId of urgentSenders) {
                if (!this._canRun(cycle.generation)) return;
                // Encontra o melhor destino (que nao seja o proprio remetente)
                const toId = devTargets.find(id => id !== fromId && this._hasRoomForAny(id, cycle));
                if (!toId) continue;

                const fromName = this.getTownName(fromId);
                const toName   = this.getTownName(toId);
                this.console.log('[AutoRecursos] [URGENTE] ' + fromName + ' → ' + toName);

                const ok = await this._sendResources(fromId, toId, true, cycle);
                if (!this._canRun(cycle.generation)) return;
                if (ok) urgentHandled.add(String(fromId));
                lines.push((ok ? '  ✓ ' : '  ✗ ') + fromName + ' → ' + toName);
            }
        }

        // ── PASSO 2: Calcular medias por recurso ──────────────────
        let totalW = 0, totalS = 0, totalI = 0;
        let validCount = 0;

        for (const id of townIds) {
            try {
                const res = uw.ITowns.towns[id].resources();
                totalW += res.wood;
                totalS += res.stone;
                totalI += res.iron;
                validCount++;
            } catch (e) {}
        }

        if (validCount < 2) return;

        const avgW = totalW / validCount;
        const avgS = totalS / validCount;
        const avgI = totalI / validCount;

        this.console.log('[AutoRecursos] Medias: 🪵' + Math.floor(avgW) + ' 🪨' + Math.floor(avgS) + ' ⚙' + Math.floor(avgI));

        // ── PASSO 3: Balancear remetentes → destinatarios ─────────
        // Remetentes: cidades com pelo menos 1 recurso muito acima da media
        // Destinatarios: cidades com todos os recursos abaixo da media
        const senders    = [];
        const receivers  = [];

        for (const id of townIds) {
            try {
                if (urgentHandled.has(String(id))) continue;
                const town     = uw.ITowns.towns[id];
                const res      = town.resources();
                const storage  = res.storage;
                const sendPct  = this.sendThreshold / 100;

                const hasExcess = (
                    res.wood  > avgW * 1.15 && res.wood  > storage * sendPct ||
                    res.stone > avgS * 1.15 && res.stone > storage * sendPct ||
                    res.iron  > avgI * 1.15 && res.iron  > storage * sendPct
                );

                // Verifica se tem mercado disponivel
                const buildings = town.buildings().attributes;
                const hasMkt    = buildings.market && buildings.market >= 1;
                const hasCap    = town.getAvailableTradeCapacity() >= 200;

                if (hasExcess && hasMkt && hasCap) {
                    senders.push(id);
                } else {
                    // Destinatario: tem espaco e esta abaixo da media em pelo menos 1 recurso
                    // FIX v2.1: usa _hasRoomForAny() para garantir espaco real por recurso
                    const needsRes = res.wood < avgW || res.stone < avgS || res.iron < avgI;
                    if (needsRes && !this._isAlmostFull(id) && this._hasRoomForAny(id, cycle)) {
                        receivers.push({ id, score: this._getDevelopmentScore(town) });
                    }
                }
            } catch (e) {}
        }

        // Ordena destinatarios pelo menos desenvolvidos primeiro
        receivers.sort((a, b) => a.score - b.score);

        if (senders.length === 0) {
            const noMsg = urgentSenders.length === 0
                ? 'Recursos equilibrados entre todas as cidades.'
                : '';
            if (noMsg) { lines.push('⚖ ' + noMsg); }
            this._setLog(lines.join('\n'));
            return;
        }

        lines.push('⚖ Balanceando: ' + senders.length + ' remetente(s) → ' + receivers.length + ' destino(s)');
        this.console.log('[AutoRecursos] ' + senders.length + ' remetente(s) / ' + receivers.length + ' destino(s)');

        if (receivers.length === 0) {
            lines.push('Sem destinos disponíveis para balancear.');
            this._setLog(lines.join('\n'));
            return;
        }

        /* Envio sequencial: vários remetentes podem apontar para o mesmo
           destino. Em paralelo, todos liam o mesmo espaço antigo do
           armazém e a soma podia ultrapassar a capacidade disponível. */
        let sentCount = 0;
        for (let i = 0; i < senders.length; i++) {
            if (!this._canRun(cycle.generation)) return;
            const fromId = senders[i];
            const candidates = receivers.slice(i % receivers.length).concat(receivers.slice(0, i % receivers.length));
            const toId = candidates.find(candidate => this._hasRoomForAny(candidate.id, cycle))?.id;
            if (!toId) break;
            const ok = await this._sendResources(fromId, toId, false, cycle);
            if (!this._canRun(cycle.generation)) return;
            if (ok) sentCount++;
            const fName = this.getTownName(fromId);
            const tName = this.getTownName(toId);
            lines.push('  ' + (ok ? '✓' : '✗') + ' ' + fName + ' → ' + tName);
            await this.sleep(300);
        }

        if (!this._canRun(cycle.generation)) return;
        const summary = sentCount > 0
            ? '✓ ' + sentCount + ' envio(s) realizados com sucesso.'
            : 'Nenhum envio concluído (sem excedente real ou destinos cheios).';
        lines.push(summary);
        this.console.log('[AutoRecursos] ' + summary);
        this._setLog(lines.join('\n'));
    }

    // ─────────────────────────────────────────────────────────────
    //  MODO MANUAL
    //  Destino fixo. Gatilho: cidade atinge overflowThreshold%.
    // ─────────────────────────────────────────────────────────────
    async _tickManual(townIds, cycle) {
        if (!this.manualTargetId) {
            this._setLog('⚠ Configure uma cidade destino no modo manual.');
            return;
        }

        const targetTown = uw.ITowns.towns[this.manualTargetId];
        if (!targetTown) {
            this._setLog('✗ Cidade destino não encontrada.');
            return;
        }

        // FIX v2.1: Verifica se destino tem espaço ANTES de tentar enviar
        if (this._isAlmostFull(this.manualTargetId)) {
            const msg = '⚠ Destino ' + this.getTownName(this.manualTargetId) + ' está com armazém cheio (≥90%). Envio cancelado.';
            this.console.log('[AutoRecursos] [Manual] ' + msg);
            this._setLog(msg);
            return;
        }

        const senders = townIds.filter(id => String(id) !== String(this.manualTargetId) && this._isOverflowing(id));
        if (!senders.length) {
            const msg = 'Nenhuma cidade em ' + this.overflowThreshold + '%+ de armazém.';
            this.console.log('[AutoRecursos] [Manual] ' + msg);
            this._setLog(msg);
            return;
        }

        const targetName = targetTown.getName();
        this.console.log('[AutoRecursos] [Manual] ' + senders.length + ' cidade(s) enviando para ' + targetName);

        // Envios em série compartilham as reservas do mesmo ciclo.
        let totalSent = 0;
        for (const fromId of senders) {
            if (!this._canRun(cycle.generation)) return;
            if (await this._sendResources(fromId, this.manualTargetId, true, cycle)) totalSent++;
            if (!this._canRun(cycle.generation)) return;
            await this.sleep(300);
        }
        if (!this._canRun(cycle.generation)) return;
        const msg = totalSent > 0
            ? '✓ ' + totalSent + ' cidade(s) enviaram para ' + targetName
            : 'Nenhum envio concluído (' + targetName + ' sem espaço?).';
        this.console.log('[AutoRecursos] [Manual] ' + msg);
        this._setLog(msg);
    }

    /* Usa o mesmo endpoint/formato já empregado pelo AutoTrade. Se a
       visão de comércio falhar, não assume trânsito zero: aborta o ciclo. */
    async _loadIncomingResources() {
        const response = await this.ajaxGetWithTimeout('town_overviews', 'trade_overview', {}, 10000, true);
        if (response?.error || !Array.isArray(response?.movements)) {
            throw new Error('Não foi possível consultar os recursos em trânsito.');
        }
        const incoming = new Map();
        for (const trade of response.movements) {
            const targetId = this._getTradeTargetId(trade);
            if (targetId === null || !uw.ITowns.towns[targetId]) continue;
            const amounts = incoming.get(targetId) || { wood: 0, stone: 0, iron: 0 };
            for (const resource of ['wood', 'stone', 'iron']) {
                const amount = Number(trade.res?.[resource]);
                if (!Number.isFinite(amount) || amount < 0) {
                    throw new Error('Quantidade inválida na visão de comércio.');
                }
                amounts[resource] += amount;
            }
            incoming.set(targetId, amounts);
        }
        return incoming;
    }

    _getTradeTargetId(trade) {
        const directId = trade?.target_town_id ?? trade?.to?.id;
        if (directId != null) {
            if (!/^\d+$/.test(String(directId))) throw new Error('Destino de comércio inválido.');
            return String(directId);
        }

        // Links nativos podem transportar o ID em data-* ou no hash JSON.
        const holder = document.createElement('div');
        holder.innerHTML = trade?.to?.link || '';
        const link = holder.querySelector('a');
        const dataId = link?.getAttribute('data-townid') || link?.getAttribute('data-town-id');
        if (dataId && /^\d+$/.test(dataId)) return dataId;
        const hash = link?.getAttribute('href')?.split('#')[1];
        if (hash) {
            try {
                const town = JSON.parse(atob(decodeURIComponent(hash)));
                if (town.id != null && /^\d+$/.test(String(town.id))) return String(town.id);
            } catch (_) { /* Fallback para links antigos, resolvidos pelo nome. */ }
        }

        const name = holder.textContent.trim();
        if (!name) throw new Error('Destino ausente na visão de comércio.');
        const matches = Object.values(uw.ITowns.towns).filter(town =>
            (town.getName ? town.getName() : town.name) === name
        );
        if (matches.length > 1) throw new Error('Destino de comércio ambíguo: ' + name);
        return matches.length === 1 ? String(matches[0].id) : null;
    }

    /* Distribuição equilibrada com reaproveitamento da capacidade que um
       recurso não consegue usar. Quantidades sempre inteiras e limitadas. */
    _allocateResources(limits, capacity) {
        const result = { wood: 0, stone: 0, iron: 0 };
        let remaining = Math.max(0, Math.floor(capacity));
        let available = Object.keys(result).filter(key => limits[key] > 0);
        while (remaining > 0 && available.length > 0) {
            const share = Math.max(1, Math.floor(remaining / available.length));
            for (const key of available) {
                const amount = Math.min(share, limits[key] - result[key], remaining);
                result[key] += amount;
                remaining -= amount;
            }
            available = available.filter(key => result[key] < limits[key]);
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────
    //  HELPERS de Estado
    // ─────────────────────────────────────────────────────────────

    // Verdadeiro se algum recurso atingiu o threshold de alarme (padrão 90%)
    _isOverflowing(townId) {
        try {
            const res       = uw.ITowns.towns[townId].resources();
            const threshold = res.storage * (this.overflowThreshold / 100);
            return res.wood >= threshold || res.stone >= threshold || res.iron >= threshold;
        } catch (e) {
            return false;
        }
    }

    // FIX v2.1: Verdadeiro se QUALQUER recurso esta em >= 90% do armazem
    // BUG ORIGINAL: usava && (todos cheios) em vez de || (qualquer um cheio)
    // Isso fazia cidades com 1 recurso cheio serem aceitas como destino
    _isAlmostFull(townId) {
        try {
            const res = uw.ITowns.towns[townId].resources();
            const cap = res.storage * 0.90; // 90% — nao aceita como destino
            // CORRIGIDO: || em vez de && → bloqueia se QUALQUER recurso estiver cheio
            return res.wood >= cap || res.stone >= cap || res.iron >= cap;
        } catch (e) {
            return true; // em caso de erro, assume cheio por seguranca
        }
    }

    _getResourceRoom(townId, incoming) {
        const res = uw.ITowns.towns[townId].resources();
        const reserved = incoming.get(String(townId)) || {};
        return Object.fromEntries(['wood', 'stone', 'iron'].map(resource => [
            resource,
            Math.max(0, Math.floor(res.storage * 0.90 - res[resource] - (reserved[resource] || 0))),
        ]));
    }

    _hasRoomForAny(townId, cycle) {
        try {
            const room = this._getResourceRoom(townId, cycle.incoming);
            return Object.values(room).some(amount => amount >= 500);
        } catch (e) {
            return false;
        }
    }

    // Pontuacao de desenvolvimento (soma de niveis de construcao)
    _getDevelopmentScore(town) {
        try {
            const buildings = town.buildings().attributes;
            let sum = 0;
            for (const key of this.BUILDING_TYPES) {
                const v = buildings[key];
                if (typeof v === 'number') sum += v;
            }
            return sum;
        } catch (e) {
            return Infinity;
        }
    }

    // Lista de cidades candidatas a destino, ordenadas da MENOS desenvolvida
    // para a mais, filtrando as que estao quase cheias.
    // FIX v2.1: room minimo aumentado de 150 para 500 por recurso
    _findLeastDevelopedTowns(townIds, cycle) {
        const candidates = [];
        for (const id of townIds) {
            try {
                const town   = uw.ITowns.towns[id];
                if (!this._hasRoomForAny(id, cycle)) continue;
                if (this._isAlmostFull(id)) continue;
                candidates.push({ id, score: this._getDevelopmentScore(town) });
            } catch (e) {}
        }
        candidates.sort((a, b) => a.score - b.score);
        return candidates.map(c => c.id);
    }

    // ─────────────────────────────────────────────────────────────
    //  ENVIO DE RECURSOS
    //  urgent=true  → envia TODO o excedente acima de 10% (modo urgente)
    //  urgent=false → envia excedente acima de sendThreshold% (balancear)
    //
    //  FIX v2.1: margem de seguranca no destino aumentada de 5% para 10%
    //  FIX v2.1: verifica espaco real por recurso ANTES de calcular envio
    // ─────────────────────────────────────────────────────────────
    _sendResources = async (fromId, toId, urgent, cycle) => {
        if (!cycle || !this._canRun(cycle.generation) || String(fromId) === String(toId)) return false;
        try {
            const from    = uw.ITowns.towns[fromId];
            const fromRes = from.resources();
            const cap     = from.getAvailableTradeCapacity();

            if (cap < 100) return false;

            // FIX v2.1: rejeita destino se qualquer recurso ja em >= 90%
            if (this._isAlmostFull(toId)) {
                this.console.log('[AutoRecursos] ✗ Destino ' + this.getTownName(toId) + ' com armazém cheio, pulando.');
                return false;
            }

            // Limite inferior para o remetente
            const keepPct  = urgent ? 0.10 : (this.sendThreshold / 100);
            const keepAmt  = fromRes.storage * keepPct;

            const excessW = Math.max(0, Math.floor(fromRes.wood  - keepAmt));
            const excessS = Math.max(0, Math.floor(fromRes.stone - keepAmt));
            const excessI = Math.max(0, Math.floor(fromRes.iron  - keepAmt));

            // O snapshot inclui o trânsito anterior; cada sucesso abaixo
            // reserva espaço adicional, mesmo antes de o jogo atualizar o modelo.
            const targetKey = String(toId);
            const reserved = cycle.incoming.get(targetKey) || { wood: 0, stone: 0, iron: 0 };
            const room = this._getResourceRoom(toId, cycle.incoming);
            const { wood, stone, iron } = this._allocateResources({
                wood: Math.min(excessW, room.wood),
                stone: Math.min(excessS, room.stone),
                iron: Math.min(excessI, room.iron),
            }, cap);
            const total  = wood + stone + iron;

            if (total < 50) return false;

            const fromName = from.getName ? from.getName() : ('#' + fromId);
            const toName   = this.getTownName(toId);

            this.console.log('[AutoRecursos] ' + (urgent ? '[URGENTE] ' : '') +
                fromName + ' → ' + toName + ': ' +
                '🪵' + wood + ' 🪨' + stone + ' ⚙' + iron);

            const data = {
                id:       parseInt(toId),
                wood:     wood,
                stone:    stone,
                iron:     iron,
                town_id:  parseInt(fromId),
                nl_init:  true
            };

            const res = await this.ajaxPostWithTimeout('town_info', 'trade', data, 15000, true);
            if (res && !res.error) {
                cycle.incoming.set(targetKey, {
                    wood: reserved.wood + wood,
                    stone: reserved.stone + stone,
                    iron: reserved.iron + iron,
                });
                return true;
            }
            if (!res) throw new Error('Envio sem confirmação do servidor.');

            this.console.log('[AutoRecursos] ✗ Erro trade: ' + (res && res.error ? res.error : JSON.stringify(res)));
            return false;
        } catch (e) {
            // Um timeout de POST pode ter ocorrido depois de o servidor
            // aceitar o envio. Não repete automaticamente um resultado incerto.
            this.stop();
            this._setLog('⚠ Envio sem confirmação. Confira o comércio antes de reiniciar.');
            throw e;
        }
    };
};
