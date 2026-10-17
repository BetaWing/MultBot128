#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};
async function until(predicate) {
    for (let i = 0; i < 50; i++) {
        if (predicate()) return;
        await Promise.resolve();
    }
    assert.fail('A operação esperada não foi iniciada.');
}

// Executa o MultUtil REAL. Somente o navegador, os timers e a API do jogo
// são simulados; não substitui as travas, o Sleeper ou os wrappers AJAX.
function environment(moduleFile) {
    let now = Date.UTC(2026, 9, 17, 12);
    let nextTimerId = 1;
    const timeouts = new Map();
    const intervals = new Map();
    const logs = [];
    const state = {};
    const storage = {
        load: (key, fallback) => key in state ? structuredClone(state[key]) : fallback,
        save: (key, value) => { state[key] = structuredClone(value); return true; },
    };
    class FakeDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
        getHours() { return this.getUTCHours(); }
        getMinutes() { return this.getUTCMinutes(); }
    }
    const $element = {
        text() { return this; }, css() { return this; }, html() { return this; },
    };
    const context = vm.createContext({
        uw: {
            Game: { townId: 99, town_id: 99 },
            ITowns: { towns: {} },
            MM: { getModels: () => ({ MovementsUnits: {} }) },
            $: () => $element,
        },
        console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
        multT: key => key,
        Date: FakeDate,
        atob: value => Buffer.from(value, 'base64').toString('utf8'),
        setTimeout: (fn, delay) => { const id = nextTimerId++; timeouts.set(id, { fn, delay }); return id; },
        clearTimeout: id => timeouts.delete(id),
        setInterval: (fn, delay) => { const id = nextTimerId++; intervals.set(id, { fn, delay }); return id; },
        clearInterval: id => intervals.delete(id),
        document: {
            // Fixtures do formato legado: o parsing real continua sendo do DOM
            // do navegador em produção. Os demais testes usam IDs explícitos.
            createElement: () => ({
                innerHTML: '',
                get textContent() { return this.innerHTML.replace(/<[^>]*>/g, ''); },
                querySelector() { return null; },
            }),
        },
    });
    const core = fs.readFileSync(path.join(root, 'Modules/core.js'), 'utf8');
    vm.runInContext(core.slice(core.indexOf('var MultUtil = class'), core.indexOf('var BotConsole = class')), context);
    if (moduleFile) {
        vm.runInContext(fs.readFileSync(path.join(root, 'Modules', moduleFile), 'utf8'), context);
    }
    return { context, state, storage, logs, timeouts, intervals, setNow: value => { now = value; } };
}
function instance(env, name) {
    return new env.context[name](env.context.console, env.storage);
}
function attackEnvironment() {
    const env = environment('auto_attack.js');
    const bot = instance(env, 'AutoAttack');
    bot.sleep = async () => {};
    bot._plans = [{ enabled: true, id: 1 }, { enabled: true, id: 2 }];
    return { ...env, bot };
}
function town(id, amounts, capacity = 3000) {
    return {
        id,
        getName: () => `Town ${id}`,
        resources: () => ({ storage: 10000, ...amounts }),
        getAvailableTradeCapacity: () => capacity,
        buildings: () => ({ attributes: { market: 1 } }),
    };
}
function resourcesEnvironment() {
    const env = environment('auto_send_resources.js');
    const bot = instance(env, 'AutoSendResources');
    bot.sleep = async () => {};
    bot.mode = 'manual';
    bot.manualTargetId = 3; // ID numérico também deve excluir a própria cidade.
    env.context.uw.ITowns.towns = {
        1: town(1, { wood: 10000, stone: 10000, iron: 10000 }, 3000),
        2: town(2, { wood: 10000, stone: 10000, iron: 10000 }, 6000),
        3: town(3, { wood: 6000, stone: 6000, iron: 6000 }),
    };
    bot.ajaxGetWithTimeout = async () => ({ movements: [] });
    return { ...env, bot };
}
function sniperEnvironment(saved) {
    const env = environment('sniper.js');
    if (saved) env.state.sniper_scheduled = saved;
    env.context.Sniper.prototype._startWatching = () => {};
    const bot = instance(env, 'Sniper');
    bot._renderList = () => {};
    const now = env.context.Date.now();
    const snipe = {
        id: 'test', status: 'pending', type: 'attack', originTownId: 1, targetId: 2,
        composition: { sword: 5 }, arrivalAt: now + 60000, sendAt: now,
    };
    bot._scheduled = saved ? bot._scheduled : [snipe];
    return { ...env, bot, snipe };
}

