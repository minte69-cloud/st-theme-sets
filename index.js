// Theme Sets — 캐릭터(또는 그룹)마다 "테마 + 켤 정규식" 세트를 지정해 두면
// 채팅이 바뀔 때 알아서 갈아 끼워 주는 SillyTavern 확장.

const MODULE = 'themeSets';
const LOG = '[Theme Sets]';

const defaults = () => ({
    enabled: true,
    sets: [],            // { id, name, theme, regex: [scriptId, ...] }
    defaultSetId: '',    // 지정 안 된 캐릭터에 쓸 세트 ('' = 아무것도 안 바꿈)
    charMap: {},         // 캐릭터 아바타 파일명 -> 세트 id
    groupMap: {},        // 그룹 id -> 세트 id
});

const ctx = () => SillyTavern.getContext();

function settings() {
    const ext = ctx().extensionSettings;
    if (!ext[MODULE]) ext[MODULE] = defaults();
    const s = ext[MODULE];
    for (const [k, v] of Object.entries(defaults())) {
        if (s[k] === undefined) s[k] = v;
    }
    return s;
}

const save = () => ctx().saveSettingsDebounced();
const uid = () => 'set_' + Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 지금 누구랑 얘기 중인지 ---------- */

function currentTarget() {
    const c = ctx();
    if (c.groupId) {
        const g = (c.groups || []).find((x) => String(x.id) === String(c.groupId));
        return { type: 'group', key: String(c.groupId), name: g?.name || '그룹' };
    }
    if (c.characterId !== undefined && c.characterId !== null && c.characters?.[c.characterId]) {
        const ch = c.characters[c.characterId];
        return { type: 'char', key: ch.avatar, name: ch.name };
    }
    return null;
}

function setFor(target) {
    const s = settings();
    let id = '';
    if (target?.type === 'group') id = s.groupMap[target.key] || '';
    if (target?.type === 'char') id = s.charMap[target.key] || '';
    if (!id) id = s.defaultSetId || '';
    return s.sets.find((x) => x.id === id) || null;
}

/* ---------- 테마 · 정규식 ---------- */

const themeNames = () => [...document.querySelectorAll('#themes option')].map((o) => o.value).filter(Boolean);
const globalRegex = () => (Array.isArray(ctx().extensionSettings.regex) ? ctx().extensionSettings.regex : []);

function applyTheme(name) {
    if (!name) return false;
    const select = document.querySelector('#themes');
    if (!select || !themeNames().includes(name)) {
        console.warn(LOG, '테마를 찾을 수 없음:', name);
        return false;
    }
    if (ctx().powerUserSettings?.theme === name && select.value === name) return false;
    select.value = name;
    $(select).trigger('change');
    return true;
}

// 어느 세트에든 들어 있는 정규식만 관리함. 세트에 안 넣은 정규식은 건드리지 않음.
function applyRegex(set) {
    const managed = new Set(settings().sets.flatMap((x) => x.regex || []));
    const on = new Set(set?.regex || []);
    let changed = false;
    for (const script of globalRegex()) {
        if (!managed.has(script.id)) continue;
        const disabled = !on.has(script.id);
        if (!!script.disabled !== disabled) {
            script.disabled = disabled;
            changed = true;
            // 정규식 설정 화면의 체크박스도 맞춰 둠
            const box = document.getElementById(script.id)?.querySelector('.disable_regex');
            if (box) box.checked = disabled;
        }
    }
    return changed;
}

let busy = false;

async function applyCurrent({ rerender = true } = {}) {
    const s = settings();
    if (!s.enabled || busy) return;
    const set = setFor(currentTarget());
    if (!set) return;

    const select = document.querySelector('#themes');
    const willTheme = !!set.theme && themeNames().includes(set.theme)
        && (ctx().powerUserSettings?.theme !== set.theme || select?.value !== set.theme);
    const managed = new Set(s.sets.flatMap((x) => x.regex || []));
    const on = new Set(set.regex || []);
    const willRegex = globalRegex().some((r) => managed.has(r.id) && !!r.disabled !== !on.has(r.id));
    if (!willTheme && !willRegex) return;

    busy = true;
    document.body.classList.add('tsets-switching');
    try {
        await new Promise((r) => setTimeout(r, 150));
        applyTheme(set.theme);
        const regexChanged = applyRegex(set);
        if (regexChanged) {
            save();
            // 이미 그려진 메시지에 새 정규식이 먹도록 채팅을 다시 그림
            if (rerender && ctx().getCurrentChatId?.()) await ctx().reloadCurrentChat();
        }
        console.debug(LOG, '적용:', set.name);
    } catch (e) {
        console.error(LOG, e);
    } finally {
        busy = false;
        requestAnimationFrame(() => document.body.classList.remove('tsets-switching'));
    }
}

