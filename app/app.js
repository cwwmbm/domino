'use strict'
/*
 * Domino: a local project tracker.
 * The project is one document (db). The server keeps it in data/domino.json.
 * "Blocked" and "ready" are not statuses. The tool calculates them from the dependencies.
 */

// ---------------------------------------------------------------- constants

const STATUSES = [
	{ id: 'backlog', label: 'Backlog' },
	{ id: 'todo', label: 'To do' },
	{ id: 'doing', label: 'In progress' },
	{ id: 'review', label: 'In review' },
	{ id: 'done', label: 'Done' },
	{ id: 'cancelled', label: 'Cancelled' },
]
const ST = Object.fromEntries(STATUSES.map((s, i) => [s.id, Object.assign({ order: i }, s)]))
const BOARD = ['backlog', 'todo', 'doing', 'review', 'done']
const PRIOS = [
	{ id: 'urgent', label: 'Urgent', w: 8 },
	{ id: 'high', label: 'High', w: 5 },
	{ id: 'med', label: 'Medium', w: 2 },
	{ id: 'low', label: 'Low', w: 0 },
]
const PR = Object.fromEntries(PRIOS.map(p => [p.id, p]))
const VIEW_IDS = ['now', 'board', 'list', 'timeline', 'map']
const IS_WORDS = ['ready', 'blocked', 'overdue', 'open', 'done', 'cancelled']
const DUE_WORDS = ['overdue', 'today', 'week', 'none']
const DAY = 86400000
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_LONG = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MON_LONG = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

const I = {
	lock: '<svg viewBox="0 0 16 16" class="ic"><path d="M5 7V5.2a3 3 0 0 1 6 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="3.2" y="7" width="9.6" height="6.8" rx="1.8" fill="currentColor"/></svg>',
	check: '<svg viewBox="0 0 16 16" class="ic"><path d="M3.2 8.6l3 3L12.8 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	x: '<svg viewBox="0 0 16 16" class="ic"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
	plus: '<svg viewBox="0 0 16 16" class="ic"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
	chev: '<svg viewBox="0 0 16 16" class="ic"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	clip: '<svg viewBox="0 0 16 16" class="ic"><path d="M10.8 4.6L5.6 9.8a1.6 1.6 0 0 0 2.3 2.3l5-5a2.9 2.9 0 0 0-4.1-4.1l-5 5a4.2 4.2 0 0 0 5.9 5.9l4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
	link: '<svg viewBox="0 0 16 16" class="ic"><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.8.8M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.8-.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
	trash: '<svg viewBox="0 0 16 16" class="ic"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	domino: '<svg viewBox="0 0 16 16" class="ic"><rect x="2.2" y="3" width="4" height="10.5" rx="1.2" fill="currentColor"/><rect x="8.2" y="3" width="4" height="10.5" rx="1.2" fill="currentColor" transform="rotate(20 10.2 13.5)"/></svg>',
	file: '<svg viewBox="0 0 16 16" class="ic"><path d="M4 2h5l3 3v9H4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 2v3h3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
}

// ---------------------------------------------------------------- small helpers

function $(sel, root) {
	return (root || document).querySelector(sel)
}

function $$(sel, root) {
	return Array.from((root || document).querySelectorAll(sel))
}