test('trava exclusiva é compartilhada e liberada após rejeição', async () => {
    const env = environment();
    const util = instance(env, 'MultUtil');
    const wait = deferred();
    let calls = 0;
    const first = util.runExclusive('tick', () => { calls++; return wait.promise; });
    await util.runExclusive('tick', () => { calls++; });
    assert.equal(calls, 1);
    wait.reject(new Error('offline'));
    await assert.rejects(first, /offline/);
    await util.runExclusive('tick', () => { calls++; });
    assert.equal(calls, 2);
});

test('intervalo real impede sobreposição e respeita o Sleeper', async () => {
    const env = environment();
    const util = instance(env, 'MultUtil');
    const wait = deferred();
    let calls = 0;
    const id = util.createGuardedInterval(() => { calls++; return wait.promise; }, 1000);
    const tick = env.intervals.get(id).fn;
    const first = tick();
    await tick();
    assert.equal(calls, 1);
    wait.resolve();
    await first;
    env.state.sleeper_enabled = true;
    env.state.sleeper_start = '11:00';
    env.state.sleeper_end = '13:00';
    await tick();
    assert.equal(calls, 1);
    const defense = util.createGuardedInterval(() => { calls++; }, 1000, false);
    await env.intervals.get(defense).fn();
    assert.equal(calls, 2);
});

test('Sleeper cobre limites, meia-noite e janela vazia', () => {
    const env = environment();
    const util = instance(env, 'MultUtil');
    env.state.sleeper_enabled = true;
    env.state.sleeper_start = '23:00';
    env.state.sleeper_end = '07:00';
    for (const [hour, minute, expected] of [[22, 59, false], [23, 0, true], [0, 0, true], [6, 59, true], [7, 0, false]]) {
        env.setNow(Date.UTC(2026, 9, 17, hour, minute));
        assert.equal(util.isSleeping(), expected);
    }
    env.state.sleeper_end = '23:00';
    assert.equal(util.isSleeping(), false);
    env.state.sleeper_enabled = false;
    assert.equal(util.isSleeping(), false);
});

test('GET/POST preservam contexto, argumentos, timeout e ignoram resposta tardia', async () => {
    for (const method of ['ajaxGet', 'ajaxPost']) {
        const env = environment();
        const util = instance(env, 'MultUtil');
        let success;
        env.context.uw.gpAjax = {
            [method](endpoint, action, data, flag, onSuccess) {
                assert.equal(this, env.context.uw.gpAjax);
                assert.equal(endpoint, 'town_info');
                assert.equal(action, 'test');
                assert.equal(data.town_id, 1);
                assert.equal(flag, true);
                success = onSuccess;
            },
        };
        const pending = util[method + 'WithTimeout']('town_info', 'test', { town_id: 1 }, 50, true);
        const rejected = assert.rejects(pending, error => error.code === 'NETWORK_TIMEOUT');
        [...env.timeouts.values()][0].fn();
        await rejected;
        success({ late: true });
        assert.equal(env.timeouts.size, 0);
        const next = util[method + 'WithTimeout']('town_info', 'test', { town_id: 1 }, 50, true);
        success({ ok: true });
        assert.equal((await next).ok, true);
        assert.equal(env.timeouts.size, 0);
    }
});