/* ---------- 설정 화면 ---------- */

function setOptions(selected, emptyLabel) {
    return `<option value="">${esc(emptyLabel)}</option>` + settings().sets
        .map((x) => `<option value="${esc(x.id)}" ${x.id === selected ? 'selected' : ''}>${esc(x.name || '(이름 없음)')}</option>`).join('');
}

function usedBy(setId) {
    const s = settings();
    const c = ctx();
    const names = [];
    for (const [avatar, id] of Object.entries(s.charMap)) {
        if (id === setId) names.push((c.characters || []).find((x) => x.avatar === avatar)?.name || avatar);
    }
    for (const [gid, id] of Object.entries(s.groupMap)) {
        if (id === setId) names.push(((c.groups || []).find((x) => String(x.id) === gid)?.name || gid) + ' (그룹)');
    }
    return names;
}

function render() {
    const root = document.getElementById('tsets_body');
    if (!root) return;
    const s = settings();
    const target = currentTarget();
    const themes = themeNames();
    const scripts = globalRegex();

    const mapped = target ? (target.type === 'group' ? s.groupMap[target.key] : s.charMap[target.key]) || '' : '';
    const nowHtml = target
        ? `<div class="tsets-now">
             <div>지금 ${target.type === 'group' ? '그룹' : '캐릭터'}: <span class="tsets-now-name">${esc(target.name)}</span></div>
             <div class="tsets-row"><label>쓸 세트</label><select id="tsets_now_set">${setOptions(mapped, '지정 안 함 (기본 세트)')}</select></div>
           </div>`
        : '<div class="tsets-now tsets-hint">채팅을 열면 여기서 그 캐릭터에 쓸 세트를 고를 수 있어.</div>';

    const setsHtml = s.sets.map((set) => {
        const users = usedBy(set.id);
        const themeOpts = '<option value="">테마 안 바꿈</option>' + themes
            .map((t) => `<option value="${esc(t)}" ${t === set.theme ? 'selected' : ''}>${esc(t)}</option>`).join('')
            + (set.theme && !themes.includes(set.theme) ? `<option value="${esc(set.theme)}" selected>(없어진 테마) ${esc(set.theme)}</option>` : '');
        const regexList = scripts.length
            ? scripts.map((r) => `<label><input type="checkbox" class="tsets-regex" data-id="${esc(r.id)}" ${(set.regex || []).includes(r.id) ? 'checked' : ''}><span>${esc(r.scriptName)}</span></label>`).join('')
            : '<div class="tsets-hint">전역 정규식이 아직 없어.</div>';
        return `<div class="tsets-set" data-id="${esc(set.id)}">
            <div class="tsets-set-head">
              <input type="text" class="text_pole tsets-name" value="${esc(set.name)}" placeholder="세트 이름">
              <div class="menu_button fa-solid fa-trash-can tsets-del" title="세트 삭제"></div>
            </div>
            <div class="tsets-row"><label>테마</label><select class="tsets-theme">${themeOpts}</select></div>
            <div>이 세트에서 켤 정규식</div>
            <div class="tsets-regex-list">${regexList}</div>
            <div class="tsets-used">${users.length ? '사용 중: ' + esc(users.join(', ')) : '아직 지정된 캐릭터 없음'}${set.id === s.defaultSetId ? ' · 기본 세트' : ''}</div>
          </div>`;
    }).join('');

    root.innerHTML = `
        <label class="checkbox_label"><input type="checkbox" id="tsets_enabled" ${s.enabled ? 'checked' : ''}><span>캐릭터에 맞춰 자동으로 바꾸기</span></label>
        ${nowHtml}
        <div class="tsets-row"><label>기본 세트</label><select id="tsets_default">${setOptions(s.defaultSetId, '없음 (그대로 두기)')}</select></div>
        <div class="tsets-hint">세트를 지정 안 한 캐릭터나 첫 화면에서 쓰는 세트야.</div>
        <hr>
        <div class="tsets-row"><b>세트 목록</b><div class="menu_button menu_button_icon" id="tsets_add"><i class="fa-solid fa-plus"></i><span>세트 추가</span></div></div>
        <div class="tsets-hint">어느 세트에든 체크된 정규식만 이 확장이 켜고 꺼. 어디에도 체크 안 한 정규식은 건드리지 않아.</div>
        ${setsHtml || '<div class="tsets-hint">세트가 아직 없어. "세트 추가"를 눌러줘.</div>'}`;
}