function esc(value) {
	return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function pushTo(map, key, value) {
	const list = map.get(key)
	if (list) list.push(value)
	else map.set(key, [value])
}

function norm(value) {
	return String(value || '').toLowerCase().replace(/[\s_]+/g, '')
}

function hue(text) {
	let h = 0
	for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360
	return h
}

function pad(n) {
	return String(n).padStart(2, '0')
}

function iso(date) {
	return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

function parseISO(text) {
	const p = text.split('-').map(Number)
	return new Date(p[0], p[1] - 1, p[2])
}

function today() {
	return iso(new Date())
}

function addDays(text, n) {
	const date = parseISO(text)
	date.setDate(date.getDate() + n)
	return iso(date)
}

function diffDays(from, to) {
	return Math.round((parseISO(to) - parseISO(from)) / DAY)
}

function fmtDate(text) {
	const d = parseISO(text)
	const year = d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''
	return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] + year
}

function fmtShort(text) {
	const n = diffDays(today(), text)
	return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : fmtDate(text)
}

function fmtWhen(ms) {
	const d = new Date(ms)
	return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function fmtSize(bytes) {
	return bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

function validDate(y, m, d) {
	const date = new Date(y, m - 1, d)
	return date.getMonth() === m - 1 && date.getDate() === d ? iso(date) : null
}

function nearDate(m, d) {
	const year = new Date().getFullYear()
	const date = validDate(year, m, d)
	if (!date) return null
	return diffDays(date, today()) > 180 ? validDate(year + 1, m, d) : date
}

/** Understands: today, tomorrow, fri, +3d, 2w, 2026-11-20, 11-20, 11/20, 20nov, nov20. */
function parseDateWord(word) {
	const w = word.toLowerCase()
	const t = today()
	if (w === 'today' || w === 'tod') return t
	if (w === 'tomorrow' || w === 'tmr' || w === 'tom') return addDays(t, 1)
	if (w === 'yesterday') return addDays(t, -1)
	const dow = w.length >= 3 ? DOW_LONG.findIndex(d => d.startsWith(w)) : -1
	if (dow >= 0) return addDays(t, (dow - new Date().getDay() + 7) % 7)
	let m = /^\+?(\d{1,3})([dwm])$/.exec(w)
	if (m) return addDays(t, +m[1] * { d: 1, w: 7, m: 30 }[m[2]])
	m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(w)
	if (m) return validDate(+m[1], +m[2], +m[3])
	m = /^(\d{1,2})[-/](\d{1,2})$/.exec(w)
	if (m) return nearDate(+m[1], +m[2])
	m = /^(\d{1,2})([a-z]{3,9})$/.exec(w)
	if (m && monthIndex(m[2]) >= 0) return nearDate(monthIndex(m[2]) + 1, +m[1])
	m = /^([a-z]{3,9})(\d{1,2})$/.exec(w)
	if (m && monthIndex(m[1]) >= 0) return nearDate(monthIndex(m[1]) + 1, +m[2])
	return null
}

function monthIndex(word) {
	return MON_LONG.findIndex(name => name.startsWith(word))
}

function prioAlias(word) {
	const w = word.toLowerCase()
	const map = { urgent: 'urgent', u: 'urgent', '!': 'urgent', high: 'high', h: 'high', med: 'med', medium: 'med', m: 'med', low: 'low', l: 'low' }
	return map[w] || null
}

function statusAlias(word) {
	const w = word.toLowerCase().replace(/[-_]/g, '')
	const map = {
		backlog: 'backlog', later: 'backlog',
		todo: 'todo', next: 'todo',
		doing: 'doing', inprogress: 'doing', progress: 'doing', wip: 'doing', started: 'doing',
		review: 'review', inreview: 'review',
		done: 'done', closed: 'done', complete: 'done',
		cancelled: 'cancelled', canceled: 'cancelled', dropped: 'cancelled',
	}
	return map[w] || null
}

// ---------------------------------------------------------------- state

let db = { version: 1, nextId: 1, tasks: [] }
let rev = 0
let IX = null
let undoStack = []

const ui = loadUi()
// The list row that has an open line for a new subtask. Not stored.
ui.addIn = null
ui.addText = ''

function loadUi() {
	let stored = {}
	try {
		stored = JSON.parse(localStorage.getItem('domino.ui') || '{}')
	} catch (error) {
		stored = {}
	}
	const base = { view: 'now', query: '', zoom: 'week', group: 'domain', sort: 'created', mapAll: false, collapsed: [] }
	const merged = Object.assign(base, stored)
	if (!VIEW_IDS.includes(merged.view)) merged.view = 'now'
	merged.collapsed = new Set(merged.collapsed)
	merged.openId = null
	merged.flash = new Set()
	merged.tlInit = false
	return merged
}

function saveUi() {
	try {
		localStorage.setItem('domino.ui', JSON.stringify({
			view: ui.view, query: ui.query, zoom: ui.zoom, group: ui.group, sort: ui.sort, mapAll: ui.mapAll, collapsed: Array.from(ui.collapsed),
		}))
	} catch (error) {
		// The view settings are a convenience only.
	}
}

function normalize(data) {
	const d = data && typeof data === 'object' ? data : {}
	d.version = 1
	d.tasks = Array.isArray(d.tasks) ? d.tasks : []
	for (const t of d.tasks) {
		t.title = t.title || ''
		t.desc = t.desc || ''
		if (!ST[t.status]) t.status = 'todo'
		if (!PR[t.priority]) t.priority = 'med'
		t.assignee = t.assignee || ''
		t.domain = t.domain || ''
		t.start = t.start || null
		t.due = t.due || null
		t.parent = t.parent == null ? null : t.parent
		t.deps = t.deps || []
		t.related = t.related || []
		t.links = t.links || []
		t.files = t.files || []
		t.log = t.log || []
		t.created = t.created || Date.now()
		t.updated = t.updated || t.created
		t.doneAt = t.doneAt || null
	}
	d.nextId = Math.max(d.nextId || 1, 1, ...d.tasks.map(t => t.id + 1))
	return d
}

/** Everything the views must know about the links between the tasks. */
function buildIndex() {
	const byId = new Map(db.tasks.map(t => [t.id, t]))
	const kids = new Map()
	const dependents = new Map()
	for (const t of db.tasks) {
		if (t.parent != null && byId.has(t.parent)) pushTo(kids, t.parent, t)
		for (const d of t.deps) if (byId.has(d)) pushTo(dependents, d, t.id)
	}
	const unlockMemo = new Map()

	function get(id) {
		return byId.get(id)
	}
	function open(t) {
		return t.status !== 'done' && t.status !== 'cancelled'
	}
	function blockers(t) {
		return t.deps.map(get).filter(d => d && open(d))
	}
	function blocked(t) {
		return open(t) && blockers(t).length > 0
	}
	function openKids(t) {
		return (kids.get(t.id) || []).filter(open)
	}
	function ready(t) {
		return open(t) && (t.status === 'todo' || t.status === 'backlog') && !blocked(t) && openKids(t).length === 0
	}
	function overdue(t) {
		return open(t) && !!t.due && t.due < today()
	}
	/** The number of open tasks that wait for this task, directly or through other tasks. */
	function unlocks(t) {
		if (unlockMemo.has(t.id)) return unlockMemo.get(t.id)
		const seen = new Set()
		const stack = (dependents.get(t.id) || []).slice()
		while (stack.length) {
			const id = stack.pop()
			if (seen.has(id)) continue
			seen.add(id)
			stack.push(...(dependents.get(id) || []))
		}
		const n = Array.from(seen).filter(id => open(get(id))).length
		unlockMemo.set(t.id, n)
		return n
	}
	function progress(t) {
		const list = (kids.get(t.id) || []).filter(k => k.status !== 'cancelled')
		return { done: list.filter(k => k.status === 'done').length, total: list.length }
	}
	return { byId, kids, dependents, get, open, blockers, blocked, ready, overdue, unlocks, progress }
}

function names(key) {
	return Array.from(new Set(db.tasks.map(t => t[key]).filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

function isUnder(task, ancestorId) {
	let cur = task
	let guard = 0
	while (cur && guard++ < 200) {
		if (cur.id === ancestorId) return true
		cur = cur.parent != null ? IX.get(cur.parent) : null
	}
	return false
}

/** True if "a waits for b" makes a loop. */
function wouldCycle(a, b) {
	if (a === b) return true
	const seen = new Set()
	const stack = [b]
	while (stack.length) {
		const id = stack.pop()
		if (id === a) return true
		if (seen.has(id)) continue
		seen.add(id)
		const t = IX.get(id)
		if (t) stack.push(...t.deps)
	}
	return false
}

function relatedOf(t) {
	const ids = new Set(t.related)
	for (const x of db.tasks) if (x.related.includes(t.id)) ids.add(x.id)
	return Array.from(ids).map(IX.get).filter(Boolean)
}

/** How much a task helps the project if you do it now. */
function score(t) {
	let s = IX.unlocks(t) * 10 + PR[t.priority].w + (t.status === 'todo' ? 3 : 0)
	if (t.due) {
		const d = diffDays(today(), t.due)
		s += d < 0 ? 7 : d <= 2 ? 5 : d <= 7 ? 2 : 0
	}
	return s
}

// ---------------------------------------------------------------- persistence

let saveTimer = null
let saving = false
let dirty = false
let conflict = false

function setSave(state) {
	const el = $('#save')
	el.className = 'save ' + state
	el.textContent = { ok: 'Saved', busy: 'Saving', err: 'Not saved. Start the server again.', conflict: 'Changed in another window' }[state]
}

async function load() {
	const res = await fetch('/api/state')
	const doc = await res.json()
	rev = doc.rev
	db = normalize(doc.data)
}

function scheduleSave() {
	dirty = true
	setSave('busy')
	clearTimeout(saveTimer)
	saveTimer = setTimeout(save, 250)
}

async function save() {
	if (saving || conflict) return
	saving = true
	dirty = false
	let failed = false
	try {
		const res = await fetch('/api/state', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ rev, data: db }),
		})
		if (res.status === 409) {
			conflict = true
			setSave('conflict')
			toast('This project changed in another window. Your last change is not saved.', { action: 'Load the new data', fn: reload, ms: 3600000 })
		} else if (!res.ok) {
			failed = true
		} else {
			rev = (await res.json()).rev
			if (!dirty) setSave('ok')
		}
	} catch (error) {
		failed = true
	}
	saving = false
	if (failed) {
		dirty = true
		setSave('err')
		clearTimeout(saveTimer)
		saveTimer = setTimeout(save, 3000)
	} else if (dirty && !conflict) {
		scheduleSave()
	}
}

async function reload() {
	conflict = false
	dirty = false
	await load()
	undoStack = []
	setSave('ok')
	render()
}

/** Keeps two windows of the tool in sync. */
async function poll() {
	if (document.hidden || dirty || saving || conflict) return
	const active = document.activeElement
	if (active && active.closest && active.closest('#drawer, .ladd') && /^(INPUT|TEXTAREA)$/.test(active.tagName)) return
	try {
		const doc = await (await fetch('/api/rev')).json()
		if (doc.rev !== rev && !dirty && !saving) {
			await load()
			render()
		}
		if ($('#save').classList.contains('err')) setSave('ok')
	} catch (error) {
		setSave('err')
	}
}

function pushUndo() {
	undoStack.push(JSON.stringify(db))
	if (undoStack.length > 50) undoStack.shift()
}

function undo() {
	if (!undoStack.length) {
		toast('There is nothing to undo.')
		return
	}
	db = normalize(JSON.parse(undoStack.pop()))
	commit()
}

function commit(opts) {
	scheduleSave()
	render(opts)
}

function mutate(change, opts) {
	pushUndo()
	change()
	commit(opts)
}

function touch(t, what) {
	t.updated = Date.now()
	if (what) {
		t.log.push({ at: Date.now(), what })
		if (t.log.length > 60) t.log.shift()
	}
}

function flash(ids) {
	ui.flash = new Set(ids)
	clearTimeout(flash.timer)
	flash.timer = setTimeout(() => {
		ui.flash = new Set()
	}, 1800)
}

// ---------------------------------------------------------------- task changes

function newTask(props) {
	const now = Date.now()
	const t = Object.assign({
		id: db.nextId++, title: '', desc: '', status: 'todo', priority: 'med', assignee: '', domain: '',
		start: null, due: null, parent: null, deps: [], related: [], links: [], files: [],
		created: now, updated: now, doneAt: null, log: [{ at: now, what: 'Created' }],
	}, props)
	db.tasks.push(t)
	return t
}

function setStatus(id, status) {
	const t = IX.get(id)
	if (!t || t.status === status) return
	const wasBlocked = db.tasks.filter(IX.blocked).map(x => x.id)
	pushUndo()
	touch(t, 'Status: ' + ST[t.status].label + ' → ' + ST[status].label)
	t.status = status
	t.doneAt = status === 'done' ? Date.now() : null
	IX = buildIndex()
	const freed = wasBlocked.map(IX.get).filter(x => x && IX.open(x) && !IX.blocked(x))
	flash(freed.map(x => x.id))
	commit()
	if (freed.length) {
		const refs = freed.map(x => `<a data-act="open" data-id="${x.id}">#${x.id} ${esc(x.title)}</a>`).join(', ')
		toast(`${I.domino} <b>#${t.id}</b> is ${ST[status].label.toLowerCase()}. Free to start now: ${refs}`, { ms: 9000 })
	}
	if (status === 'done' && t.parent != null) {
		const p = IX.get(t.parent)
		const kids = p ? IX.kids.get(p.id) || [] : []
		if (p && IX.open(p) && !kids.some(IX.open)) {
			toast(`All subtasks of <b>#${p.id}</b> ${esc(p.title)} are done.`, { action: 'Mark #' + p.id + ' done', fn: () => setStatus(p.id, 'done'), ms: 9000 })
		}
	}
}

function addDep(taskId, depId) {
	const t = IX.get(taskId)
	const d = IX.get(depId)
	if (!t || !d || taskId === depId) return
	if (t.deps.includes(depId)) {
		toast(`#${taskId} already waits for #${depId}.`)
		return
	}
	if (wouldCycle(taskId, depId)) {
		toast(`Not possible: #${depId} already waits for #${taskId}. This would make a loop.`)
		return
	}
	mutate(() => {
		t.deps.push(depId)
		touch(t, 'Waits for #' + depId)
	})
}

function removeDep(taskId, depId) {
	const t = IX.get(taskId)
	if (!t) return
	mutate(() => {
		t.deps = t.deps.filter(d => d !== depId)
		touch(t, 'Does not wait for #' + depId)
	})
}

function deleteTask(id) {
	const root = IX.get(id)
	if (!root) return
	const ids = new Set()
	function walk(t) {
		ids.add(t.id)
		for (const k of IX.kids.get(t.id) || []) walk(k)
	}
	walk(root)
	mutate(() => {
		db.tasks = db.tasks.filter(t => !ids.has(t.id))
		for (const t of db.tasks) {
			t.deps = t.deps.filter(d => !ids.has(d))
			t.related = t.related.filter(d => !ids.has(d))
		}
		if (ids.has(ui.openId)) ui.openId = null
	})
	const extra = ids.size > 1 ? ' and ' + (ids.size - 1) + ' subtask' + (ids.size > 2 ? 's' : '') : ''
	toast(`Deleted #${id}${extra}.`, { action: 'Undo', fn: undo, ms: 9000 })
}

async function upload(taskId, files) {
	const added = []
	for (const f of files) {
		let name = f.name || 'file'
		if (name === 'image.png') {
			const d = new Date()
			name = 'screenshot-' + iso(d) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.png'
		}
		try {
			const res = await fetch('/api/files?name=' + encodeURIComponent(name), {
				method: 'POST',
				headers: { 'Content-Type': f.type || 'application/octet-stream' },
				body: f,
			})
			if (!res.ok) throw new Error('upload failed')
			added.push(await res.json())
		} catch (error) {
			toast('The file ' + esc(name) + ' was not saved.')
		}
	}
	const t = IX.get(taskId)
	if (!t || !added.length) return
	mutate(() => {
		t.files.push(...added)
		touch(t, 'Attached ' + added.map(a => a.name).join(', '))
	})
}

function addLink(taskId, raw) {
	const t = IX.get(taskId)
	const text = raw.trim()
	if (!t || !text) return false
	const cut = text.search(/\s/)
	let url = cut < 0 ? text : text.slice(0, cut)
	const label = cut < 0 ? '' : text.slice(cut).trim()
	if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url
	if (/^(javascript|data|vbscript):/i.test(url)) {
		toast('This type of link is not permitted.')
		return false
	}
	mutate(() => {
		t.links.push({ url, label })
		touch(t, 'Added a link')
	})
	return true
}

// ---------------------------------------------------------------- one-line language

/**
 * The capture bar and the filter use the same tokens:
 * @person  #domain  !priority  due:date  start:date  status:x  after:id  in:id  is:state (filter only)
 */
function parse(text, mode) {
	const out = { words: [], assignee: [], domain: [], priority: [], status: [], is: [], in: [], after: [], due: null, start: null }
	for (const tok of text.trim().split(/\s+/).filter(Boolean)) {
		const first = tok[0]
		const rest = tok.slice(1)
		const kv = /^(due|start|status|is|in|after):(.+)$/i.exec(tok)
		if (first === '@' && rest) {
			out.assignee.push(rest)
		} else if (first === '#' && rest && !/^\d+$/.test(rest)) {
			out.domain.push(rest)
		} else if (first === '!' && prioAlias(rest)) {
			out.priority.push(prioAlias(rest))
		} else if (kv) {
			const key = kv[1].toLowerCase()
			const val = kv[2].toLowerCase()
			if (key === 'status' && statusAlias(val)) {
				out.status.push(statusAlias(val))
			} else if (key === 'is' && mode === 'filter' && IS_WORDS.includes(val)) {
				out.is.push(val)
			} else if ((key === 'in' || key === 'after') && IX.get(+val.replace('#', ''))) {
				out[key].push(+val.replace('#', ''))
			} else if (key === 'due' && mode === 'filter' && DUE_WORDS.includes(val)) {
				out.due = val
			} else if ((key === 'due' || key === 'start') && parseDateWord(val)) {
				out[key] = parseDateWord(val)
			} else {
				out.words.push(tok)
			}
		} else {
			out.words.push(tok)
		}
	}
	return out
}

function matches(t, f) {
	if (t.status === 'cancelled' && !f.status.includes('cancelled') && !f.is.includes('cancelled')) return false
	if (f.assignee.length && !f.assignee.some(a => (norm(a) === 'none' ? !t.assignee : norm(t.assignee).includes(norm(a))))) return false
	if (f.domain.length && !f.domain.some(d => (norm(d) === 'none' ? !t.domain : norm(t.domain).includes(norm(d))))) return false
	if (f.priority.length && !f.priority.includes(t.priority)) return false
	if (f.status.length && !f.status.includes(t.status)) return false
	for (const word of f.is) {
		if (word === 'ready' && !IX.ready(t)) return false
		if (word === 'blocked' && !IX.blocked(t)) return false
		if (word === 'overdue' && !IX.overdue(t)) return false
		if (word === 'open' && !IX.open(t)) return false
		if (word === 'done' && t.status !== 'done') return false
		if (word === 'cancelled' && t.status !== 'cancelled') return false
	}
	if (f.in.length && !f.in.some(p => isUnder(t, p))) return false
	if (f.after.length && !f.after.some(d => t.deps.includes(d))) return false
	if (f.due === 'overdue' && !IX.overdue(t)) return false
	if (f.due === 'none' && t.due) return false
	if (f.due === 'today' && t.due !== today()) return false
	if (f.due === 'week' && !(t.due && t.due <= addDays(today(), 7) && IX.open(t))) return false
	if (f.due && !DUE_WORDS.includes(f.due) && !(t.due && t.due <= f.due)) return false
	if (f.start && !(t.start && t.start <= f.start)) return false
	if (f.words.length) {
		const hay = ('#' + t.id + ' ' + t.title + ' ' + t.desc + ' ' + t.assignee + ' ' + t.domain).toLowerCase()
		if (!f.words.every(w => hay.includes(w.toLowerCase()))) return false
	}
	return true
}

function filtered() {
	const f = parse(ui.query, 'filter')
	return db.tasks.filter(t => matches(t, f))
}

function hasTok(tok) {
	return ui.query.toLowerCase().split(/\s+/).includes(tok.toLowerCase())
}

function setTok(tok, on) {
	const parts = ui.query.split(/\s+/).filter(Boolean).filter(p => p.toLowerCase() !== tok.toLowerCase())
	if (on) parts.push(tok)
	ui.query = parts.join(' ')
	$('#flt').value = ui.query
	saveUi()
}

function tokName(prefix, name) {
	return prefix + name.trim().replace(/\s+/g, '_')
}

/** Uses a known name if the text matches one. If not, makes a new name. */
function resolveName(raw, known) {
	const n = norm(raw)
	const exact = known.find(k => norm(k) === n)
	if (exact) return exact
	const starts = known.filter(k => norm(k).startsWith(n))
	if (starts.length === 1) return starts[0]
	const text = raw.replace(/_/g, ' ')
	return text === text.toLowerCase() ? text.replace(/^./, c => c.toUpperCase()) : text
}

function draft(text) {
	const p = parse(text, 'new')
	const last = list => list[list.length - 1]
	const parent = p.in.length ? last(p.in) : null
	return {
		title: p.words.join(' ').trim(),
		assignee: p.assignee.length ? resolveName(last(p.assignee), names('assignee')) : '',
		domain: p.domain.length ? resolveName(last(p.domain), names('domain')) : parent != null ? IX.get(parent).domain : '',
		priority: p.priority.length ? last(p.priority) : 'med',
		status: p.status.length ? last(p.status) : 'todo',
		due: p.due,
		start: p.start,
		parent,
		deps: Array.from(new Set(p.after)),
	}
}

function renderPreview() {
	const el = $('#cap-prev')
	const text = $('#cap').value
	if (!text.trim()) {
		el.innerHTML = '<span class="hint">Put the details in the same line: <code>@person</code> <code>#domain</code> <code>!high</code> <code>due:fri</code> <code>after:12</code> waits for task 12 <code>in:12</code> subtask of task 12</span>'
		return
	}
	const d = draft(text)
	const parts = []
	if (d.assignee) parts.push(avatar(d.assignee, 'xs') + esc(d.assignee))
	if (d.domain) parts.push(`<span class="chip dom">${esc(d.domain)}</span>`)
	if (d.priority !== 'med') parts.push(`<span class="chip p-${d.priority}">${PR[d.priority].label}</span>`)
	if (d.status !== 'todo') parts.push(esc(ST[d.status].label))
	if (d.start) parts.push('starts ' + esc(fmtShort(d.start)))
	if (d.due) parts.push('due ' + esc(fmtShort(d.due)))
	if (d.parent != null) parts.push('subtask of #' + d.parent + ' ' + esc(IX.get(d.parent).title))
	for (const id of d.deps) parts.push(I.lock + ' waits for #' + id + ' ' + esc(IX.get(id).title))
	const title = d.title ? `<b>${esc(d.title)}</b>` : '<span class="warn">Type a title</span>'
	el.innerHTML = `<span class="prev"><span class="muted">New task:</span> ${title}${parts.map(p => `<span class="prev-p">${p}</span>`).join('')}<span class="muted">Enter to add</span></span>`
}

function submitCapture() {
	const input = $('#cap')
	const d = draft(input.value)
	if (!d.title) {
		const box = $('.cap-box')
		box.classList.remove('shake')
		void box.offsetWidth
		box.classList.add('shake')
		return
	}
	let t = null
	mutate(() => {
		t = newTask(d)
		flash([t.id])
	}, { keepDrawer: true })
	input.value = ''
	renderPreview()
	hideSug()
	toast(`Added <b>#${t.id}</b> ${esc(t.title)}`, { action: 'Open', fn: () => openTask(t.id) })
}

// ---------------------------------------------------------------- shared pieces of the views

function avatar(name, cls) {
	if (!name) return `<span class="av none ${cls || ''}" title="No assignee"></span>`
	const initials = name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
	return `<span class="av ${cls || ''}" style="--h:${hue(name)}" title="${esc(name)}">${esc(initials)}</span>`
}

function dot(t) {
	return `<button class="dot s-${t.status}" data-act="status-menu" data-id="${t.id}" title="${ST[t.status].label}. Click to change.">${t.status === 'done' ? I.check : ''}</button>`
}

function dueChip(t) {
	if (!t.due) return ''
	return `<span class="chip due ${IX.overdue(t) ? 'od' : ''}" title="Due ${fmtDate(t.due)}">${fmtShort(t.due)}</span>`
}

function lockChip(t) {
	if (!IX.blocked(t)) return ''
	const b = IX.blockers(t)
	const tip = 'Waits for ' + b.map(x => '#' + x.id + ' ' + x.title).join(', ')
	return `<span class="chip lock" title="${esc(tip)}">${I.lock}waits for ${b.map(x => '#' + x.id).join(' ')}</span>`
}

function unlockChip(t) {
	const n = IX.open(t) ? IX.unlocks(t) : 0
	if (!n) return ''
	return `<span class="chip unl" title="${n} open task${n > 1 ? 's' : ''} wait${n > 1 ? '' : 's'} for this one">${I.domino}unlocks ${n}</span>`
}

function metaChips(t) {
	const p = IX.progress(t)
	return [
		lockChip(t),
		unlockChip(t),
		t.priority !== 'med' ? `<span class="chip p-${t.priority}">${PR[t.priority].label}</span>` : '',
		t.domain ? `<span class="chip dom">${esc(t.domain)}</span>` : '',
		dueChip(t),
		p.total ? `<span class="chip" title="${p.done} of ${p.total} subtasks done">${I.check}${p.done}/${p.total}</span>` : '',
		t.files.length ? `<span class="chip" title="Attachments">${I.clip}${t.files.length}</span>` : '',
	].join('')
}

function flashCls(t) {
	return ui.flash.has(t.id) ? 'flash' : ''
}

function emptyFilter() {
	return '<div class="empty">No task agrees with this filter. <button class="btn" data-act="clear-filter">Clear the filter</button></div>'
}

// ---------------------------------------------------------------- view: Now

function viewNow(list) {
	if (!db.tasks.length) return hero()
	if (!list.length) return emptyFilter()
	const counts = {}
	for (const t of list) counts[t.status] = (counts[t.status] || 0) + 1
	const flow = STATUSES.filter(s => counts[s.id]).map(s =>
		`<button class="flow-seg s-${s.id}" style="flex-grow:${counts[s.id]}" data-act="tok" data-tok="status:${s.id}" data-add="1" data-go="list" title="Show these tasks"><b>${counts[s.id]}</b><span>${s.label}</span></button>`
	).join('')

	const ready = list.filter(IX.ready).sort((a, b) => score(b) - score(a) || a.id - b.id)
	const blocked = list.filter(IX.blocked)
	const overdue = list.filter(IX.overdue)
	const flight = list.filter(t => t.status === 'doing' || t.status === 'review').sort((a, b) => (a.due || '9').localeCompare(b.due || '9') || a.id - b.id)
	const doneWeek = list.filter(t => t.status === 'done' && t.doneAt && t.doneAt > Date.now() - 7 * DAY)

	function tile(n, label, sub, tok, cls) {
		return `<button class="tile ${cls}" data-act="tok" data-tok="${tok}" data-add="1" data-go="list"><b>${n}</b><span>${label}</span><small>${sub}</small></button>`
	}
	const tiles = [
		tile(ready.length, 'Ready to start', 'Nothing blocks these', 'is:ready', 't-ready'),
		tile(blocked.length, 'Blocked', 'Wait for other tasks', 'is:blocked', blocked.length ? 't-blocked' : ''),
		tile(overdue.length, 'Overdue', 'The due date is past', 'is:overdue', overdue.length ? 't-over' : ''),
		tile(doneWeek.length, 'Done this week', 'In the last 7 days', 'status:done', ''),
	].join('')

	const next = ready.slice(0, 7).map((t, i) => `
		<div class="nrow ${flashCls(t)}" data-act="open" data-id="${t.id}">
			<span class="rank">${i + 1}</span>
			<div class="nmain"><div class="ntitle"><span class="id">#${t.id}</span> ${esc(t.title)}</div><div class="nmeta">${metaChips(t)}</div></div>
			${avatar(t.assignee)}
			<button class="btn sm" data-act="start" data-id="${t.id}">Start</button>
		</div>`).join('')

	const inFlight = flight.slice(0, 7).map(t => `
		<div class="nrow" data-act="open" data-id="${t.id}">
			${dot(t)}
			<div class="nmain"><div class="ntitle"><span class="id">#${t.id}</span> ${esc(t.title)}</div><div class="nmeta"><span class="chip st s-${t.status}">${ST[t.status].label}</span>${metaChips(t)}</div></div>
			${avatar(t.assignee)}
			<button class="btn sm" data-act="set-status" data-status="done" data-id="${t.id}">Done</button>
		</div>`).join('')

	const waiting = blocked.sort((a, b) => IX.unlocks(b) - IX.unlocks(a) || a.id - b.id).slice(0, 7).map(t => `
		<div class="nrow" data-act="open" data-id="${t.id}">
			<span class="lockbox">${I.lock}</span>
			<div class="nmain"><div class="ntitle"><span class="id">#${t.id}</span> ${esc(t.title)}</div>
			${IX.blockers(t).map(b => `<div class="waitfor" data-act="open" data-id="${b.id}">waits for <b>#${b.id}</b> ${esc(b.title)} <span class="chip st s-${b.status}">${ST[b.status].label}</span>${b.assignee ? ' ' + esc(b.assignee) : ''}</div>`).join('')}
			</div>
			${avatar(t.assignee)}
		</div>`).join('')

	function more(n, tok) {
		return n > 7 ? `<button class="link more" data-act="tok" data-tok="${tok}" data-add="1" data-go="list">Show all ${n}</button>` : ''
	}

	return `
		<div class="now">
			<div class="flow">${flow}</div>
			<div class="tiles">${tiles}</div>
			<div class="cols3">
				<section class="panel"><h3>${I.domino} Do next <small>The tasks at the top unlock the most work</small></h3>${next || '<p class="none">No task is ready. Complete a task that is in progress, or add a new one.</p>'}${more(ready.length, 'is:ready')}</section>
				<section class="panel"><h3>In progress</h3>${inFlight || '<p class="none">No task is in progress. Start one from the list on the left.</p>'}</section>
				<section class="panel"><h3>${I.lock} Waiting</h3>${waiting || '<p class="none">No task is blocked.</p>'}${more(blocked.length, 'is:blocked')}</section>
			</div>
			<div class="cols2">
				${breakdown(list, 'domain', 'By domain', '#', 'No domain')}
				${breakdown(list, 'assignee', 'By assignee', '@', 'No assignee')}
			</div>
		</div>`
}

function breakdown(list, key, title, prefix, noneLabel) {
	const groups = new Map()
	for (const t of list) pushTo(groups, t[key] || '', t)
	const rows = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length)
	const max = Math.max(...rows.map(r => r[1].length))
	const html = rows.map(([name, tasks]) => {
		const segs = STATUSES.map(s => {
			const n = tasks.filter(t => t.status === s.id).length
			return n ? `<i class="s-${s.id}" style="flex-grow:${n}" title="${s.label}: ${n}"></i>` : ''
		}).join('')
		const who = key === 'assignee' ? avatar(name, 'xs') : ''
		return `<button class="brow" data-act="tok" data-tok="${esc(name ? tokName(prefix, name) : prefix + 'none')}" data-add="1" data-go="list">
			<span class="bname">${who}${esc(name || noneLabel)}</span>
			<span class="bbar"><span style="width:${(tasks.length / max) * 100}%">${segs}</span></span>
			<span class="bn">${tasks.length}</span></button>`
	}).join('')
	return `<section class="panel"><h3>${title}</h3>${html}</section>`
}

function hero() {
	return `
		<div class="hero">
			<div class="hero-art">${[0, 1, 2, 3, 4].map(i => `<i style="--i:${i}"></i>`).join('')}</div>
			<h1>Start with one task.</h1>
			<p>Type it in the bar at the top, then press Enter. You can put the details in the same line:</p>
			<p><code class="big">Design the pricing page @chloe #design !high due:fri</code></p>
			<p>Domino shows which task to do next: the task that unlocks the most work for other tasks.</p>
			<p><button class="btn primary" data-act="sample">Load a sample project</button></p>
		</div>`
}

// ---------------------------------------------------------------- view: Board

function viewBoard(list) {
	if (!db.tasks.length) return hero()
	const cols = BOARD.slice()
	if (list.some(t => t.status === 'cancelled')) cols.push('cancelled')
	function order(a, b) {
		return PR[b.priority].w - PR[a.priority].w || (a.due || '9').localeCompare(b.due || '9') || a.id - b.id
	}
	return `<div class="board">${cols.map(s => {
		const items = list.filter(t => t.status === s).sort(order)
		return `
			<section class="col s-${s}" data-drop="${s}">
				<header><span class="col-dot"></span><b>${ST[s].label}</b><span class="n">${items.length}</span><span class="sp"></span>
				<button class="icon-btn sm" data-act="add-col" data-status="${s}" title="Add a task with this status">${I.plus}</button></header>
				<div class="col-body" data-scroll="col-${s}">${items.map(card).join('') || '<div class="col-empty">Drop a task here</div>'}</div>
			</section>`
	}).join('')}</div>`
}

function card(t) {
	const p = t.parent != null ? IX.get(t.parent) : null
	return `
		<article class="card ${IX.blocked(t) ? 'is-blocked' : ''} ${flashCls(t)}" draggable="true" data-act="open" data-id="${t.id}">
			${p ? `<div class="crumb">in #${p.id} ${esc(p.title)}</div>` : ''}
			<div class="card-t"><span class="id">#${t.id}</span> ${esc(t.title)}</div>
			<div class="card-m">${metaChips(t)}<span class="sp"></span>${avatar(t.assignee)}</div>
		</article>`
}

// ---------------------------------------------------------------- view: List

const SORTS = {
	created: (a, b) => a.id - b.id,
	due: (a, b) => (a.due || '9').localeCompare(b.due || '9') || a.id - b.id,
	priority: (a, b) => PR[b.priority].w - PR[a.priority].w || a.id - b.id,
	status: (a, b) => ST[a.status].order - ST[b.status].order || a.id - b.id,
}

function viewList(list) {
	if (!db.tasks.length) return hero()
	if (!list.length) return emptyFilter()
	const match = new Set(list.map(t => t.id))
	const show = new Set(match)
	const filtering = !!ui.query.trim()
	if (filtering) {
		for (const t of list) {
			let p = t.parent != null ? IX.get(t.parent) : null
			while (p && !show.has(p.id)) {
				show.add(p.id)
				p = p.parent != null ? IX.get(p.parent) : null
			}
		}
	}
	const cmp = SORTS[ui.sort] || SORTS.created
	const rows = []
	function walk(t, depth) {
		const kids = (IX.kids.get(t.id) || []).filter(k => show.has(k.id)).sort(cmp)
		rows.push(listRow(t, depth, kids.length, !match.has(t.id), filtering))
		if (filtering || !ui.collapsed.has(t.id)) for (const k of kids) walk(k, depth + 1)
		if (ui.addIn === t.id) rows.push(addRow(t, depth + 1))
	}
	db.tasks.filter(t => show.has(t.id) && (t.parent == null || !show.has(t.parent))).sort(cmp).forEach(t => walk(t, 0))
	const opts = [['created', 'Order of creation'], ['due', 'Due date'], ['priority', 'Priority'], ['status', 'Status']]
	return `
		<div class="toolbar">
			<label class="sel">Sort by <select data-ch="sort">${opts.map(([k, l]) => `<option value="${k}" ${ui.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
			<button class="btn" data-act="expand-all">Expand all</button>
			<button class="btn" data-act="collapse-all">Collapse all</button>
			<span class="sp"></span><span class="muted">${list.length} task${list.length === 1 ? '' : 's'}</span>
		</div>
		<div class="list">
			<div class="lrow lhead"><div>Task</div><div>Domain</div><div>Assignee</div><div>Priority</div><div>Due</div><div>Flow</div></div>
			${rows.join('')}
		</div>`
}

function listRow(t, depth, kidCount, dim, filtering) {
	const p = IX.progress(t)
	const isOpen = filtering || !ui.collapsed.has(t.id)
	const twist = kidCount
		? `<button class="tw ${isOpen ? 'opn' : ''}" data-act="collapse" data-id="${t.id}" title="Show or hide the subtasks">${I.chev}</button>`
		: '<span class="tw"></span>'
	return `
		<div class="lrow ${dim ? 'dim' : ''} ${t.status === 'done' ? 'is-done' : ''} ${t.status === 'cancelled' ? 'is-cancelled' : ''} ${flashCls(t)}" data-act="open" data-id="${t.id}">
			<div class="lt" style="padding-left:${6 + depth * 24}px">${twist}${dot(t)}<span class="id">#${t.id}</span><span class="ltt">${esc(t.title)}</span>
				${p.total ? `<span class="prog" title="${p.done} of ${p.total} subtasks done"><i style="width:${(p.done / p.total) * 100}%"></i></span><span class="pn">${p.done}/${p.total}</span>` : ''}
				${t.files.length ? `<span class="pn">${I.clip}${t.files.length}</span>` : ''}
				<button class="ladd-btn" data-act="add-child" data-id="${t.id}" title="Add a subtask to #${t.id}">${I.plus}</button></div>
			<div>${t.domain ? `<span class="chip dom">${esc(t.domain)}</span>` : ''}</div>
			<div class="la">${t.assignee ? avatar(t.assignee, 'xs') + `<span>${esc(t.assignee)}</span>` : ''}</div>
			<div>${t.priority !== 'med' ? `<span class="chip p-${t.priority}">${PR[t.priority].label}</span>` : ''}</div>
			<div>${dueChip(t)}</div>
			<div class="lf">${lockChip(t)}${unlockChip(t)}</div>
		</div>`
}

/** The line below a task where you type a new subtask. */
function addRow(parent, depth) {
	return `
		<div class="lrow ladd">
			<div class="lt" style="padding-left:${6 + depth * 24}px"><span class="tw"></span><span class="ladd-dot"></span>
				<input data-in="row-sub" value="${esc(ui.addText)}" placeholder="New subtask of #${parent.id}. Press Enter to add it, Esc to close." autocomplete="off" spellcheck="false"></div>
		</div>`
}

function addInput() {
	return $('#view .ladd input')
}

function closeAdd() {
	ui.addIn = null
	ui.addText = ''
	hideSug()
	render({ keepDrawer: true })
}

function submitAdd(el) {
	const parent = IX.get(ui.addIn)
	const d = parent ? draft(el.value + ' in:' + parent.id) : null
	if (!d || !d.title) return
	hideSug()
	el.value = ''
	ui.addText = ''
	let t = null
	mutate(() => {
		t = newTask(d)
		flash([t.id])
	})
	if (ui.query.trim() && !filtered().includes(t)) toast(`Added <b>#${t.id}</b> ${esc(t.title)}. The filter hides it.`, { action: 'Open', fn: () => openTask(t.id) })
}

/** After a click away from an empty subtask line: remove the line, unless the click opened a menu. */
function settleAdd(prev) {
	if (ui.addIn != null || !$('#view .ladd')) return
	if (!$('#pop').hidden) {
		ui.addIn = prev
		return
	}
	render({ keepDrawer: true })
}

// ---------------------------------------------------------------- view: Timeline

const RH = 38
const LW = 280

function tlSpan(t) {
	const s = t.start || t.due
	const e = t.due || t.start
	return s <= e ? [s, e] : [e, s]
}

function arrowPath(x1, y1, x2, y2) {
	if (x2 >= x1 + 16) return `M${x1},${y1}H${x1 + 8}V${y2}H${x2 - 3}`
	const mid = y1 + (y2 > y1 ? 1 : -1) * (RH / 2)
	return `M${x1},${y1}h8V${mid}H${x2 - 11}V${y2}H${x2 - 3}`
}

function viewTimeline(list) {
	if (!db.tasks.length) return hero()
	// The full span of a task: its dates together with the dates of its subtasks.
	const spanMemo = new Map()
	function fullSpan(t) {
		if (spanMemo.has(t.id)) return spanMemo.get(t.id)
		spanMemo.set(t.id, null)
		let s = null
		let e = null
		if (t.start || t.due) [s, e] = tlSpan(t)
		for (const k of IX.kids.get(t.id) || []) {
			const ks = k.status === 'cancelled' ? null : fullSpan(k)
			if (!ks) continue
			if (!s || ks[0] < s) s = ks[0]
			if (!e || ks[1] > e) e = ks[1]
		}
		const span = s ? [s, e] : null
		spanMemo.set(t.id, span)
		return span
	}
	function hasDatedKids(t) {
		return (IX.kids.get(t.id) || []).some(k => k.status !== 'cancelled' && fullSpan(k))
	}
	const sched = list.filter(fullSpan).sort((a, b) => fullSpan(a)[0].localeCompare(fullSpan(b)[0]) || a.id - b.id)
	const loose = list.filter(t => !fullSpan(t) && IX.open(t))
	const zooms = [['day', 'Days'], ['week', 'Weeks'], ['month', 'Months']]
	const groupsOpt = [['domain', 'Domain'], ['assignee', 'Assignee'], ['status', 'Status'], ['none', 'No groups']]
	const bar = `
		<div class="toolbar">
			<div class="segc">${zooms.map(([k, l]) => `<button class="${ui.zoom === k ? 'on' : ''}" data-act="zoom" data-zoom="${k}">${l}</button>`).join('')}</div>
			<label class="sel">Group by <select data-ch="group">${groupsOpt.map(([k, l]) => `<option value="${k}" ${ui.group === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
			<button class="btn" data-act="tl-today">Go to today</button>
			<span class="sp"></span><span class="muted">Drag a bar to move it. Drag an end of a bar to change one date.</span>
		</div>`
	const looseHtml = loose.length
		? `<div class="tl-loose"><span class="muted">No dates (${loose.length}):</span>${loose.slice(0, 14).map(t => `<button class="ftok" data-act="open" data-id="${t.id}">#${t.id} ${esc(t.title)}</button>`).join('')}${loose.length > 14 ? '<span class="muted">and more</span>' : ''}</div>`
		: ''
	if (!sched.length) return bar + '<div class="empty">No task has a date. Open a task and set a start date or a due date. You can also type <code>due:fri</code> in the bar at the top.</div>' + looseHtml

	let min = today()
	let max = today()
	for (const t of sched) {
		const [s, e] = fullSpan(t)
		if (s < min) min = s
		if (e > max) max = e
	}
	min = addDays(min, -10)
	min = addDays(min, -((parseISO(min).getDay() + 6) % 7))
	max = addDays(max, 28)
	const days = diffDays(min, max) + 1
	const W = { day: 36, week: 17, month: 6 }[ui.zoom] || 17
	const width = days * W

	// Groups
	const keyOf = {
		domain: t => t.domain || 'No domain',
		assignee: t => t.assignee || 'No assignee',
		status: t => ST[t.status].label,
		none: () => '',
	}[ui.group] || (() => '')
	const groups = new Map()
	for (const t of sched) pushTo(groups, keyOf(t), t)
	let keys = Array.from(groups.keys())
	if (ui.group === 'status') keys.sort((a, b) => STATUSES.findIndex(s => s.label === a) - STATUSES.findIndex(s => s.label === b))
	else keys.sort((a, b) => a.startsWith('No ') - b.startsWith('No ') || a.localeCompare(b))
	// In each group, a parent task comes first. Its subtasks follow, indented.
	const rows = []
	function addRows(t, depth, members) {
		const kids = members.filter(k => k.parent === t.id)
		rows.push({ t, depth, kids: kids.length })
		if (!ui.collapsed.has(t.id)) for (const k of kids) addRows(k, depth + 1, members)
	}
	for (const key of keys) {
		const members = groups.get(key)
		const ids = new Set(members.map(t => t.id))
		if (ui.group !== 'none') rows.push({ head: key, n: members.length })
		for (const t of members) if (t.parent == null || !ids.has(t.parent)) addRows(t, 0, members)
	}

	// Scale and grid
	let months = ''
	let ticks = ''
	let grid = ''
	const base = parseISO(min)
	for (let i = 0; i < days; i++) {
		const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
		const dow = d.getDay()
		const left = i * W
		if (d.getDate() === 1 || (i === 0 && d.getDate() < 22)) months += `<span class="tl-mon" style="left:${left}px">${MON[d.getMonth()]} ${d.getFullYear()}</span>`
		if (ui.zoom === 'day') ticks += `<span class="tl-tick ${dow === 0 || dow === 6 ? 'we' : ''}" style="left:${left}px;width:${W}px">${d.getDate()}</span>`
		else if (ui.zoom === 'week' && dow === 1) ticks += `<span class="tl-tick" style="left:${left}px;width:${7 * W}px">${d.getDate()}</span>`
		if (dow === 1) grid += `<i class="wk" style="left:${left}px"></i>`
		if (dow === 6 && ui.zoom !== 'month') grid += `<i class="we" style="left:${left}px;width:${2 * W}px"></i>`
		if (d.getDate() === 1) grid += `<i class="mo" style="left:${left}px"></i>`
	}
	const todayX = diffDays(min, today()) * W + W / 2
	grid += `<i class="nowline" style="left:${todayX}px"></i>`

	// Rows and bars
	const pos = new Map()
	let body = ''
	rows.forEach((r, i) => {
		if (r.t == null) {
			body += `<div class="tl-row tl-group"><div class="tl-label"><b>${esc(r.head)}</b><span class="n">${r.n}</span></div><div class="tl-track" style="width:${width}px"></div></div>`
			return
		}
		const t = r.t
		const own = t.start || t.due ? tlSpan(t) : null
		const full = fullSpan(t)
		const isParent = hasDatedKids(t)
		const y = i * RH + RH / 2
		let track = ''
		if (isParent) {
			const sx = diffDays(min, full[0]) * W
			const sw = (diffDays(full[0], full[1]) + 1) * W
			const tip = `#${t.id} ${t.title} and its subtasks\n${fmtDate(full[0])} to ${fmtDate(full[1])}`
			track += `<div class="sum" data-act="open" data-id="${t.id}" style="left:${sx}px;width:${sw - 2}px" title="${esc(tip)}"></div>`
			if (!own) {
				track += `<span class="sum-t" style="left:${sx + sw + 6}px">${esc(t.title)}</span>`
				pos.set(t.id, { x1: sx, x2: sx + sw - 2, y })
			}
		}
		if (own) {
			const [s, e] = own
			const x1 = diffDays(min, s) * W
			const w = (diffDays(s, e) + 1) * W
			pos.set(t.id, { x1, x2: x1 + w - 2, y })
			const out = t.title.length * 6.6 + 34 > w
			const cls = [IX.blocked(t) ? 'is-blocked' : '', IX.overdue(t) ? 'is-over' : '', t.start && t.due ? '' : 'point', flashCls(t)].join(' ')
			const tip = `#${t.id} ${t.title}\n${fmtDate(s)}${s !== e ? ' to ' + fmtDate(e) : ''}\n${ST[t.status].label}${IX.blocked(t) ? '. Waits for ' + IX.blockers(t).map(b => '#' + b.id).join(', ') : ''}`
			track += `<div class="bar s-${t.status} ${cls}" data-id="${t.id}" data-w="${W}" style="left:${x1}px;width:${w - 2}px" title="${esc(tip)}"><i class="hl"></i><span class="bar-t ${out ? 'out' : ''}">${IX.blocked(t) ? I.lock : ''}${esc(t.title)}</span><i class="hr"></i></div>`
		}
		const parent = t.parent != null ? IX.get(t.parent) : null
		const crumb = r.depth === 0 && parent ? `<span class="tl-in" title="Subtask of #${parent.id} ${esc(parent.title)}">in #${parent.id}</span>` : ''
		const twist = r.kids ? `<button class="tw ${ui.collapsed.has(t.id) ? '' : 'opn'}" data-act="collapse" data-id="${t.id}" title="Show or hide the subtasks">${I.chev}</button>` : ''
		body += `
			<div class="tl-row ${isParent ? 'tl-parent' : ''}">
				<div class="tl-label" style="padding-left:${12 + r.depth * 22}px" data-act="open" data-id="${t.id}">${twist}${dot(t)}<span class="id">#${t.id}</span><span class="tl-name">${esc(t.title)}</span>${crumb}${avatar(t.assignee, 'xs')}</div>
				<div class="tl-track" style="width:${width}px">${track}</div>
			</div>`
	})

	// Dependency arrows
	function shownSpan(t) {
		return t.start || t.due ? tlSpan(t) : fullSpan(t)
	}
	let arrows = ''
	for (const t of sched) {
		const b = pos.get(t.id)
		for (const depId of t.deps) {
			const a = pos.get(depId)
			const dep = IX.get(depId)
			if (!a || !b || !dep) continue
			const bad = IX.open(t) && IX.open(dep) && shownSpan(t)[0] <= shownSpan(dep)[1]
			arrows += `<path class="${bad ? 'bad' : IX.open(dep) ? '' : 'clr'}" d="${arrowPath(a.x2, a.y, b.x1, b.y)}" marker-end="url(#ah-${bad ? 'bad' : 'ok'})"><title>#${t.id} waits for #${depId}${bad ? '. The dates do not agree: #' + t.id + ' starts before #' + depId + ' ends.' : ''}</title></path>`
		}
	}

	return `${bar}
		<div class="tl" data-scroll="tl" data-today="${todayX}">
			<div class="tl-inner" style="width:${LW + width}px">
				<div class="tl-head"><div class="tl-corner">${sched.length} task${sched.length === 1 ? '' : 's'} with dates</div><div class="tl-scale" style="width:${width}px">${months}${ticks}<span class="tl-now" style="left:${todayX}px">Today</span></div></div>
				<div class="tl-body">
					<div class="tl-grid" style="left:${LW}px;width:${width}px">${grid}</div>
					${body}
					<svg class="tl-arrows" style="left:${LW}px" width="${width}" height="${rows.length * RH}">
						<defs>
							<marker id="ah-ok" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0.5L7,4L0,7.5z" class="ah-ok"/></marker>
							<marker id="ah-bad" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0.5L7,4L0,7.5z" class="ah-bad"/></marker>
						</defs>${arrows}
					</svg>
				</div>
			</div>
		</div>${looseHtml}`
}

function startBarDrag(e, bar) {
	const id = +bar.dataset.id
	const t = IX.get(id)
	const W = +bar.dataset.w
	const mode = e.target.classList.contains('hl') ? 'l' : e.target.classList.contains('hr') ? 'r' : 'm'
	const x0 = e.clientX
	const left0 = parseFloat(bar.style.left)
	const w0 = parseFloat(bar.style.width)
	const len = Math.round((w0 + 2) / W)
	let shift = 0
	e.preventDefault()

	function move(ev) {
		let d = Math.round((ev.clientX - x0) / W)
		if (mode === 'l') d = Math.min(d, len - 1)
		if (mode === 'r') d = Math.max(d, 1 - len)
		shift = d
		if (mode !== 'r') bar.style.left = left0 + d * W + 'px'
		if (mode === 'l') bar.style.width = w0 - d * W + 'px'
		if (mode === 'r') bar.style.width = w0 + d * W + 'px'
		bar.classList.toggle('dragging', d !== 0)
	}

	function up() {
		document.removeEventListener('mousemove', move)
		document.removeEventListener('mouseup', up)
		if (!shift) {
			bar.classList.remove('dragging')
			openTask(id)
			return
		}
		const [s, en] = tlSpan(t)
		mutate(() => {
			if (mode === 'm') {
				if (t.start) t.start = addDays(t.start, shift)
				if (t.due) t.due = addDays(t.due, shift)
			} else if (mode === 'l') {
				t.start = addDays(s, shift)
				t.due = en
			} else {
				t.start = s
				t.due = addDays(en, shift)
			}
			touch(t, 'Dates: ' + fmtDate(tlSpan(t)[0]) + ' to ' + fmtDate(tlSpan(t)[1]))
		})
	}

	document.addEventListener('mousemove', move)
	document.addEventListener('mouseup', up)
}

// ---------------------------------------------------------------- view: Map

const NW = 220
const NH = 76
const GX = 84
const GY = 14
const PAD = 28
const LOOSE_COLS = 5

function viewMap(list) {
	if (!db.tasks.length) return hero()
	const set = new Map(list.filter(t => t.status !== 'cancelled').map(t => [t.id, t]))
	if (!set.size) return emptyFilter()
	function deps(t) {
		return t.deps.filter(d => set.has(d))
	}
	const used = new Set()
	const outs = new Map()
	for (const t of set.values()) {
		for (const d of deps(t)) {
			used.add(d)
			used.add(t.id)
			pushTo(outs, d, t.id)
		}
	}
	const linked = Array.from(set.values()).filter(t => used.has(t.id))
	const loose = Array.from(set.values()).filter(t => !used.has(t.id))
	const showLoose = ui.mapAll || !linked.length

	// Columns: a task is one column to the right of the last task it waits for.
	const layerOf = new Map()
	function layer(t) {
		if (layerOf.has(t.id)) return layerOf.get(t.id)
		layerOf.set(t.id, 0)
		const d = deps(t)
		const value = d.length ? 1 + Math.max(...d.map(id => layer(set.get(id)))) : 0
		layerOf.set(t.id, value)
		return value
	}
	for (const t of linked) layer(t)
	// A task that waits for nothing goes directly before the first task that waits for it.
	for (const t of linked) {
		if (!deps(t).length) layerOf.set(t.id, Math.min(...outs.get(t.id).map(id => layerOf.get(id))) - 1)
	}
	const pos = new Map()
	function avgY(ids) {
		return ids.reduce((sum, id) => sum + pos.get(id).y, 0) / ids.length
	}
	function place(col, want) {
		const wants = new Map(col.map(t => [t.id, want(t)]))
		col.sort((a, b) => wants.get(a.id) - wants.get(b.id) || a.id - b.id)
		let y = -Infinity
		for (const t of col) {
			const next = Math.max(wants.get(t.id), y)
			pos.get(t.id).y = next
			y = next + NH + GY
		}
	}
	// Tasks that are connected make one block. Each block has its own layout. The blocks are stacked.
	const inBlock = new Set()
	const blocks = []
	for (const t of linked) {
		if (inBlock.has(t.id)) continue
		const block = []
		const stack = [t.id]
		while (stack.length) {
			const id = stack.pop()
			if (inBlock.has(id)) continue
			inBlock.add(id)
			block.push(set.get(id))
			stack.push(...deps(set.get(id)), ...(outs.get(id) || []))
		}
		blocks.push(block)
	}
	blocks.sort((a, b) => b.length - a.length)
	const BLOCK_GAP = 30
	let maxY = PAD - BLOCK_GAP
	let maxCols = 0
	for (const block of blocks) {
		const first = Math.min(...block.map(t => layerOf.get(t.id)))
		const cols = []
		for (const t of block) {
			const l = layerOf.get(t.id) - first
			cols[l] = cols[l] || []
			cols[l].push(t)
		}
		cols.forEach((col, ci) => {
			col.sort((a, b) => (a.domain || '').localeCompare(b.domain || '') || a.id - b.id)
			col.forEach((t, i) => pos.set(t.id, { x: PAD + ci * (NW + GX), y: i * (NH + GY) }))
		})
		for (let pass = 0; pass < 2; pass++) {
			for (let ci = 1; ci < cols.length; ci++) place(cols[ci], t => (deps(t).length ? avgY(deps(t)) : pos.get(t.id).y))
			for (let ci = cols.length - 2; ci >= 0; ci--) place(cols[ci], t => (outs.has(t.id) ? avgY(outs.get(t.id)) : pos.get(t.id).y))
		}
		const top = Math.min(...block.map(t => pos.get(t.id).y))
		const base = maxY + BLOCK_GAP
		for (const t of block) {
			const p = pos.get(t.id)
			p.y = p.y - top + base
			maxY = Math.max(maxY, p.y + NH)
		}
		maxCols = Math.max(maxCols, cols.length)
	}
	let widthPx = PAD * 2 + Math.max(0, maxCols * (NW + GX) - GX)
	let looseLabel = ''
	if (showLoose && loose.length) {
		const top = linked.length ? maxY + 64 : PAD
		if (linked.length) looseLabel = `<div class="map-label" style="left:${PAD}px;top:${top - 30}px">Tasks with no link</div>`
		loose.sort((a, b) => (a.domain || '').localeCompare(b.domain || '') || a.id - b.id).forEach((t, i) => {
			pos.set(t.id, { x: PAD + (i % LOOSE_COLS) * (NW + 22), y: top + Math.floor(i / LOOSE_COLS) * (NH + GY) })
		})
		maxY = top + Math.ceil(loose.length / LOOSE_COLS) * (NH + GY)
		widthPx = Math.max(widthPx, PAD * 2 + Math.min(loose.length, LOOSE_COLS) * (NW + 22))
	}

	let edges = ''
	for (const t of linked) {
		const b = pos.get(t.id)
		for (const depId of deps(t)) {
			const a = pos.get(depId)
			const dep = set.get(depId)
			const x1 = a.x + NW
			const y1 = a.y + NH / 2
			const x2 = b.x
			const y2 = b.y + NH / 2
			const c = Math.max(34, (x2 - x1) / 2)
			const d = `M${x1},${y1}C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`
			edges += `<path class="e ${IX.open(dep) ? 'blk' : 'clr'}" data-from="${depId}" data-to="${t.id}" d="${d}"/><path class="hit" data-act="edge" data-from="${depId}" data-to="${t.id}" d="${d}"><title>#${t.id} waits for #${depId}. Click to remove this link.</title></path>`
		}
	}

	let nodes = ''
	for (const [id, p] of pos) {
		const t = set.get(id)
		const state = IX.blocked(t) ? I.lock + 'Waiting' : IX.ready(t) ? 'Ready' : ST[t.status].label
		nodes += `
			<div class="mnode s-${t.status} ${IX.blocked(t) ? 'is-blocked' : ''} ${IX.ready(t) ? 'is-ready' : ''} ${flashCls(t)}" style="left:${p.x}px;top:${p.y}px" data-act="open" data-id="${t.id}">
				<div class="mn-top"><span class="dot s-${t.status} static">${t.status === 'done' ? I.check : ''}</span><span class="id">#${t.id}</span><span class="mn-st">${state}</span><span class="sp"></span>${avatar(t.assignee, 'xs')}</div>
				<div class="mn-t">${esc(t.title)}</div>
				<i class="port" data-act="noop" title="Drag from here to the task that must wait for this one"></i>
			</div>`
	}

	return `
		<div class="toolbar">
			<span class="muted">Work moves from left to right. Drag from the dot on a task to a second task: the second task then waits for the first.</span>
			<span class="sp"></span>
			<span class="legend"><i class="lg blk"></i>blocks now<i class="lg clr"></i>cleared</span>
			${linked.length && loose.length ? `<button class="btn ${ui.mapAll ? 'on' : ''}" data-act="map-all">${ui.mapAll ? 'Hide' : 'Show'} ${loose.length} task${loose.length === 1 ? '' : 's'} with no link</button>` : ''}
		</div>
		<div class="map-wrap" data-scroll="map">
			<div class="map" style="width:${widthPx}px;height:${maxY + PAD}px">
				<svg width="${widthPx}" height="${maxY + PAD}">${edges}</svg>
				${looseLabel}${nodes}
			</div>
		</div>`
}

function chainOf(id) {
	const up = new Set()
	const down = new Set()
	let stack = [id]
	while (stack.length) {
		const t = IX.get(stack.pop())
		for (const d of t ? t.deps : []) {
			if (!up.has(d)) {
				up.add(d)
				stack.push(d)
			}
		}
	}
	stack = [id]
	while (stack.length) {
		for (const d of IX.dependents.get(stack.pop()) || []) {
			if (!down.has(d)) {
				down.add(d)
				stack.push(d)
			}
		}
	}
	return { up, down }
}

function highlightChain(id) {
	const map = $('.map')
	if (!map || map.classList.contains('connecting')) return
	const { up, down } = chainOf(id)
	up.add(id)
	down.add(id)
	map.classList.add('hl')
	for (const n of $$('.mnode', map)) n.classList.toggle('on', up.has(+n.dataset.id) || down.has(+n.dataset.id))
	for (const p of $$('path.e', map)) {
		const from = +p.dataset.from
		const to = +p.dataset.to
		p.classList.toggle('on', (up.has(from) && up.has(to)) || (down.has(from) && down.has(to)))
	}
}

function clearChain() {
	const map = $('.map')
	if (!map) return
	map.classList.remove('hl')
	for (const n of $$('.on', map)) n.classList.remove('on')
}

function startConnect(e, port) {
	e.preventDefault()
	const node = port.closest('.mnode')
	const from = +node.dataset.id
	const map = $('.map')
	const svg = $('svg', map)
	const x1 = node.offsetLeft + NW
	const y1 = node.offsetTop + NH / 2
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
	path.setAttribute('class', 'e tmp')
	svg.append(path)
	clearChain()
	map.classList.add('connecting')

	function target(ev) {
		const el = document.elementFromPoint(ev.clientX, ev.clientY)
		const n = el ? el.closest('.mnode') : null
		return n && n !== node ? n : null
	}

	function move(ev) {
		const r = map.getBoundingClientRect()
		const x2 = ev.clientX - r.left
		const y2 = ev.clientY - r.top
		const c = Math.max(34, Math.abs(x2 - x1) / 2)
		path.setAttribute('d', `M${x1},${y1}C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`)
		for (const n of $$('.mnode.target', map)) n.classList.remove('target')
		const n = target(ev)
		if (n) n.classList.add('target')
	}

	function up(ev) {
		document.removeEventListener('mousemove', move)
		document.removeEventListener('mouseup', up)
		path.remove()
		map.classList.remove('connecting')
		for (const n of $$('.mnode.target', map)) n.classList.remove('target')
		const n = target(ev)
		if (n) addDep(+n.dataset.id, from)
	}

	document.addEventListener('mousemove', move)
	document.addEventListener('mouseup', up)
}

// ---------------------------------------------------------------- drawer (one task)

function rich(text) {
	return esc(text)
		.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)]/g, url => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`)
		.replace(/(^|[\s(])#(\d+)\b/g, (all, pre, id) => (IX.get(+id) ? `${pre}<a class="ref" data-act="open" data-id="${id}">#${id}</a>` : all))
}

function descView(t) {
	return t.desc
		? `<div class="desc" data-act="edit-desc" title="Click to edit">${rich(t.desc)}</div>`
		: '<div class="desc empty-d" data-act="edit-desc">Add a description. Links become clickable. Type #12 to refer to task 12.</div>'
}

function relRow(x, rmAct, tip) {
	return `
		<div class="rel" data-act="open" data-id="${x.id}">${dot(x)}<span class="id">#${x.id}</span><span class="rel-t ${IX.open(x) ? '' : 'closed'}">${esc(x.title)}</span>${avatar(x.assignee, 'xs')}
		<button class="icon-btn sm" data-act="${rmAct}" data-id="${x.id}" title="${tip}">${I.x}</button></div>`
}

function fileHtml(f, i) {
	const url = '/files/' + encodeURIComponent(f.file)
	const rm = `<button class="icon-btn sm rm" data-act="rm-file" data-i="${i}" title="Remove this attachment">${I.x}</button>`
	if (/^image\/(png|jpeg|gif|webp)$/.test(f.type)) {
		return `<figure class="file img"><img src="${url}" alt="${esc(f.name)}" data-act="zoom-img" data-src="${url}" loading="lazy"><figcaption>${esc(f.name)}</figcaption>${rm}</figure>`
	}
	return `<div class="file doc"><a href="${url}" target="_blank" rel="noopener">${I.file}<span>${esc(f.name)}</span><small>${fmtSize(f.size)}</small></a>${rm}</div>`
}

function flushDesc() {
	const el = $('#drawer')
	const ta = $('.desc-edit', el)
	const t = ta ? IX.get(+el.dataset.id) : null
	if (t && ta.value.trim() !== t.desc) {
		t.desc = ta.value.trim()
		scheduleSave()
	}
}

function renderDrawer() {
	const el = $('#drawer')
	flushDesc()
	const t = ui.openId != null ? IX.get(ui.openId) : null
	if (!t) {
		ui.openId = null
		el.classList.remove('open')
		el.innerHTML = ''
		el.dataset.id = ''
		return
	}
	const oldBody = $('.dr-body', el)
	const scroll = oldBody && +el.dataset.id === t.id ? oldBody.scrollTop : 0
	el.dataset.id = t.id

	const parent = t.parent != null ? IX.get(t.parent) : null
	const kids = (IX.kids.get(t.id) || []).slice().sort((a, b) => a.id - b.id)
	const waits = t.deps.map(IX.get).filter(Boolean)
	const blocks = (IX.dependents.get(t.id) || []).map(IX.get)
	const related = relatedOf(t)
	const prog = IX.progress(t)
	const blockers = IX.blockers(t)
	const unl = IX.open(t) ? IX.unlocks(t) : 0

	let banner = ''
	if (blockers.length) {
		banner = `<div class="banner blk">${I.lock}<div><b>Blocked.</b> This task waits for ${blockers.map(b => `<a data-act="open" data-id="${b.id}">#${b.id} ${esc(b.title)}</a> (${ST[b.status].label}${b.assignee ? ', ' + esc(b.assignee) : ''})`).join(' and ')}.</div></div>`
	} else if (unl) {
		banner = `<div class="banner unl">${I.domino}<div><b>${unl} task${unl > 1 ? 's wait' : ' waits'} for this one.</b> ${IX.ready(t) ? 'Nothing blocks it. It is a good task to start.' : ''}</div></div>`
	}

	el.innerHTML = `
		<div class="dr-head">
			<span class="id big">#${t.id}</span>
			${parent ? `<a class="crumb-link" data-act="open" data-id="${parent.id}" title="Open the parent task">in #${parent.id} ${esc(parent.title)}</a>` : ''}
			<span class="sp"></span>
			<button class="icon-btn" data-act="delete" data-id="${t.id}" title="Delete this task">${I.trash}</button>
			<button class="icon-btn" data-act="close" title="Close (Esc)">${I.x}</button>
		</div>
		<div class="dr-body">
			<textarea class="dr-title" data-f="title" rows="1" placeholder="Task title" spellcheck="false">${esc(t.title)}</textarea>
			<div class="seg">${STATUSES.map(s => `<button class="seg-b s-${s.id} ${t.status === s.id ? 'on' : ''}" data-act="set-status" data-id="${t.id}" data-status="${s.id}">${s.label}</button>`).join('')}</div>
			${banner}
			<div class="fields">
				<div class="fld"><span>Assignee</span><input data-f="assignee" list="dl-assignee" value="${esc(t.assignee)}" placeholder="Nobody" autocomplete="off"></div>
				<div class="fld"><span>Domain</span><input data-f="domain" list="dl-domain" value="${esc(t.domain)}" placeholder="None" autocomplete="off"></div>
				<div class="fld"><span>Priority</span><select data-f="priority">${PRIOS.map(p => `<option value="${p.id}" ${t.priority === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
				<div class="fld"><span>Start</span><input type="date" data-f="start" value="${t.start || ''}"></div>
				<div class="fld"><span>Due</span><input type="date" data-f="due" value="${t.due || ''}"></div>
				<div class="fld"><span>Parent task</span>${parent
					? `<div class="parent-f"><a data-act="open" data-id="${parent.id}">#${parent.id} ${esc(parent.title)}</a><button class="icon-btn sm" data-act="unparent" title="Make this a top-level task">${I.x}</button></div>`
					: '<input class="pick" data-pick="parent" placeholder="None" autocomplete="off">'}</div>
			</div>
			<datalist id="dl-assignee">${names('assignee').map(n => `<option value="${esc(n)}">`).join('')}</datalist>
			<datalist id="dl-domain">${names('domain').map(n => `<option value="${esc(n)}">`).join('')}</datalist>

			<h4>Description</h4>
			${descView(t)}

			<h4>Attachments <small>Paste a screenshot (Cmd+V) or drop files here</small></h4>
			<div class="files">${t.files.map(fileHtml).join('')}<button class="file add" data-act="attach">${I.clip}<span>Attach a file</span></button></div>

			<h4>Links</h4>
			${t.links.map((l, i) => `<div class="lnk">${I.link}<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url.replace(/^https?:\/\//, ''))}</a><button class="icon-btn sm" data-act="rm-link" data-i="${i}" title="Remove this link">${I.x}</button></div>`).join('')}
			<input class="pick" data-in="link" placeholder="Paste a link, then press Enter. You can add a name after the link." autocomplete="off">

			<h4>Subtasks ${prog.total ? `<small>${prog.done} of ${prog.total} done</small>` : ''}</h4>
			${prog.total ? `<div class="prog wide"><i style="width:${(prog.done / prog.total) * 100}%"></i></div>` : ''}
			${kids.map(k => relRow(k, 'rm-sub', 'Make this a top-level task. The task is not deleted.')).join('')}
			<input class="pick" data-in="sub" placeholder="Add a subtask, then press Enter. The @ # ! tokens work here too." autocomplete="off">

			<h4>Dependencies</h4>
			<div class="dep-g"><span class="dep-l">Waits for</span><div>${waits.map(x => relRow(x, 'rm-dep', 'Remove this link. The task is not deleted.')).join('')}<input class="pick" data-pick="dep" placeholder="Find a task that must be done first" autocomplete="off"></div></div>
			<div class="dep-g"><span class="dep-l">Blocks</span><div>${blocks.map(x => relRow(x, 'rm-block', 'Remove this link. The task is not deleted.')).join('')}<input class="pick" data-pick="blocks" placeholder="Find a task that must wait for this one" autocomplete="off"></div></div>
			<div class="dep-g"><span class="dep-l">Related</span><div>${related.map(x => relRow(x, 'rm-rel', 'Remove this link. The task is not deleted.')).join('')}<input class="pick" data-pick="related" placeholder="Find a related task" autocomplete="off"></div></div>

			<details class="act"><summary>Activity</summary>${t.log.slice().reverse().map(l => `<div><span>${fmtWhen(l.at)}</span>${esc(l.what)}</div>`).join('')}</details>
		</div>`
	el.classList.add('open')
	$('.dr-body', el).scrollTop = scroll
	autoGrow($('.dr-title', el))
}

function autoGrow(ta) {
	if (!ta) return
	ta.style.height = 'auto'
	ta.style.height = ta.scrollHeight + (ta.offsetHeight - ta.clientHeight) + 'px'
}

function openTask(id) {
	if (!IX.get(id)) return
	ui.openId = id
	renderDrawer()
}

function closeDrawer() {
	ui.openId = null
	renderDrawer()
}

// ---------------------------------------------------------------- render

const VIEWS = { now: viewNow, board: viewBoard, list: viewList, timeline: viewTimeline, map: viewMap }
let lastView = null

function render(opts) {
	IX = buildIndex()
	const list = filtered()
	for (const b of $$('#tabs button')) b.classList.toggle('on', b.dataset.view === ui.view)
	$('#flt-btn').classList.toggle('on', !!ui.query.trim())
	renderFilterLine(list)
	renderView(list)
	if (!opts || !opts.keepDrawer) renderDrawer()
}

function renderFilterLine(list) {
	const el = $('#fline')
	const toks = ui.query.split(/\s+/).filter(Boolean)
	el.hidden = !toks.length
	if (!toks.length) {
		el.innerHTML = ''
		return
	}
	const total = db.tasks.filter(t => t.status !== 'cancelled').length
	el.innerHTML = '<span class="muted">Filter</span>'
		+ toks.map(tok => `<button class="ftok on" data-act="tok" data-tok="${esc(tok)}" title="Remove this filter">${esc(tok)}${I.x}</button>`).join('')
		+ `<span class="muted">${list.length} of ${total} tasks</span><button class="link" data-act="clear-filter">Clear</button>`
}

function renderView(list) {
	const v = $('#view')
	const keep = {}
	for (const el of $$('[data-scroll]', v)) keep[el.dataset.scroll] = [el.scrollLeft, el.scrollTop]
	const top = lastView === ui.view ? v.scrollTop : 0
	const typing = ui.addIn != null && document.activeElement === addInput() ? addInput() : null
	const caret = typing ? typing.selectionStart : 0
	if (typing) ui.addText = typing.value
	v.className = 'v-' + ui.view
	v.innerHTML = VIEWS[ui.view](list)
	for (const el of $$('[data-scroll]', v)) {
		const k = keep[el.dataset.scroll]
		if (k) {
			el.scrollLeft = k[0]
			el.scrollTop = k[1]
		}
	}
	v.scrollTop = top
	lastView = ui.view
	const again = typing ? addInput() : null
	if (again) {
		again.focus({ preventScroll: true })
		again.setSelectionRange(caret, caret)
		again.scrollIntoView({ block: 'nearest' })
	}
	const tl = $('.tl', v)
	if (tl && !ui.tlInit) {
		tl.scrollLeft = Math.max(0, +tl.dataset.today - 260)
		ui.tlInit = true
	}
}

function setView(view) {
	ui.view = view
	ui.tlInit = false
	saveUi()
	render({ keepDrawer: true })
}

// ---------------------------------------------------------------- popovers, suggestions, toasts

function openPop(anchor, html, cls) {
	const p = $('#pop')
	p.className = 'pop ' + (cls || '')
	p.innerHTML = html
	p.hidden = false
	const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor
	const w = p.offsetWidth
	const h = p.offsetHeight
	let y = r.bottom + 6
	if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6)
	p.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px'
	p.style.top = y + 'px'
}

function closePop() {
	$('#pop').hidden = true
}

function filterPanel() {
	function b(tok, label) {
		return `<button class="fp ${hasTok(tok) ? 'on' : ''}" data-act="tok" data-tok="${esc(tok)}" data-stay="1">${esc(label)}</button>`
	}
	return `
		<div class="fp-sec"><h5>Flow</h5>${b('is:ready', 'Ready')}${b('is:blocked', 'Blocked')}${b('is:overdue', 'Overdue')}${b('is:open', 'Open')}</div>
		<div class="fp-sec"><h5>Status</h5>${STATUSES.map(s => b('status:' + s.id, s.label)).join('')}</div>
		<div class="fp-sec"><h5>Assignee</h5>${names('assignee').map(n => b(tokName('@', n), n)).join('')}${b('@none', 'Nobody')}</div>
		<div class="fp-sec"><h5>Domain</h5>${names('domain').map(n => b(tokName('#', n), n)).join('')}${b('#none', 'None')}</div>
		<div class="fp-sec"><h5>Priority</h5>${PRIOS.map(p => b('!' + p.id, p.label)).join('')}</div>
		<div class="fp-sec"><h5>Due</h5>${b('due:today', 'Today')}${b('due:week', 'In 7 days')}${b('due:none', 'No date')}</div>
		<div class="fp-foot"><span class="muted">You can also type these filters.</span><button class="link" data-act="clear-filter">Clear all</button></div>`
}

function helpPanel() {
	const rows = [
		['@ana', 'Assignee'],
		['#web', 'Domain'],
		['!urgent !high !low', 'Priority'],
		['due:fri due:+3d due:20nov', 'Due date'],
		['start:mon', 'Start date'],
		['after:12', 'Waits for task 12'],
		['in:12', 'Subtask of task 12'],
		['status:doing', 'Status'],
		['is:ready is:blocked is:overdue', 'Filter only'],
	]
	const keys = [['N', 'Add a task'], ['/', 'Filter'], ['1 to 5', 'Change the view'], ['Esc', 'Close'], ['Cmd+Z', 'Undo'], ['Cmd+V', 'Paste a screenshot into the open task']]
	return `
		<h5>One line for everything</h5>
		<p class="muted">The bar to add a task and the filter use the same words.</p>
		<table>${rows.map(r => `<tr><td><code>${r[0]}</code></td><td>${r[1]}</td></tr>`).join('')}</table>
		<h5>Keys</h5>
		<table>${keys.map(r => `<tr><td><kbd>${r[0]}</kbd></td><td>${r[1]}</td></tr>`).join('')}</table>
		<h5>Blocked and ready</h5>
		<p class="muted">These are not statuses. A task is blocked while a task it waits for is open. When you complete that task, Domino tells you which tasks became free.</p>`
}

const sug = { items: [], idx: 0, input: null, onPick: null }

function showSug(input, items, onPick) {
	const el = $('#sug')
	if (!items.length) {
		hideSug()
		return
	}
	sug.items = items
	sug.idx = 0
	sug.input = input
	sug.onPick = onPick
	el.innerHTML = items.map((it, i) => `<div class="sug-i ${i === 0 ? 'on' : ''}" data-i="${i}">${it.html}</div>`).join('')
	el.hidden = false
	const r = input.getBoundingClientRect()
	el.style.minWidth = Math.min(r.width, 380) + 'px'
	el.style.left = Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8)) + 'px'
	let y = r.bottom + 4
	if (y + el.offsetHeight > innerHeight - 8) y = Math.max(8, r.top - el.offsetHeight - 4)
	el.style.top = y + 'px'
}

function hideSug() {
	$('#sug').hidden = true
	sug.input = null
}

function moveSug(step) {
	sug.idx = (sug.idx + step + sug.items.length) % sug.items.length
	$$('#sug .sug-i').forEach((el, i) => el.classList.toggle('on', i === sug.idx))
}

function pickSug(i) {
	const item = sug.items[i]
	const onPick = sug.onPick
	hideSug()
	if (item && onPick) onPick(item)
}

function taskSug(x) {
	return `<span class="dot s-${x.status} static"></span><span class="id">#${x.id}</span><b>${esc(x.title)}</b>`
}

/** Suggestions for the token at the caret in the capture bar or the filter. */
function tokenSuggest(input, mode) {
	const value = input.value
	const caret = input.selectionStart == null ? value.length : input.selectionStart
	const m = /(\S+)$/.exec(value.slice(0, caret))
	if (!m) {
		hideSug()
		return
	}
	const tok = m[1]
	const low = tok.toLowerCase()
	let items = []
	function item(full, label, note) {
		return { value: full, html: `<b>${esc(label)}</b>${note ? `<span>${esc(note)}</span>` : ''}` }
	}
	if (tok[0] === '@') {
		items = names('assignee').filter(n => norm(n).includes(norm(tok.slice(1)))).map(n => item(tokName('@', n), n))
		if (mode === 'filter' && 'none'.startsWith(low.slice(1))) items.push(item('@none', 'Nobody', 'no assignee'))
	} else if (tok[0] === '#') {
		items = names('domain').filter(n => norm(n).includes(norm(tok.slice(1)))).map(n => item(tokName('#', n), n))
	} else if (tok[0] === '!') {
		items = PRIOS.filter(p => p.id.startsWith(low.slice(1)) || p.label.toLowerCase().startsWith(low.slice(1))).map(p => item('!' + p.id, p.label, 'priority'))
	} else if (low.startsWith('status:')) {
		items = STATUSES.filter(s => (s.id + s.label.toLowerCase()).includes(low.slice(7))).map(s => item('status:' + s.id, s.label))
	} else if (low.startsWith('is:') && mode === 'filter') {
		items = IS_WORDS.filter(w => w.startsWith(low.slice(3))).map(w => item('is:' + w, w))
	} else if (low.startsWith('due:') || low.startsWith('start:')) {
		const key = low.split(':')[0]
		const q = low.slice(key.length + 1)
		const words = mode === 'filter' && key === 'due' ? DUE_WORDS.concat(['fri', '+2w']) : ['today', 'tomorrow', 'fri', 'mon', '+3d', '+1w', '+2w']
		items = words.filter(w => w.startsWith(q)).map(w => item(key + ':' + w, w, parseDateWord(w) ? fmtDate(parseDateWord(w)) : ''))
	} else if (low.startsWith('after:') || low.startsWith('in:')) {
		const key = low.split(':')[0]
		const q = low.slice(key.length + 1).replace('#', '')
		items = db.tasks.filter(t => t.status !== 'cancelled' && (!q || String(t.id).startsWith(q) || t.title.toLowerCase().includes(q)))
			.sort((a, b) => IX.open(b) - IX.open(a) || b.id - a.id)
			.map(t => ({ value: key + ':' + t.id, html: taskSug(t) }))
	}
	if (items.some(it => it.value.toLowerCase() === low)) items = []
	showSug(input, items.slice(0, 8), it => {
		input.value = value.slice(0, caret - tok.length) + it.value + ' ' + value.slice(caret).replace(/^\s+/, '')
		const at = caret - tok.length + it.value.length + 1
		input.setSelectionRange(at, at)
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
}

function pickSuggest(input) {
	const t = IX.get(ui.openId)
	if (!t) return
	const kind = input.dataset.pick
	const q = input.value.trim().toLowerCase().replace(/^#/, '')
	const allowed = {
		dep: x => !t.deps.includes(x.id) && !wouldCycle(t.id, x.id),
		blocks: x => !x.deps.includes(t.id) && !wouldCycle(x.id, t.id),
		related: x => !relatedOf(t).some(r => r.id === x.id),
		parent: x => !isUnder(x, t.id),
	}[kind]
	const items = db.tasks
		.filter(x => x.id !== t.id && x.status !== 'cancelled' && allowed(x) && (!q || String(x.id).startsWith(q) || x.title.toLowerCase().includes(q)))
		.sort((a, b) => IX.open(b) - IX.open(a) || b.id - a.id)
		.slice(0, 8)
		.map(x => ({ id: x.id, html: taskSug(x) }))
	showSug(input, items, it => applyPick(kind, t.id, it.id))
}

function applyPick(kind, id, otherId) {
	const t = IX.get(id)
	const x = IX.get(otherId)
	if (!t || !x) return
	mutate(() => {
		if (kind === 'dep') {
			t.deps.push(otherId)
			touch(t, 'Waits for #' + otherId)
		} else if (kind === 'blocks') {
			x.deps.push(id)
			touch(x, 'Waits for #' + id)
		} else if (kind === 'related') {
			t.related.push(otherId)
			touch(t, 'Related to #' + otherId)
		} else if (kind === 'parent') {
			t.parent = otherId
			touch(t, 'Moved into #' + otherId)
		}
	})
	const again = $(`#drawer [data-pick="${kind}"]`)
	if (again && kind !== 'parent') again.focus()
}

function toast(html, opts) {
	const o = opts || {}
	const el = document.createElement('div')
	el.className = 'toast'
	el.innerHTML = `<span>${html}</span>` + (o.action ? `<button class="btn sm">${esc(o.action)}</button>` : '')
	if (o.action) {
		$('button', el).addEventListener('click', () => {
			el.remove()
			o.fn()
		})
	}
	$('#toasts').append(el)
	setTimeout(() => el.remove(), o.ms || 5000)
}

// ---------------------------------------------------------------- sample project

function loadSample() {
	pushUndo()
	const t0 = today()
	const ids = {}
	function d(n) {
		return addDays(t0, n)
	}
	function add(key, props) {
		const p = Object.assign({}, props)
		if (p.parent) p.parent = ids[p.parent]
		p.deps = (p.deps || []).map(k => ids[k])
		const t = newTask(p)
		if (t.status === 'done') t.doneAt = Date.now() - 2 * DAY
		ids[key] = t.id
	}
	add('tiers', { title: 'Define the pricing tiers', domain: 'Product', assignee: 'Ana Ruiz', status: 'done', start: d(-12), due: d(-7), desc: 'Three tiers: Starter, Team, Enterprise.\nDecision record: https://example.com/pricing-decision' })
	add('design', { title: 'Design the pricing page', domain: 'Design', assignee: 'Chloe Park', status: 'doing', priority: 'high', start: d(-6), due: d(1), deps: ['tiers'] })
	add('wire', { title: 'Wireframes', parent: 'design', domain: 'Design', assignee: 'Chloe Park', status: 'done', start: d(-6), due: d(-3) })
	add('visual', { title: 'Visual design', parent: 'design', domain: 'Design', assignee: 'Chloe Park', status: 'doing', start: d(-3), due: d(0) })
	add('copy', { title: 'Copy review', parent: 'design', domain: 'Design', assignee: 'Ana Ruiz', status: 'todo', due: d(1) })
	add('api', { title: 'Billing API: plan endpoints', domain: 'API', assignee: 'Ben Carter', status: 'doing', priority: 'high', start: d(-5), due: d(3), deps: ['tiers'] })
	add('page', { title: 'Build the pricing page', domain: 'Web', assignee: 'Dev Shah', status: 'todo', start: d(2), due: d(9), deps: ['design', 'api'] })
	add('checkout', { title: 'Checkout integration', domain: 'Web', assignee: 'Dev Shah', status: 'todo', start: d(4), due: d(11), deps: ['api'] })
	add('tax', { title: 'Tax calculation rules', domain: 'API', assignee: 'Ben Carter', status: 'backlog', due: d(10), deps: ['api'] })
	add('e2e', { title: 'End-to-end test of the purchase flow', domain: 'QA', assignee: 'Ana Ruiz', status: 'todo', start: d(10), due: d(14), deps: ['page', 'checkout'] })
	add('legal', { title: 'Legal review of the new terms', domain: 'Legal', status: 'todo', priority: 'urgent', due: d(-1) })
	add('launch', { title: 'Launch announcement', domain: 'Marketing', assignee: 'Chloe Park', status: 'backlog', start: d(14), due: d(16), deps: ['e2e', 'legal'] })
	add('help', { title: 'Update the help center articles', domain: 'Marketing', status: 'todo', priority: 'low', due: d(15) })
	add('events', { title: 'Analytics events for the pricing page', domain: 'Web', assignee: 'Ben Carter', status: 'review', start: d(-3), due: d(0) })
	commit()
}

// ---------------------------------------------------------------- actions (clicks)

const ACT = {
	view: ({ d }) => setView(d.view),
	open: ({ id }) => openTask(id),
	close: () => closeDrawer(),
	noop: () => {},
	undo: () => undo(),
	sample: () => loadSample(),
	start: ({ id }) => setStatus(id, 'doing'),
	delete: ({ id }) => deleteTask(id),
	attach: () => $('#file-in').click(),
	'status-menu': ({ a, id }) => {
		const t = IX.get(id)
		openPop(a, STATUSES.map(s => `<button class="mi" data-act="set-status" data-id="${id}" data-status="${s.id}"><span class="dot s-${s.id} static"></span>${s.label}${t.status === s.id ? I.check : ''}</button>`).join(''), 'menu')
	},
	'set-status': ({ d, id }) => {
		closePop()
		setStatus(id, d.status)
	},
	'add-child': ({ id }) => {
		ui.addIn = id
		ui.addText = ''
		if (ui.collapsed.delete(id)) saveUi()
		render({ keepDrawer: true })
		const el = addInput()
		if (el) {
			el.focus({ preventScroll: true })
			el.scrollIntoView({ block: 'nearest' })
		}
	},
	collapse: ({ id }) => {
		if (ui.collapsed.has(id)) ui.collapsed.delete(id)
		else ui.collapsed.add(id)
		saveUi()
		render({ keepDrawer: true })
	},
	'expand-all': () => {
		ui.collapsed = new Set()
		saveUi()
		render({ keepDrawer: true })
	},
	'collapse-all': () => {
		ui.collapsed = new Set(Array.from(IX.kids.keys()))
		saveUi()
		render({ keepDrawer: true })
	},
	filters: ({ a }) => {
		if (!$('#pop').hidden && $('#pop').classList.contains('fpanel')) closePop()
		else openPop(a, filterPanel(), 'fpanel')
	},
	help: ({ a }) => openPop(a, helpPanel(), 'help'),
	tok: ({ d }) => {
		setTok(d.tok, d.add ? true : !hasTok(d.tok))
		if (d.go) ui.view = d.go
		saveUi()
		render({ keepDrawer: true })
		if (d.stay) openPop($('#flt-btn'), filterPanel(), 'fpanel')
	},
	'clear-filter': () => {
		ui.query = ''
		$('#flt').value = ''
		saveUi()
		closePop()
		render({ keepDrawer: true })
	},
	zoom: ({ d }) => {
		ui.zoom = d.zoom
		ui.tlInit = false
		saveUi()
		render({ keepDrawer: true })
	},
	'tl-today': () => {
		const tl = $('.tl')
		if (tl) tl.scrollTo({ left: Math.max(0, +tl.dataset.today - 260), behavior: 'smooth' })
	},
	'map-all': () => {
		ui.mapAll = !ui.mapAll
		saveUi()
		render({ keepDrawer: true })
	},
	'add-col': ({ d }) => {
		const input = $('#cap')
		input.value = d.status === 'todo' ? '' : 'status:' + d.status + ' '
		input.focus()
		renderPreview()
	},
	edge: ({ d, e }) => {
		openPop({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }, `<button class="mi" data-act="rm-edge" data-from="${d.from}" data-to="${d.to}">${I.x}Remove: #${d.to} waits for #${d.from}</button>`, 'menu')
	},
	'rm-edge': ({ d }) => {
		closePop()
		removeDep(+d.to, +d.from)
	},
	'rm-dep': ({ id }) => removeDep(ui.openId, id),
	'rm-block': ({ id }) => removeDep(id, ui.openId),
	'rm-rel': ({ id }) => {
		const t = IX.get(ui.openId)
		const x = IX.get(id)
		mutate(() => {
			t.related = t.related.filter(r => r !== id)
			x.related = x.related.filter(r => r !== t.id)
		})
	},
	'rm-sub': ({ id }) => {
		const x = IX.get(id)
		mutate(() => {
			x.parent = null
			touch(x, 'Made a top-level task')
		})
		toast(`#${id} is now a top-level task.`, { action: 'Undo', fn: undo })
	},
	unparent: () => {
		const t = IX.get(ui.openId)
		mutate(() => {
			t.parent = null
			touch(t, 'Made a top-level task')
		})
	},
	'rm-link': ({ d }) => {
		const t = IX.get(ui.openId)
		mutate(() => {
			t.links.splice(+d.i, 1)
		})
	},
	'rm-file': ({ d }) => {
		const t = IX.get(ui.openId)
		mutate(() => {
			const gone = t.files.splice(+d.i, 1)[0]
			touch(t, 'Removed the attachment ' + gone.name)
		})
		toast('The attachment is removed.', { action: 'Undo', fn: undo })
	},
	'edit-desc': () => {
		const t = IX.get(ui.openId)
		const view = $('#drawer .desc')
		if (!t || !view) return
		const ta = document.createElement('textarea')
		ta.className = 'desc-edit'
		ta.value = t.desc
		ta.placeholder = 'Write the details. You can paste a screenshot here.'
		// Same height as the text it replaces: the controls below do not move.
		ta.style.minHeight = view.offsetHeight + 'px'
		view.replaceWith(ta)
		autoGrow(ta)
		ta.focus()
	},
}

document.addEventListener('click', e => {
	if (e.target.closest('a[href]')) return
	const img = e.target.closest('img[data-act="zoom-img"]')
	if (img) {
		const box = $('#lightbox')
		$('img', box).src = img.dataset.src
		box.hidden = false
		return
	}
	if (e.target.closest('#lightbox')) {
		$('#lightbox').hidden = true
		return
	}
	const a = e.target.closest('[data-act]')
	if (!e.target.closest('#pop') && !(a && (a.dataset.act === 'filters' || a.dataset.act === 'help'))) closePop()
	// A click away from an empty subtask line closes the line.
	const prevAdd = ui.addIn
	const line = addInput()
	const dropAdd = prevAdd != null && !e.target.closest('.ladd') && (!line || !line.value.trim())
	if (dropAdd) ui.addIn = null
	if (!a) {
		const plain = e.target.closest('#view') && !e.target.closest('.bar, .mnode, input, select, textarea, button, a')
		if (plain && ui.openId != null) closeDrawer()
		if (dropAdd) settleAdd(prevAdd)
		return
	}
	const fn = ACT[a.dataset.act]
	if (fn) fn({ a, d: a.dataset, id: a.dataset.id != null ? +a.dataset.id : null, e })
	if (dropAdd) settleAdd(prevAdd)
})

// ---------------------------------------------------------------- other events

document.addEventListener('input', e => {
	const el = e.target
	if (el.id === 'cap') {
		renderPreview()
		tokenSuggest(el, 'new')
	} else if (el.id === 'flt') {
		ui.query = el.value
		saveUi()
		render({ keepDrawer: true })
		tokenSuggest(el, 'filter')
	} else if (el.dataset.in === 'row-sub') {
		ui.addText = el.value
		tokenSuggest(el, 'new')
	} else if (el.dataset.pick) {
		pickSuggest(el)
	} else if (el.matches('.dr-title, .desc-edit')) {
		autoGrow(el)
	}
})

document.addEventListener('focusin', e => {
	if (e.target.dataset && e.target.dataset.pick) pickSuggest(e.target)
})

document.addEventListener('focusout', e => {
	const el = e.target
	if (el === sug.input) setTimeout(() => (sug.input === el ? hideSug() : null), 150)
	if (el.dataset && el.dataset.in === 'row-sub' && el.isConnected && ui.addIn != null) ui.addText = el.value
	if (el.matches && el.matches('.desc-edit')) {
		const t = IX.get(ui.openId)
		if (!t || !el.isConnected) return
		const value = el.value.trim()
		if (value !== t.desc) {
			mutate(() => {
				t.desc = value
				touch(t, 'Changed the description')
			}, { keepDrawer: true })
		}
		const holder = document.createElement('div')
		holder.innerHTML = descView(t)
		if (el.isConnected) el.replaceWith(holder.firstElementChild)
	}
})

document.addEventListener('change', e => {
	const el = e.target
	if (el.id === 'file-in') {
		if (ui.openId != null) upload(ui.openId, Array.from(el.files))
		el.value = ''
		return
	}
	if (el.dataset.ch) {
		ui[el.dataset.ch] = el.value
		saveUi()
		render({ keepDrawer: true })
		return
	}
	const field = el.dataset.f
	const t = field && ui.openId != null ? IX.get(ui.openId) : null
	if (!t) return
	let value = el.value.trim()
	if (field === 'start' || field === 'due') value = value || null
	if (field === 'title' && !value) {
		el.value = t.title
		return
	}
	if (t[field] === value) return
	const notes = {
		title: 'Changed the title',
		assignee: 'Assignee: ' + (value || 'nobody'),
		domain: 'Domain: ' + (value || 'none'),
		priority: 'Priority: ' + (PR[value] ? PR[value].label : ''),
		start: 'Start: ' + (value ? fmtDate(value) : 'none'),
		due: 'Due: ' + (value ? fmtDate(value) : 'none'),
	}
	mutate(() => {
		t[field] = value
		touch(t, notes[field])
	}, { keepDrawer: true })
})

document.addEventListener('keydown', e => {
	const el = e.target
	const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)

	if (!$('#sug').hidden && el === sug.input) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault()
			moveSug(e.key === 'ArrowDown' ? 1 : -1)
			return
		}
		if (e.key === 'Enter' || e.key === 'Tab') {
			e.preventDefault()
			pickSug(sug.idx)
			return
		}
		if (e.key === 'Escape') {
			e.preventDefault()
			hideSug()
			return
		}
	}

	if (e.key === 'Escape') {
		if (!$('#lightbox').hidden) $('#lightbox').hidden = true
		else if (!$('#pop').hidden) closePop()
		else if (el.dataset && el.dataset.in === 'row-sub') closeAdd()
		else if (inField) el.blur()
		else if (ui.openId != null) closeDrawer()
		return
	}

	if (e.key === 'Enter' && inField) {
		if (el.id === 'cap') {
			submitCapture()
		} else if (el.matches('.dr-title')) {
			e.preventDefault()
			el.blur()
		} else if (el.matches('.desc-edit') && (e.metaKey || e.ctrlKey)) {
			el.blur()
		} else if (el.dataset.in === 'row-sub') {
			submitAdd(el)
		} else if (el.dataset.in === 'sub' && el.value.trim()) {
			const parentId = ui.openId
			const d = draft(el.value + ' in:' + parentId)
			if (!d.title) return
			mutate(() => {
				newTask(d)
			})
			const again = $('#drawer [data-in="sub"]')
			if (again) again.focus()
		} else if (el.dataset.in === 'link' && el.value.trim()) {
			if (addLink(ui.openId, el.value)) {
				const again = $('#drawer [data-in="link"]')
				if (again) again.focus()
			}
		}
		return
	}

	if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !inField) {
		e.preventDefault()
		undo()
		return
	}
	if (inField || e.metaKey || e.ctrlKey || e.altKey) return

	if (e.key === 'n' || e.key === 'N') {
		e.preventDefault()
		$('#cap').focus()
	} else if (e.key === '/') {
		e.preventDefault()
		$('#flt').focus()
		$('#flt').select()
	} else if (e.key === '?') {
		openPop($('[data-act="help"]'), helpPanel(), 'help')
	} else if (/^[1-5]$/.test(e.key)) {
		setView(VIEW_IDS[+e.key - 1])
	}
})

// Suggestion list: mousedown keeps the focus in the input.
$('#sug').addEventListener('mousedown', e => {
	const item = e.target.closest('.sug-i')
	if (!item) return
	e.preventDefault()
	pickSug(+item.dataset.i)
})

// Timeline bars and map ports.
$('#view').addEventListener('mousedown', e => {
	if (e.button !== 0) return
	const bar = e.target.closest('.bar')
	if (bar) {
		startBarDrag(e, bar)
		return
	}
	const port = e.target.closest('.port')
	if (port) startConnect(e, port)
})

$('#view').addEventListener('mouseover', e => {
	const node = e.target.closest('.mnode')
	if (node) highlightChain(+node.dataset.id)
})

$('#view').addEventListener('mouseout', e => {
	const node = e.target.closest('.mnode')
	if (node && !node.contains(e.relatedTarget)) clearChain()
})

// Board: drag a card to a column.
document.addEventListener('dragstart', e => {
	const cardEl = e.target.closest ? e.target.closest('.card') : null
	if (!cardEl) return
	e.dataTransfer.setData('text/domino-task', cardEl.dataset.id)
	e.dataTransfer.effectAllowed = 'move'
	cardEl.classList.add('dragging')
})

document.addEventListener('dragend', () => {
	for (const el of $$('.dragging, .over')) el.classList.remove('dragging', 'over')
})

function isFileDrag(e) {
	return Array.from(e.dataTransfer ? e.dataTransfer.types : []).includes('Files')
}

document.addEventListener('dragover', e => {
	if (isFileDrag(e)) {
		e.preventDefault()
		$('#drawer').classList.toggle('drop', !!e.target.closest('#drawer'))
		return
	}
	const col = e.target.closest ? e.target.closest('[data-drop]') : null
	for (const el of $$('.col.over')) if (el !== col) el.classList.remove('over')
	if (col) {
		e.preventDefault()
		col.classList.add('over')
	}
})

document.addEventListener('drop', e => {
	if (isFileDrag(e)) {
		e.preventDefault()
		$('#drawer').classList.remove('drop')
		if (e.target.closest('#drawer') && ui.openId != null) upload(ui.openId, Array.from(e.dataTransfer.files))
		else toast('Open a task first. Then drop the file on the task.')
		return
	}
	const col = e.target.closest ? e.target.closest('[data-drop]') : null
	const id = e.dataTransfer.getData('text/domino-task')
	if (col && id) {
		e.preventDefault()
		setStatus(+id, col.dataset.drop)
	}
})

// Paste a screenshot into the open task.
document.addEventListener('paste', e => {
	const files = Array.from(e.clipboardData ? e.clipboardData.files : [])
	if (!files.length) return
	e.preventDefault()
	if (ui.openId == null) {
		toast('Open a task first. Then paste the screenshot.')
		return
	}
	upload(ui.openId, files)
})

window.addEventListener('beforeunload', e => {
	if (dirty || saving) {
		e.preventDefault()
		e.returnValue = ''
	}
})

// ---------------------------------------------------------------- start

async function boot() {
	try {
		await load()
	} catch (error) {
		$('#view').innerHTML = '<div class="empty">Domino cannot read its data. Start the server again: <code>python3 server.py</code></div>'
		setSave('err')
		return
	}
	$('#flt').value = ui.query
	render()
	renderPreview()
	setInterval(poll, 4000)
}

boot()