test('erro síncrono e erro de rede limpam o timer AJAX', async () => {
    const env = environment();
    const util = instance(env, 'MultUtil');
    env.context.uw.gpAjax = { ajaxPost() { throw new Error('sync'); } };
    await assert.rejects(util.ajaxPostWithTimeout('a', 'b', {}), /sync/);
    assert.equal(env.timeouts.size, 0);
    env.context.uw.gpAjax.ajaxPost = (_e, _a, _d, _f, _ok, fail) => fail(null, null, 'offline');
    await assert.rejects(util.ajaxPostWithTimeout('a', 'b', {}), /offline/);
    assert.equal(env.timeouts.size, 0);
});

test('Auto Attack: execução inicial, intervalo e restart usam a mesma trava', async () => {
    const env = attackEnvironment();
    const wait = deferred();
    const calls = [];
    env.bot._checkAndFire = async plan => { calls.push(plan.id); await wait.promise; };
    env.bot.start();
    assert.deepEqual(calls, [1]);
    await [...env.intervals.values()][0].fn();
    assert.deepEqual(calls, [1]);
    env.bot.stop();
    env.bot.start();
    await env.bot._tick();
    assert.deepEqual(calls, [1]);
    wait.resolve();
    await until(() => !env.bot._runningTasks.has('tick'));
    assert.deepEqual(calls, [1], 'O ciclo anterior não pode continuar após stop/start.');
    await env.bot._tick();
    assert.deepEqual(calls, [1, 1, 2]);
});

test('Auto Attack: parar durante a pausa entre planos impede novo envio', async () => {
    const env = attackEnvironment();
    const wait = deferred();
    let calls = 0;
    env.bot._checkAndFire = async () => { calls++; };
    env.bot.sleep = () => wait.promise;
    env.bot.start();
    await until(() => calls === 1);
    env.bot.stop();
    wait.resolve();
    await until(() => !env.bot._runningTasks.has('tick'));
    assert.equal(calls, 1);
});

test('parar antes da restauração automática cancela o início adiado', () => {
    for (const [file, name, key] of [
        ['auto_attack.js', 'AutoAttack', 'attack_active'],
        ['auto_send_resources.js', 'AutoSendResources', 'asr_active'],
    ]) {
        const env = environment(file);
        env.state[key] = true;
        const bot = instance(env, name);
        assert.equal(env.timeouts.size, 1);
        bot.stop();
        assert.equal(env.timeouts.size, 0);
        assert.equal(bot._active, false);
    }
});

test('recursos: trânsito anterior + dois remetentes não excedem espaço por recurso', async () => {
    const env = resourcesEnvironment();
    const movements = [{ to: { id: 3 }, res: { wood: 1000, stone: 1000, iron: 1000 } }];
    const sent = [];
    env.bot.ajaxGetWithTimeout = async () => ({ movements });
    env.bot.ajaxPostWithTimeout = async (_endpoint, _action, data) => {
        sent.push({ ...data });
        movements.push({ to: { id: data.id }, res: { wood: data.wood, stone: data.stone, iron: data.iron } });
        return {};
    };
    env.bot._active = true;
    await env.bot._tick();
    assert.equal(sent.length, 2);
    for (const resource of ['wood', 'stone', 'iron']) {
        assert.equal(sent.reduce((sum, data) => sum + data[resource], 0), 2000);
    }
    await env.bot._tick();
    assert.equal(sent.length, 2, 'Próximo ciclo deve reler os envios já em trânsito.');
    assert.ok(sent.every(data => data.id !== data.town_id));
});

test('recursos: aproveita capacidade restante sem exceder limites', () => {
    const env = resourcesEnvironment();
    const allocation = env.bot._allocateResources({ wood: 50, stone: 0, iron: 3000 }, 3000);
    assert.equal(allocation.wood, 50);
    assert.equal(allocation.stone, 0);
    assert.equal(allocation.iron, 2950);
    for (let cap = 0; cap < 100; cap++) {
        const amounts = env.bot._allocateResources({ wood: 7, stone: 23, iron: 11 }, cap);
        assert.equal(amounts.wood + amounts.stone + amounts.iron, Math.min(cap, 41));
        assert.ok(amounts.wood <= 7 && amounts.stone <= 23 && amounts.iron <= 11);
        assert.ok(Object.values(amounts).every(Number.isInteger));
    }
});