function bind() {
    const root = document.getElementById('tsets_body');
    if (!root) return;

    root.addEventListener('change', (e) => {
        const s = settings();
        const el = e.target;
        const box = el.closest('.tsets-set');
        const set = box ? s.sets.find((x) => x.id === box.dataset.id) : null;

        if (el.id === 'tsets_enabled') {
            s.enabled = el.checked;
        } else if (el.id === 'tsets_default') {
            s.defaultSetId = el.value;
        } else if (el.id === 'tsets_now_set') {
            const t = currentTarget();
            if (t) {
                const map = t.type === 'group' ? s.groupMap : s.charMap;
                if (el.value) map[t.key] = el.value; else delete map[t.key];
            }
        } else if (set && el.classList.contains('tsets-theme')) {
            set.theme = el.value;
        } else if (set && el.classList.contains('tsets-regex')) {
            const list = new Set(set.regex || []);
            if (el.checked) list.add(el.dataset.id); else list.delete(el.dataset.id);
            set.regex = [...list];
        } else if (set && el.classList.contains('tsets-name')) {
            set.name = el.value.trim();
        } else {
            return;
        }
        save();
        render();
        applyCurrent();
    });

    root.addEventListener('click', (e) => {
        const s = settings();
        if (e.target.closest('#tsets_add')) {
            s.sets.push({ id: uid(), name: `세트 ${s.sets.length + 1}`, theme: ctx().powerUserSettings?.theme || '', regex: [] });
        } else if (e.target.closest('.tsets-del')) {
            const id = e.target.closest('.tsets-set')?.dataset.id;
            const set = s.sets.find((x) => x.id === id);
            if (!set) return;
            // 지우기 전에 한 번 더 누르게 함 (브라우저 확인 창은 쓰지 않음)
            const btn = e.target.closest('.tsets-del');
            if (!btn.dataset.armed) {
                btn.dataset.armed = '1';
                btn.classList.add('redWarningBG');
                btn.title = '한 번 더 누르면 삭제';
                setTimeout(() => { delete btn.dataset.armed; btn.classList.remove('redWarningBG'); btn.title = '세트 삭제'; }, 3000);
                return;
            }
            s.sets = s.sets.filter((x) => x.id !== id);
            if (s.defaultSetId === id) s.defaultSetId = '';
            for (const map of [s.charMap, s.groupMap]) {
                for (const k of Object.keys(map)) if (map[k] === id) delete map[k];
            }
        } else {
            return;
        }
        save();
        render();
    });
}

function mountSettings() {
    if (document.getElementById('tsets_settings')) return;
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.id = 'tsets_settings';
    wrap.innerHTML = `
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>Theme Sets · 캐릭터별 테마·상태창</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div class="inline-drawer-content" id="tsets_body"></div>
        </div>`;
    host.appendChild(wrap);
    bind();
    render();
}

/* ---------- 시작 ---------- */

jQuery(async () => {
    const c = ctx();
    settings();
    mountSettings();

    const onChat = async () => { await applyCurrent(); render(); };
    c.eventSource.on(c.eventTypes.CHAT_CHANGED, onChat);
    c.eventSource.on(c.eventTypes.APP_READY, onChat);

    // 캐릭터 이름을 바꾸면 아바타 파일명도 바뀌므로 지정해 둔 세트를 옮겨 줌
    c.eventSource.on(c.eventTypes.CHARACTER_RENAMED, (oldAvatar, newAvatar) => {
        const s = settings();
        if (s.charMap[oldAvatar]) {
            s.charMap[newAvatar] = s.charMap[oldAvatar];
            delete s.charMap[oldAvatar];
            save();
        }
    });

    // 설정 서랍을 열 때마다 테마·정규식 목록을 새로 읽음
    document.getElementById('tsets_settings')?.querySelector('.inline-drawer-toggle')
        ?.addEventListener('click', () => setTimeout(render, 0));
});
