// ══════════════════════════════════════════════════════
//  MODULE: MultTools
//  Ferramentas em massa para todas as cidades
// ══════════════════════════════════════════════════════
var MultTools = class extends MultUtil {
    constructor(c, s) {
        super(c, s);
        // Prefixo salvo entre sessões; valor inválido/corrompido
        // no localStorage cai no padrão "OC" em vez de quebrar o rename.
        this._renamePrefix = this._sanitizePrefix(this.storage.load('mt_rename_prefix', 'OC')) ?? 'OC';
    }

    settings = () => {
        requestAnimationFrame(() => this._wireRenamePrefix());
        const prefix = this._renamePrefix;
        return `
        <div class="game_border" style="margin-bottom: 20px;">
            <div class="game_border_top"></div>
            <div class="game_border_bottom"></div>
            <div class="game_border_left"></div>
            <div class="game_border_right"></div>
            <div class="game_border_corner corner1"></div>
            <div class="game_border_corner corner2"></div>
            <div class="game_border_corner corner3"></div>
            <div class="game_border_corner corner4"></div>
            <div class="game_header bold" style="position:relative;">
                <span style="z-index:10;position:relative;">${this.t('mt_title')}</span>
                <span class="command_count"></span>
            </div>
            <div id="autoparty_types">
                <div class="split_content">
                    <div style="padding:5px;">
                        <p style="margin:0 0 4px;font-size:11px;font-weight:bold;">${this.t('mt_buildings_label')}</p>
                        <p style="margin:0 0 6px;font-size:11px;color:#888;">${this.t('mt_buildings_desc')}</p>
                        ${this.getButtonHtml('mult_preset_btn', '⚡ ' + this.t('apply'), this.applyPreset)}
                    </div>
                    <div style="padding:5px;">
                        <p style="margin:0 0 4px;font-size:11px;font-weight:bold;">${this.t('mt_colonize_label')}</p>
                        <p style="margin:0 0 6px;font-size:11px;color:#888;">${this.t('mt_colonize_desc')}</p>
                        ${this.getButtonHtml('mult_naval_btn', '⚓ ' + this.t('apply'), this.applyNavalPreset)}
                    </div>
                    <div style="padding:5px;">
                        <p style="margin:0 0 4px;font-size:11px;font-weight:bold;">${this.t('mt_research_label')}</p>
                        <p style="margin:0 0 6px;font-size:11px;color:#888;">${this.t('mt_research_desc')}</p>
                        ${this.getButtonHtml('mult_research_btn', '🔬 ' + this.t('apply'), this.applyResearchPreset)}
                    </div>
                    <div style="padding:5px;">
                        <p style="margin:0 0 4px;font-size:11px;font-weight:bold;">${this.t('mt_rename_label')}</p>
                        <p style="margin:0 0 6px;font-size:11px;color:#888;">${this.t('mt_rename_desc')}</p>
                        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px;">
                            <label style="font-size:11px;font-weight:bold;" for="mt_rename_prefix_input">${this.t('mt_rename_prefix_label')}</label>
                            <input id="mt_rename_prefix_input" type="text" maxlength="12" autocomplete="off"
                                value="${this.escapeHtml(prefix)}"
                                placeholder="OC"
                                style="width:90px;padding:3px 5px;font-size:11px;" />
                            ${this.getButtonHtml('mt_save_prefix_btn', '💾 ' + this.t('apply'), this.saveRenamePrefix, '')}
                        </div>
                        <p id="mt_rename_prefix_msg" style="margin:0 0 6px;font-size:10px;color:#888;">${this.t('mt_rename_prefix_hint', { example: prefix + '54-01' })}</p>
                        <p style="margin:0 0 2px;font-size:10px;font-weight:bold;color:#888;">${this.t('mt_rename_preview')}</p>
                        <div id="mt_rename_preview" style="max-height:96px;overflow:auto;padding:4px 6px;font-size:10px;line-height:1.5;background:rgba(0,0,0,0.06);border:1px solid rgba(0,0,0,0.08);border-radius:3px;"></div>
                        <div style="margin-top:6px;">
                            ${this.getButtonHtml('mult_rename_btn', '🏷️ ' + this.t('apply'), this.renameCities)}
                        </div>
                    </div>
                </div>
                <div style="padding:5px;">
                    <span id="mult_status" style="font-size:11px;color:#4ade80;"></span>
                </div>
            </div>
        </div>`;
    };

    /* Preset em massa: aplica em TODAS as cidades via a API publica
       do AutoBuild (applyPresetToAllTowns), em vez de ler/escrever
       uw.multBot.autoBuild.towns_buildings diretamente. Se o AutoBuild
       nao inicializou, avisa em vez de estourar exceção. */
    applyPreset = () => {
        try {
            const autoBuild = uw.multBot.autoBuild;
            if (!autoBuild) { uw.$('#mult_status').text(this.t('mt_module_not_found', { name: 'Auto Build' })).css('color','#f87171'); return; }

            const count = autoBuild.applyPresetToAllTowns({ barracks: 5, wall: 0 });
            if (count === 0) { uw.$('#mult_status').text(this.t('mt_no_city_found')).css('color','#f87171'); return; }

            const msg = this.t('mt_preset_applied', { count });
            uw.$('#mult_status').text(msg).css('color','#4ade80');
            this.console.log('[MultTools] ' + msg);
            this.notify(msg, 'success');
        } catch (e) {
            uw.$('#mult_status').text(this.t('error') + ': ' + (e?.message ?? e)).css('color','#f87171');
            this.console.log('[MultTools] ' + this.t('error') + ': ' + (e?.message ?? e));
        }
    };

    /* Preset em massa de colonize_ship: a elegibilidade (doca >= 10,
       pesquisa colonize_ship feita) continua checada aqui, cidade a
       cidade, mas a escrita da quantidade-alvo vai pela API publica
       setTroopTarget do AutoTrain, em vez de mexer em city_troops
       diretamente. */
    applyNavalPreset = () => {
        try {
            const autoTrain = uw.multBot.autoTrain;
            if (!autoTrain) { uw.$('#mult_status').text(this.t('mt_module_not_found', { name: 'Auto Train' })).css('color','#f87171'); return; }

            const townIds = Object.keys(uw.ITowns.towns);
            if (townIds.length === 0) { uw.$('#mult_status').text(this.t('mt_no_city_found')).css('color','#f87171'); return; }

            let count = 0;
            for (const townId of townIds) {
                // Verifica se a cidade tem doca e pesquisa de colonize_ship
                const buildings  = uw.ITowns.towns[townId].buildings()?.attributes;
                const researches = uw.ITowns.towns[townId].researches()?.attributes;
                if (!buildings?.docks || buildings.docks < 10) continue;
                if (!researches?.colonize_ship) continue;

                // Max colonize_ship = população total da cidade / custo de população
                const totalPop = autoTrain.getTotalPopulation(townId);
                const popCost  = uw.GameData.units['colonize_ship']?.population ?? 170;
                const maxQty   = Math.floor(totalPop / popCost);
                if (maxQty <= 0) continue;

                autoTrain.setTroopTarget(townId, 'colonize_ship', maxQty);
                count++;
            }

            const msg = this.t('mt_naval_applied', { count });
            uw.$('#mult_status').text(msg).css('color','#4ade80');
            this.console.log('[MultTools] ' + msg);
            this.notify(msg, 'success');
        } catch (e) {
            uw.$('#mult_status').text(this.t('error') + ': ' + (e?.message ?? e)).css('color','#f87171');
            this.console.log('[MultTools] ' + this.t('error') + ': ' + (e?.message ?? e));
        }
    };

    /* Liga o Auto Pesquisa (AutoResearch) para todas as cidades de uma vez.
       O módulo em si já roda automaticamente em todas as cidades do jogador
       assim que ativo — aqui só garantimos que está ligado, via a API
       publica ensureActive(), sem precisar checar _active/_tick aqui. */
    applyResearchPreset = () => {
        try {
            const research = uw.multBot.autoResearch;
            if (!research) {
                uw.$('#mult_status').text(this.t('mt_module_not_found', { name: this.t('mt_research_label') })).css('color','#f87171');
                return;
            }

            const townCount = Object.keys(uw.ITowns.towns).length;
            if (townCount === 0) { uw.$('#mult_status').text(this.t('mt_no_city_found')).css('color','#f87171'); return; }

            research.ensureActive();

            const msg = this.t('mt_research_applied', { count: townCount });
            uw.$('#mult_status').text(msg).css('color','#4ade80');
            this.console.log('[MultTools] ' + msg);
            this.notify(msg, 'success');
        } catch (e) {
            uw.$('#mult_status').text(this.t('error') + ': ' + (e?.message ?? e)).css('color','#f87171');
            this.console.log('[MultTools] ' + this.t('error') + ': ' + (e?.message ?? e));
        }
    };

    /* Prefixo válido: letras, números, espaço, "-" ou "_", até 12
       caracteres. Retorna null quando inválido (o chamador decide se
       avisa o usuário ou cai no padrão "OC"). */
    _sanitizePrefix = (raw) => {
        if (typeof raw !== 'string') return null;
        const cleaned = raw.trim().replace(/\s+/g, ' ').slice(0, 12);
        if (cleaned.length === 0) return null;
        return /^[A-Za-z0-9 _-]+$/.test(cleaned) ? cleaned : null;
    };

    /* Monta o plano de renomeação: agrupa as cidades por oceano, ordena
       dentro de cada oceano pelo ID da cidade e gera o nome final
       "{prefixo}{oceano}-{seq}". Usado pela prévia e pelo rename em si,
       para os dois nunca divergirem. */
    _buildRenamePlan = (prefix) => {
        const towns = Object.values(uw.ITowns?.towns ?? {});
        const byOcean = {};
        for (const town of towns) {
            // getIslandX/Y confirmado hoje via inspecao real do
            // prototipo do modelo towns_collection — e diferente de
            // getIslandCoordinateX/Y que existe em ITowns.towns mas
            // pode nao estar disponivel em todos os contextos.
            // Usa fallback pra garantir compatibilidade.
            const x = town.getIslandX ? town.getIslandX() : town.getIslandCoordinateX();
            const y = town.getIslandY ? town.getIslandY() : town.getIslandCoordinateY();
            const ocean = this.getOceanNumber(x, y);
            if (!byOcean[ocean]) byOcean[ocean] = [];
            byOcean[ocean].push(town);
        }
        for (const ocean in byOcean) {
            byOcean[ocean].sort((a, b) => a.id - b.id);
        }

        const plan = [];
        for (const ocean in byOcean) {
            let seq = 1;
            for (const town of byOcean[ocean]) {
                plan.push({
                    town,
                    ocean,
                    name: prefix + ocean + '-' + String(seq).padStart(2, '0'),
                });
                seq++;
            }
        }
        return plan;
    };

    /* Mostra as primeiras cidades do plano com o prefixo ATUAL do campo
       (mesmo antes de salvar), para o usuário ver o efeito na hora. */
    _renderRenamePreview = (useInputValue = false) => {
        const $preview = uw.$('#mt_rename_preview');
        if (!$preview.length) return;

        let prefix = this._renamePrefix;
        if (useInputValue) {
            const raw = (uw.$('#mt_rename_prefix_input').val() ?? '');
            prefix = this._sanitizePrefix(raw) ?? this._renamePrefix;
        }

        let plan = [];
        try {
            plan = this._buildRenamePlan(prefix);
        } catch (e) {
            plan = [];
        }

        if (plan.length === 0) {
            $preview.html(`<span style="color:#888;">${this.t('mt_rename_preview_empty')}</span>`);
            return;
        }

        const lines = plan.slice(0, 8).map(entry => {
            const current = this.escapeHtml(this.getTownName(entry.town.id));
            return `<div><b>${this.escapeHtml(entry.name)}</b> ← ${current}</div>`;
        });
        if (plan.length > 8) {
            lines.push(`<div style="color:#888;">${this.t('mt_rename_preview_more', { n: plan.length - 8 })}</div>`);
        }
        $preview.html(lines.join(''));
    };

    /* Evento do campo de prefixo (namespace próprio para não empilhar
       handlers a cada render da aba Mult). */
    _wireRenamePrefix = () => {
        const $input = uw.$('#mt_rename_prefix_input');
        if (!$input.length) return;
        uw.$(document)
            .off('input.multbot_rename_prefix')
            .on('input.multbot_rename_prefix', '#mt_rename_prefix_input', () => this._renderRenamePreview(true));
        this._renderRenamePreview(false);
    };

    saveRenamePrefix = () => {
        const $msg = uw.$('#mt_rename_prefix_msg');
        const prefix = this._sanitizePrefix(uw.$('#mt_rename_prefix_input').val() ?? '');

        if (!prefix) {
            $msg.text(this.t('mt_rename_prefix_invalid')).css('color', '#f87171');
            uw.$('#mult_status').text(this.t('mt_rename_prefix_invalid')).css('color', '#f87171');
            return;
        }

        this._renamePrefix = prefix;
        this.storage.save('mt_rename_prefix', prefix);
        $msg.text(this.t('mt_rename_prefix_hint', { example: prefix + '54-01' })).css('color', '#888');
        uw.$('#mult_status').text(this.t('mt_rename_prefix_saved', { prefix })).css('color', '#4ade80');
        this.console.log('[MultTools] ' + this.t('mt_rename_prefix_saved', { prefix }));
        this._renderRenamePreview(false);
    };

    /* Calcula o oceano a partir da coordenada da ilha. Confirmado
       com 2 pontos reais capturados no jogo:
       (568,411) -> oceano 54 ; (560,393) -> oceano 53
       Formula: primeiro digito = X/100 (pra baixo), segundo
       digito = Y/100 (pra baixo). */
    getOceanNumber = (x, y) => {
        const tens = Math.floor(x / 100);
        const units = Math.floor(y / 100);
        return String(tens) + String(units);
    };

    /* Renomeia TODAS as cidades do jogador no formato {prefixo}xx-NN
       (oceano + sequencial dentro do oceano). A ordem sequencial
       dentro de cada oceano e pelo ID da cidade (proxy da ordem
       de fundacao) - se quiser outro criterio de ordenacao, e so
       trocar o sort em _buildRenamePlan.
       O prefixo é o field "mt_rename_prefix" (aba Mult, padrão "OC").
       Confirmado via captura real de rede: model_url "Town/{id}",
       action_name "setTownName", arguments: { town_name }. */
    renameCities = async () => {
        if (uw.__multbot_captcha_active || this.isSleeping()) return;
        try {
            const plan = this._buildRenamePlan(this._renamePrefix);
            if (plan.length === 0) {
                uw.$('#mult_status').text(this.t('mt_no_city_found')).css('color', '#f87171');
                this.notify(this.t('mt_no_city_found'), 'error');
                return;
            }

            let count = 0;
            for (const entry of plan) {
                if (uw.__multbot_captcha_active || this.isSleeping()) return;
                const { town, name } = entry;

                try {
                    const data = {
                        model_url: 'Town/' + town.id,
                        action_name: 'setTownName',
                        captcha: null,
                        arguments: { town_name: name },
                        town_id: town.id,
                        nl_init: true,
                    };
                    const res = await this.ajaxPostWithTimeout('frontend_bridge', 'execute', data);
                    if (res && !res.error) {
                        const msg = this.t('mt_renamed_log', { town: town.getName(), name });
                        this.console.log('[MultTools] ' + msg);
                        count++;
                    } else {
                        this.console.log('[MultTools] ' + this.t('mt_rename_error', { town: town.getName(), msg: res?.error ?? '?' }));
                    }
                } catch (e) {
                    this.console.log('[MultTools] ' + this.t('mt_rename_error', { town: town.getName(), msg: e?.message ?? e }));
                }

                await this.sleep(400);
            }

            const msg = this.t('mt_rename_complete', { count });
            uw.$('#mult_status').text(msg).css('color','#4ade80');
            this.console.log('[MultTools] ' + msg);
            this.notify(msg, count > 0 ? 'success' : 'error');
        } catch (e) {
            const msg = this.t('error') + ': ' + (e?.message ?? e);
            uw.$('#mult_status').text(msg).css('color','#f87171');
            this.console.log('[MultTools] ' + msg);
            this.notify(msg, 'error');
        }
    };
};