test('recursos: falha ou formato inválido na consulta não autoriza enviar', async () => {
    const env = resourcesEnvironment();
    let calls = 0;
    env.bot._active = true;
    env.bot.ajaxPostWithTimeout = async () => { calls++; return {}; };
    for (const response of [{}, { error: 'offline', movements: [] }, { movements: [{ to: { id: 3 }, res: { wood: -1 } }] }]) {
        env.bot.ajaxGetWithTimeout = async () => response;
        await env.bot._tick();
    }
    env.bot.ajaxGetWithTimeout = async () => { throw new Error('timeout'); };
    await env.bot._tick();
    assert.equal(calls, 0);
    assert.equal(env.bot._runningTasks.size, 0);
});

test('recursos: link legado resolve nome único e rejeita nome ambíguo', async () => {
    const env = resourcesEnvironment();
    const trade = { to: { link: '<a>Town 3</a>' }, res: { wood: '100', stone: 20, iron: 30 } };
    env.bot.ajaxGetWithTimeout = async () => ({ movements: [trade] });
    assert.equal((await env.bot._loadIncomingResources()).get('3').wood, 100);
    env.context.uw.ITowns.towns[4] = { id: 4, getName: () => 'Town 3' };
    await assert.rejects(env.bot._loadIncomingResources(), /ambíguo/);
});

test('recursos: stop/start durante envio não continua o ciclo antigo nem sobrepõe', async () => {
    const env = resourcesEnvironment();
    const wait = deferred();
    let calls = 0;
    env.bot.ajaxPostWithTimeout = () => { calls++; return wait.promise; };
    env.bot.start();
    await until(() => calls === 1);
    await [...env.intervals.values()][0].fn();
    assert.equal(calls, 1);
    env.bot.stop();
    env.bot.start();
    await env.bot._tick();
    wait.resolve({});
    await until(() => !env.bot._runningTasks.has('tick'));
    assert.equal(calls, 1);
});

test('recursos: parar durante consulta do trânsito impede o primeiro envio', async () => {
    const env = resourcesEnvironment();
    const wait = deferred();
    let calls = 0;
    env.bot.ajaxGetWithTimeout = () => wait.promise;
    env.bot.ajaxPostWithTimeout = async () => { calls++; return {}; };
    env.bot.start();
    env.bot.stop();
    wait.resolve({ movements: [] });
    await until(() => !env.bot._runningTasks.has('tick'));
    assert.equal(calls, 0);
});

test('recursos: POST incerto interrompe ciclo e desativa novas tentativas automáticas', async () => {
    const env = resourcesEnvironment();
    let calls = 0;
    env.bot.ajaxPostWithTimeout = async () => { calls++; throw new Error('timeout'); };
    env.bot._active = true;
    await env.bot._tick();
    await env.bot._tick();
    assert.equal(calls, 1);
    assert.equal(env.bot._active, false);
    assert.equal(env.state.asr_active, false);
});

test('Sniper: cancelamento não confirmado não espera nem reenvia tropas', async () => {
    const env = sniperEnvironment();
    let sends = 0;
    env.bot._fireOnce = async () => {
        sends++;
        return { ok: true, command: { command_id: 7, arrival_at: env.context.Date.now() / 1000 + 30, cancelable_until: env.context.Date.now() / 1000 + 20 } };
    };
    env.bot._cancelCommand = async () => false;
    env.bot._waitForTroopsAvailable = async () => { assert.fail('Não deve esperar após cancelamento incerto.'); };
    await env.bot._fireIfPending(env.snipe.id);
    assert.equal(sends, 1);
    assert.equal(env.snipe.status, 'uncertain');
    assert.equal(env.state.sniper_scheduled[0].status, 'uncertain');
    await env.bot._checkDue();
    assert.equal(sends, 1);
});

test('Sniper: cancelamento confirmado permite retry após reconciliação', async () => {
    const env = sniperEnvironment();
    let sends = 0;
    env.bot._fireOnce = async () => ({
        ok: true, command: {
            command_id: ++sends,
            arrival_at: env.context.Date.now() / 1000 + (sends === 1 ? 30 : 60),
            cancelable_until: env.context.Date.now() / 1000 + 20,
        },
    });
    env.bot._cancelCommand = async () => true;
    env.context.uw.ITowns.towns[1] = { units: () => ({ sword: 5 }) };
    await env.bot._fireIfPending(env.snipe.id);
    assert.equal(sends, 2);
    assert.equal(env.snipe.status, 'sent');
});

test('Sniper: tropas de reserva não liberam retry enquanto comando original existe', async () => {
    const env = sniperEnvironment();
    env.context.uw.ITowns.towns[1] = { units: () => ({ sword: 500 }) };
    env.context.uw.MM.getModels = () => ({ MovementsUnits: { 7: { attributes: { command_id: 7 } } } });
    env.bot.sleep = async () => env.setNow(env.context.Date.now() + 500);
    assert.equal(await env.bot._waitForTroopsAvailable(env.snipe, 1000, 7), false);
    env.context.uw.MM.getModels = () => ({});
    assert.equal(await env.bot._waitForTroopsAvailable(env.snipe, 1000, 7), false);
});

test('Sniper: persiste firing antes do POST e bloqueia disparo simultâneo', async () => {
    const env = sniperEnvironment();
    const wait = deferred();
    let sends = 0;
    env.bot._fireOnce = async () => {
        sends++;
        assert.equal(env.state.sniper_scheduled[0].status, 'firing');
        return wait.promise;
    };
    const first = env.bot._fireIfPending(env.snipe.id);
    await env.bot._fireIfPending(env.snipe.id);
    assert.equal(sends, 1);
    wait.resolve({ ok: true, command: null });
    await first;
    assert.equal(env.snipe.status, 'sent');
});

test('Sniper: falha ao persistir impede envio; timeout de envio fica incerto', async () => {
    const env = sniperEnvironment();
    env.storage.save = () => false;
    env.bot._fireOnce = async () => { assert.fail('Não pode enviar sem persistir.'); };
    await env.bot._fireIfPending(env.snipe.id);
    assert.equal(env.snipe.status, 'failed');
    const other = sniperEnvironment();
    other.bot._fireOnce = async () => { throw new Error('timeout'); };
    await other.bot._fireIfPending(other.snipe.id);
    assert.equal(other.snipe.status, 'uncertain');
});

test('Sniper: recarga de firing vira incerto, sem rearmar envio', () => {
    const env = sniperEnvironment([{ id: 'interrupted', status: 'firing', sendAt: 0 }]);
    assert.equal(env.bot._scheduled[0].status, 'uncertain');
    assert.equal(env.state.sniper_scheduled[0].status, 'uncertain');
    assert.equal(env.timeouts.size, 0);
    env.bot.clearDone();
    assert.equal(env.bot._scheduled.length, 1, 'Limpar concluídos não deve ocultar um resultado incerto.');
});

test('recursos: modo urgente ignora destino já reservado por trânsito', async () => {
    const env = resourcesEnvironment();
    env.bot.mode = 'balance';
    env.context.uw.ITowns.towns[4] = town(4, { wood: 6000, stone: 6000, iron: 6000 });
    env.bot.ajaxGetWithTimeout = async () => ({ movements: [
        { to: { id: 3 }, res: { wood: 3000, stone: 3000, iron: 3000 } },
    ] });
    const sent = [];
    env.bot.ajaxPostWithTimeout = async (_e, _a, data) => { sent.push(data); return {}; };
    env.bot._active = true;
    await env.bot._tick();
    assert.equal(sent.length, 2);
    assert.ok(sent.every(data => data.id === 4));
    for (const resource of ['wood', 'stone', 'iron']) {
        assert.equal(sent.reduce((sum, data) => sum + data[resource], 0), 3000);
    }
});

test('recursos: balanceamento não urgente também respeita as reservas', async () => {
    const env = resourcesEnvironment();
    env.bot.mode = 'balance';
    env.context.uw.ITowns.towns = {
        1: town(1, { wood: 8000, stone: 8000, iron: 8000 }, 6000),
        2: town(2, { wood: 8000, stone: 8000, iron: 8000 }, 6000),
        3: town(3, { wood: 1000, stone: 1000, iron: 1000 }),
    };
    env.bot.ajaxGetWithTimeout = async () => ({ movements: [
        { to: { id: 3 }, res: { wood: 6000, stone: 6000, iron: 6000 } },
    ] });
    const sent = [];
    env.bot.ajaxPostWithTimeout = async (_e, _a, data) => { sent.push(data); return {}; };
    env.bot._active = true;
    await env.bot._tick();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].wood, 2000);
    assert.equal(sent[0].stone, 2000);
    assert.equal(sent[0].iron, 2000);
});

test('recursos: rejeição explícita do servidor não reserva espaço inexistente', async () => {
    const env = resourcesEnvironment();
    let requests = 0;
    env.bot.ajaxPostWithTimeout = async () => ++requests === 1 ? { error: 'rejected' } : {};
    env.bot._active = true;
    await env.bot._tick();
    assert.equal(requests, 2);
    assert.equal(env.bot._active, true);
});

test('recursos: CAPTCHA durante consulta impede o primeiro envio', async () => {
    const env = resourcesEnvironment();
    env.bot.ajaxGetWithTimeout = async () => {
        env.context.uw.__multbot_captcha_active = true;
        return { movements: [] };
    };
    env.bot.ajaxPostWithTimeout = async () => assert.fail('Não pode enviar com CAPTCHA ativo.');
    env.bot._active = true;
    await env.bot._tick();
});

test('Sniper: falha real na requisição de cancelamento encerra tentativas', async () => {
    const env = sniperEnvironment();
    let sends = 0;
    env.bot._fireOnce = async () => {
        sends++;
        return { ok: true, command: { command_id: 7, arrival_at: env.context.Date.now() / 1000 + 30, cancelable_until: env.context.Date.now() / 1000 + 20 } };
    };
    env.context.uw.gpAjax = {
        ajaxPost(_endpoint, _action, _data, _flag, _success, fail) { fail(null, null, 'offline'); },
    };
    await env.bot._fireIfPending(env.snipe.id);
    assert.equal(sends, 1);
    assert.equal(env.snipe.status, 'uncertain');
    assert.equal(env.timeouts.size, 0);
});

test('Sniper: CAPTCHA após cancelar impede a próxima tentativa', async () => {
    const env = sniperEnvironment();
    let sends = 0;
    env.bot._fireOnce = async () => {
        sends++;
        return { ok: true, command: { command_id: 7, arrival_at: env.context.Date.now() / 1000 + 30, cancelable_until: env.context.Date.now() / 1000 + 20 } };
    };
    env.bot._cancelCommand = async () => {
        env.context.uw.__multbot_captcha_active = true;
        return true;
    };
    await env.bot._fireIfPending(env.snipe.id);
    assert.equal(sends, 1);
    assert.equal(env.snipe.error, 'sniper_retry_paused');
});

test('Sniper: remover resultado incerto exige confirmação e não cancela tropas', () => {
    const env = sniperEnvironment();
    env.snipe.status = 'uncertain';
    env.bot._cancelCommand = () => assert.fail('Remover aviso não cancela tropas.');
    env.context.uw.confirm = () => false;
    env.bot.dismissUncertain(env.snipe.id);
    assert.equal(env.bot._scheduled.length, 1);
    env.context.uw.confirm = () => true;
    env.bot.dismissUncertain(env.snipe.id);
    assert.equal(env.bot._scheduled.length, 0);
    assert.equal(env.state.sniper_scheduled.length, 0);
});

/* Ambiente "rico" para as telas novas (MultTools, BotConsole,
   MultStorage): jQuery seletor-aware, localStorage e os eventos de janela
   que o construtor do MultStorage observa. O ambiente padrão acima
   continua intocado para não alterar o comportamento dos testes antigos. */
function richEnvironment(moduleFile) {
    const env = environment(moduleFile);
    const core = fs.readFileSync(path.join(root, 'Modules/core.js'), 'utf8');
    vm.runInContext(
        core.slice(core.indexOf('var BotConsole = class'), core.indexOf('var Compressor = class')),
        env.context
    );
    vm.runInContext(
        core.slice(core.indexOf('var Compressor = class'), core.indexOf('if (typeof uw.__multbot_captcha_active')),
        env.context
    );

    const elements = new Map();
    const makeElement = (key) => ({
        key,
        length: 1,
        children: [],
        _value: '',
        _text: '',
        empty() { this.children.length = 0; return this; },
        append(child) { this.children.push(child); return this; },
        appendTo(target) { target.children.push(this); return this; },
        text(value) { if (value === undefined) return this._text; this._text = value; return this; },
        val(value) { if (value === undefined) return this._value; this._value = value; return this; },
        html(value) { if (value === undefined) return this._html ?? ''; this._html = value; return this; },
        css() { return this; },
        is() { return false; },
        on() { return this; },
        off() { return this; },
        trigger() { return this; },
    });
    const jq = (selector) => {
        if (typeof selector === 'string' && selector.trim().startsWith('<')) return makeElement(selector);
        const key = String(selector);
        if (!elements.has(key)) elements.set(key, makeElement(key));
        return elements.get(key);
    };
    jq.Observer = () => ({ subscribe() { return true; } });

    const localStorageData = {};
    const localStorage = {
        getItem: (key) => (key in localStorageData ? localStorageData[key] : null),
        setItem: (key, value) => { localStorageData[key] = String(value); },
        removeItem: (key) => { delete localStorageData[key]; },
    };

    env.context.uw.$ = jq;
    env.context.uw.Game.world_id = 'test_world';
    env.context.uw.GameEvents = { window: { open: {}, tab: { rendered: {} } } };
    env.context.localStorage = localStorage;
    return { ...env, jq, elements, localStorageData };
}

/* Objetos/arrays criados dentro do contexto do vm têm protótipos de outro
   realm; deepStrictEqual (assert/strict) falha nessa diferença. Este helper
   traz o valor para o realm do teste antes de comparar. */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function renameTown(id, x, y, name) {
    return { id, getName: () => name, getIslandX: () => x, getIslandY: () => y };
}

test('MultTools: sanitiza o prefixo e cai no padrão OC quando inválido', () => {
    const env = richEnvironment('mult_tools.js');
    const tools = new env.context.MultTools(env.context.console, env.storage);

    assert.equal(tools._sanitizePrefix('OC'), 'OC');
    assert.equal(tools._sanitizePrefix('  br7 '), 'br7');
    assert.equal(tools._sanitizePrefix('Mundo  A'), 'Mundo A');
    assert.equal(tools._sanitizePrefix('a-b_c'), 'a-b_c');
    assert.equal(tools._sanitizePrefix('abcdefghijklmnopqrst'), 'abcdefghijkl'); // corta em 12
    assert.equal(tools._sanitizePrefix('<script>'), null);
    assert.equal(tools._sanitizePrefix(''), null);
    assert.equal(tools._sanitizePrefix('   '), null);
    assert.equal(tools._sanitizePrefix(42), null);
    assert.equal(tools._sanitizePrefix(null), null);

    assert.equal(tools._renamePrefix, 'OC');

    env.state.mt_rename_prefix = '<script>';
    const fallback = new env.context.MultTools(env.context.console, env.storage);
    assert.equal(fallback._renamePrefix, 'OC');
});

test('MultTools: plano de renomeação agrupa por oceano e aplica o prefixo', () => {
    const env = richEnvironment('mult_tools.js');
    const tools = new env.context.MultTools(env.context.console, env.storage);
    env.context.uw.ITowns.towns = {
        10: renameTown(10, 568, 411, 'Porto'),   // oceano 54
        7: renameTown(7, 560, 393, 'Vila'),      // oceano 53
        12: renameTown(12, 562, 398, 'Forte'),   // oceano 53
    };

    const plan = tools._buildRenamePlan('OC');
    // Chaves inteiras de objeto iteram em ordem ascendente (7, 10, 12),
    // então o oceano 53 entra no plano antes do 54.
    assert.deepEqual(plain(plan.map(entry => entry.name)), ['OC53-01', 'OC53-02', 'OC54-01']);
    assert.deepEqual(plain(plan.map(entry => entry.town.id)), [7, 12, 10]);

    const custom = tools._buildRenamePlan('BR7');
    assert.deepEqual(plain(custom.map(entry => entry.name)), ['BR753-01', 'BR753-02', 'BR754-01']);

    assert.deepEqual(tools._buildRenamePlan('OC').length, 3);
});

test('BotConsole: filtro, contador e limpar', () => {
    const env = richEnvironment();
    const botConsole = new env.context.BotConsole(env.context.console, env.storage);
    botConsole.log('ataque detectado em Roma');
    botConsole.log('farm concluido em Atenas');

    botConsole.updateSettings();
    const $console = env.elements.get('#mult_console');
    assert.equal($console.children.length, 2);
    assert.equal(env.elements.get('#mult_console_count')._text, 'console_count');

    env.jq('#mult_console_filter')._value = 'farm';
    botConsole.filter = 'farm';
    botConsole.updateSettings();
    assert.equal($console.children.length, 1);
    assert.match($console.children[0]._text, /farm concluido/);

    env.jq('#mult_console_filter')._value = 'zzz';
    botConsole.filter = 'zzz';
    botConsole.updateSettings();
    assert.equal($console.children.length, 1); // aviso de "nenhuma linha"
    assert.equal($console.children[0]._text, 'console_no_match');

    botConsole.filter = '';
    botConsole.clear();
    assert.equal(botConsole.string.length, 0);
    assert.equal($console.children.length, 0);
});

test('MultStorage: importação de arquivo substitui o storage e rejeita lixo', () => {
    const env = richEnvironment();
    const storage = new env.context.MultStorage();

    assert.deepEqual(plain(storage.getStorage()), {});

    const ok = storage.importSettings(JSON.stringify({ mt_rename_prefix: 'BR', sleeper_start: '23:00' }));
    assert.deepEqual(plain(ok), { ok: true, count: 2 });
    assert.equal(storage.load('mt_rename_prefix'), 'BR');
    assert.equal(storage.load('sleeper_start'), '23:00');
    assert.equal(env.localStorageData.test_world_multBot, JSON.stringify({ mt_rename_prefix: 'BR', sleeper_start: '23:00' }));

    assert.equal(storage.importSettings('{nao é json').ok, false);
    assert.equal(storage.importSettings('[]').ok, false);
    assert.equal(storage.importSettings('null').ok, false);
    assert.equal(storage.importSettings('"texto"').ok, false);

    // Import válido subsequente substitui por completo (não faz merge).
    const second = storage.importSettings(JSON.stringify({ toasts_enabled: false }));
    assert.deepEqual(plain(second), { ok: true, count: 1 });
    assert.equal(storage.load('mt_rename_prefix'), null);
    assert.equal(storage.load('toasts_enabled'), false);
});

(async () => {
    for (const { name, fn } of tests) {
        await fn();
        console.log('OK:', name);
    }
    console.log(`OK: ${tests.length} testes de regressão passaram.`);
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
