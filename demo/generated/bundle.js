/** @returns {void} */
function noop() {}

function run$1(fn) {
	return fn();
}

function blank_object() {
	return Object.create(null);
}

/**
 * @param {Function[]} fns
 * @returns {void}
 */
function run_all(fns) {
	fns.forEach(run$1);
}

/**
 * @param {any} thing
 * @returns {thing is Function}
 */
function is_function(thing) {
	return typeof thing === 'function';
}

/** @returns {boolean} */
function safe_not_equal(a, b) {
	return a != a ? b == b : a !== b || (a && typeof a === 'object') || typeof a === 'function';
}

/** @returns {boolean} */
function is_empty(obj) {
	return Object.keys(obj).length === 0;
}

/**
 * @param {Node} target
 * @param {Node} node
 * @param {Node} [anchor]
 * @returns {void}
 */
function insert(target, node, anchor) {
	target.insertBefore(node, anchor || null);
}

/**
 * @param {Node} node
 * @returns {void}
 */
function detach(node) {
	if (node.parentNode) {
		node.parentNode.removeChild(node);
	}
}

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} name
 * @returns {HTMLElementTagNameMap[K]}
 */
function element(name) {
	return document.createElement(name);
}

/**
 * @param {EventTarget} node
 * @param {string} event
 * @param {EventListenerOrEventListenerObject} handler
 * @param {boolean | AddEventListenerOptions | EventListenerOptions} [options]
 * @returns {() => void}
 */
function listen(node, event, handler, options) {
	node.addEventListener(event, handler, options);
	return () => node.removeEventListener(event, handler, options);
}

/**
 * @param {Element} node
 * @param {string} attribute
 * @param {string} [value]
 * @returns {void}
 */
function attr(node, attribute, value) {
	if (value == null) node.removeAttribute(attribute);
	else if (node.getAttribute(attribute) !== value) node.setAttribute(attribute, value);
}

/**
 * @param {Element} element
 * @returns {ChildNode[]}
 */
function children(element) {
	return Array.from(element.childNodes);
}

/**
 * @typedef {Node & {
 * 	claim_order?: number;
 * 	hydrate_init?: true;
 * 	actual_end_child?: NodeEx;
 * 	childNodes: NodeListOf<NodeEx>;
 * }} NodeEx
 */

/** @typedef {ChildNode & NodeEx} ChildNodeEx */

/** @typedef {NodeEx & { claim_order: number }} NodeEx2 */

/**
 * @typedef {ChildNodeEx[] & {
 * 	claim_info?: {
 * 		last_index: number;
 * 		total_claimed: number;
 * 	};
 * }} ChildNodeArray
 */

let current_component;

/** @returns {void} */
function set_current_component(component) {
	current_component = component;
}

function get_current_component() {
	if (!current_component) throw new Error('Function called outside component initialization');
	return current_component;
}

/**
 * The `onMount` function schedules a callback to run as soon as the component has been mounted to the DOM.
 * It must be called during the component's initialisation (but doesn't need to live *inside* the component;
 * it can be called from an external module).
 *
 * If a function is returned _synchronously_ from `onMount`, it will be called when the component is unmounted.
 *
 * `onMount` does not run inside a [server-side component](/docs#run-time-server-side-component-api).
 *
 * https://svelte.dev/docs/svelte#onmount
 * @template T
 * @param {() => import('./private.js').NotFunction<T> | Promise<import('./private.js').NotFunction<T>> | (() => any)} fn
 * @returns {void}
 */
function onMount(fn) {
	get_current_component().$$.on_mount.push(fn);
}

/**
 * Schedules a callback to run immediately before the component is unmounted.
 *
 * Out of `onMount`, `beforeUpdate`, `afterUpdate` and `onDestroy`, this is the
 * only one that runs inside a server-side component.
 *
 * https://svelte.dev/docs/svelte#ondestroy
 * @param {() => any} fn
 * @returns {void}
 */
function onDestroy(fn) {
	get_current_component().$$.on_destroy.push(fn);
}

const dirty_components = [];
const binding_callbacks = [];

let render_callbacks = [];

const flush_callbacks = [];

const resolved_promise = /* @__PURE__ */ Promise.resolve();

let update_scheduled = false;

/** @returns {void} */
function schedule_update() {
	if (!update_scheduled) {
		update_scheduled = true;
		resolved_promise.then(flush);
	}
}

/** @returns {void} */
function add_render_callback(fn) {
	render_callbacks.push(fn);
}

// flush() calls callbacks in this order:
// 1. All beforeUpdate callbacks, in order: parents before children
// 2. All bind:this callbacks, in reverse order: children before parents.
// 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
//    for afterUpdates called during the initial onMount, which are called in
//    reverse order: children before parents.
// Since callbacks might update component values, which could trigger another
// call to flush(), the following steps guard against this:
// 1. During beforeUpdate, any updated components will be added to the
//    dirty_components array and will cause a reentrant call to flush(). Because
//    the flush index is kept outside the function, the reentrant call will pick
//    up where the earlier call left off and go through all dirty components. The
//    current_component value is saved and restored so that the reentrant call will
//    not interfere with the "parent" flush() call.
// 2. bind:this callbacks cannot trigger new flush() calls.
// 3. During afterUpdate, any updated components will NOT have their afterUpdate
//    callback called a second time; the seen_callbacks set, outside the flush()
//    function, guarantees this behavior.
const seen_callbacks = new Set();

let flushidx = 0; // Do *not* move this inside the flush() function

/** @returns {void} */
function flush() {
	// Do not reenter flush while dirty components are updated, as this can
	// result in an infinite loop. Instead, let the inner flush handle it.
	// Reentrancy is ok afterwards for bindings etc.
	if (flushidx !== 0) {
		return;
	}
	const saved_component = current_component;
	do {
		// first, call beforeUpdate functions
		// and update components
		try {
			while (flushidx < dirty_components.length) {
				const component = dirty_components[flushidx];
				flushidx++;
				set_current_component(component);
				update(component.$$);
			}
		} catch (e) {
			// reset dirty state to not end up in a deadlocked state and then rethrow
			dirty_components.length = 0;
			flushidx = 0;
			throw e;
		}
		set_current_component(null);
		dirty_components.length = 0;
		flushidx = 0;
		while (binding_callbacks.length) binding_callbacks.pop()();
		// then, once components are updated, call
		// afterUpdate functions. This may cause
		// subsequent updates...
		for (let i = 0; i < render_callbacks.length; i += 1) {
			const callback = render_callbacks[i];
			if (!seen_callbacks.has(callback)) {
				// ...so guard against infinite loops
				seen_callbacks.add(callback);
				callback();
			}
		}
		render_callbacks.length = 0;
	} while (dirty_components.length);
	while (flush_callbacks.length) {
		flush_callbacks.pop()();
	}
	update_scheduled = false;
	seen_callbacks.clear();
	set_current_component(saved_component);
}

/** @returns {void} */
function update($$) {
	if ($$.fragment !== null) {
		$$.update();
		run_all($$.before_update);
		const dirty = $$.dirty;
		$$.dirty = [-1];
		$$.fragment && $$.fragment.p($$.ctx, dirty);
		$$.after_update.forEach(add_render_callback);
	}
}

/**
 * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
 * @param {Function[]} fns
 * @returns {void}
 */
function flush_render_callbacks(fns) {
	const filtered = [];
	const targets = [];
	render_callbacks.forEach((c) => (fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c)));
	targets.forEach((c) => c());
	render_callbacks = filtered;
}

const outroing = new Set();

/**
 * @type {Outro}
 */
let outros;

/**
 * @param {import('./private.js').Fragment} block
 * @param {0 | 1} [local]
 * @returns {void}
 */
function transition_in(block, local) {
	if (block && block.i) {
		outroing.delete(block);
		block.i(local);
	}
}

/**
 * @param {import('./private.js').Fragment} block
 * @param {0 | 1} local
 * @param {0 | 1} [detach]
 * @param {() => void} [callback]
 * @returns {void}
 */
function transition_out(block, local, detach, callback) {
	if (block && block.o) {
		if (outroing.has(block)) return;
		outroing.add(block);
		outros.c.push(() => {
			outroing.delete(block);
			if (callback) {
				if (detach) block.d(1);
				callback();
			}
		});
		block.o(local);
	} else if (callback) {
		callback();
	}
}

/** @typedef {1} INTRO */
/** @typedef {0} OUTRO */
/** @typedef {{ direction: 'in' | 'out' | 'both' }} TransitionOptions */
/** @typedef {(node: Element, params: any, options: TransitionOptions) => import('../transition/public.js').TransitionConfig} TransitionFn */

/**
 * @typedef {Object} Outro
 * @property {number} r
 * @property {Function[]} c
 * @property {Object} p
 */

/**
 * @typedef {Object} PendingProgram
 * @property {number} start
 * @property {INTRO|OUTRO} b
 * @property {Outro} [group]
 */

/**
 * @typedef {Object} Program
 * @property {number} a
 * @property {INTRO|OUTRO} b
 * @property {1|-1} d
 * @property {number} duration
 * @property {number} start
 * @property {number} end
 * @property {Outro} [group]
 */

/** @returns {void} */
function create_component(block) {
	block && block.c();
}

/** @returns {void} */
function mount_component(component, target, anchor) {
	const { fragment, after_update } = component.$$;
	fragment && fragment.m(target, anchor);
	// onMount happens before the initial afterUpdate
	add_render_callback(() => {
		const new_on_destroy = component.$$.on_mount.map(run$1).filter(is_function);
		// if the component was destroyed immediately
		// it will update the `$$.on_destroy` reference to `null`.
		// the destructured on_destroy may still reference to the old array
		if (component.$$.on_destroy) {
			component.$$.on_destroy.push(...new_on_destroy);
		} else {
			// Edge case - component was destroyed immediately,
			// most likely as a result of a binding initialising
			run_all(new_on_destroy);
		}
		component.$$.on_mount = [];
	});
	after_update.forEach(add_render_callback);
}

/** @returns {void} */
function destroy_component(component, detaching) {
	const $$ = component.$$;
	if ($$.fragment !== null) {
		flush_render_callbacks($$.after_update);
		run_all($$.on_destroy);
		$$.fragment && $$.fragment.d(detaching);
		// TODO null out other refs, including component.$$ (but need to
		// preserve final state?)
		$$.on_destroy = $$.fragment = null;
		$$.ctx = [];
	}
}

/** @returns {void} */
function make_dirty(component, i) {
	if (component.$$.dirty[0] === -1) {
		dirty_components.push(component);
		schedule_update();
		component.$$.dirty.fill(0);
	}
	component.$$.dirty[(i / 31) | 0] |= 1 << i % 31;
}

/** @returns {void} */
function init(
	component,
	options,
	instance,
	create_fragment,
	not_equal,
	props,
	append_styles,
	dirty = [-1]
) {
	const parent_component = current_component;
	set_current_component(component);
	/** @type {import('./private.js').T$$} */
	const $$ = (component.$$ = {
		fragment: null,
		ctx: [],
		// state
		props,
		update: noop,
		not_equal,
		bound: blank_object(),
		// lifecycle
		on_mount: [],
		on_destroy: [],
		on_disconnect: [],
		before_update: [],
		after_update: [],
		context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
		// everything else
		callbacks: blank_object(),
		dirty,
		skip_bound: false,
		root: options.target || parent_component.$$.root
	});
	append_styles && append_styles($$.root);
	let ready = false;
	$$.ctx = instance
		? instance(component, options.props || {}, (i, ret, ...rest) => {
				const value = rest.length ? rest[0] : ret;
				if ($$.ctx && not_equal($$.ctx[i], ($$.ctx[i] = value))) {
					if (!$$.skip_bound && $$.bound[i]) $$.bound[i](value);
					if (ready) make_dirty(component, i);
				}
				return ret;
		  })
		: [];
	$$.update();
	ready = true;
	run_all($$.before_update);
	// `false` as a special case of no DOM component
	$$.fragment = create_fragment ? create_fragment($$.ctx) : false;
	if (options.target) {
		if (options.hydrate) {
			const nodes = children(options.target);
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			$$.fragment && $$.fragment.l(nodes);
			nodes.forEach(detach);
		} else {
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			$$.fragment && $$.fragment.c();
		}
		if (options.intro) transition_in(component.$$.fragment);
		mount_component(component, options.target, options.anchor);
		flush();
	}
	set_current_component(parent_component);
}

/**
 * Base class for Svelte components. Used when dev=false.
 *
 * @template {Record<string, any>} [Props=any]
 * @template {Record<string, any>} [Events=any]
 */
class SvelteComponent {
	/**
	 * ### PRIVATE API
	 *
	 * Do not use, may change at any time
	 *
	 * @type {any}
	 */
	$$ = undefined;
	/**
	 * ### PRIVATE API
	 *
	 * Do not use, may change at any time
	 *
	 * @type {any}
	 */
	$$set = undefined;

	/** @returns {void} */
	$destroy() {
		destroy_component(this, 1);
		this.$destroy = noop;
	}

	/**
	 * @template {Extract<keyof Events, string>} K
	 * @param {K} type
	 * @param {((e: Events[K]) => void) | null | undefined} callback
	 * @returns {() => void}
	 */
	$on(type, callback) {
		if (!is_function(callback)) {
			return noop;
		}
		const callbacks = this.$$.callbacks[type] || (this.$$.callbacks[type] = []);
		callbacks.push(callback);
		return () => {
			const index = callbacks.indexOf(callback);
			if (index !== -1) callbacks.splice(index, 1);
		};
	}

	/**
	 * @param {Partial<Props>} props
	 * @returns {void}
	 */
	$set(props) {
		if (this.$$set && !is_empty(props)) {
			this.$$.skip_bound = true;
			this.$$set(props);
			this.$$.skip_bound = false;
		}
	}
}

/**
 * @typedef {Object} CustomElementPropDefinition
 * @property {string} [attribute]
 * @property {boolean} [reflect]
 * @property {'String'|'Boolean'|'Number'|'Array'|'Object'} [type]
 */

// generated during release, do not modify

const PUBLIC_VERSION = '4';

if (typeof window !== 'undefined')
	// @ts-ignore
	(window.__svelte || (window.__svelte = { v: new Set() })).v.add(PUBLIC_VERSION);

// web_sys does not provide this functionality out of the box 
// (perhaps because of low-ish browser support?)
// so it must be implemented manually here in JavaScript
function captureStreamFromCanvas(canvas) {
    const mediaStream = canvas.captureStream();
    return mediaStream;
}

let wasm$1;

const heap = new Array(128).fill(undefined);

heap.push(undefined, null, true, false);

function getObject(idx) { return heap[idx]; }

let heap_next = heap.length;

function dropObject(idx) {
    if (idx < 132) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

const cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : { decode: () => { throw Error('TextDecoder not available') } } );

if (typeof TextDecoder !== 'undefined') { cachedTextDecoder.decode(); }
let cachedUint8Memory0 = null;

function getUint8Memory0() {
    if (cachedUint8Memory0 === null || cachedUint8Memory0.byteLength === 0) {
        cachedUint8Memory0 = new Uint8Array(wasm$1.memory.buffer);
    }
    return cachedUint8Memory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

const cachedTextEncoder = (typeof TextEncoder !== 'undefined' ? new TextEncoder('utf-8') : { encode: () => { throw Error('TextEncoder not available') } } );

const encodeString = (typeof cachedTextEncoder.encodeInto === 'function'
    ? function (arg, view) {
    return cachedTextEncoder.encodeInto(arg, view);
}
    : function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
        read: arg.length,
        written: buf.length
    };
});

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8Memory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8Memory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8Memory0().subarray(ptr + offset, ptr + len);
        const ret = encodeString(arg, view);

        offset += ret.written;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

let cachedInt32Memory0 = null;

function getInt32Memory0() {
    if (cachedInt32Memory0 === null || cachedInt32Memory0.byteLength === 0) {
        cachedInt32Memory0 = new Int32Array(wasm$1.memory.buffer);
    }
    return cachedInt32Memory0;
}

let cachedFloat64Memory0 = null;

function getFloat64Memory0() {
    if (cachedFloat64Memory0 === null || cachedFloat64Memory0.byteLength === 0) {
        cachedFloat64Memory0 = new Float64Array(wasm$1.memory.buffer);
    }
    return cachedFloat64Memory0;
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function makeMutClosure(arg0, arg1, dtor, f) {
    const state = { a: arg0, b: arg1, cnt: 1, dtor };
    const real = (...args) => {
        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            if (--state.cnt === 0) {
                wasm$1.__wbindgen_export_2.get(state.dtor)(a, state.b);

            } else {
                state.a = a;
            }
        }
    };
    real.original = state;

    return real;
}
function __wbg_adapter_34(arg0, arg1, arg2) {
    wasm$1._dyn_core__ops__function__FnMut__A____Output___R_as_wasm_bindgen__closure__WasmClosure___describe__invoke__h4c244a944587955e(arg0, arg1, addHeapObject(arg2));
}

function __wbg_adapter_39(arg0, arg1) {
    wasm$1._dyn_core__ops__function__FnMut_____Output___R_as_wasm_bindgen__closure__WasmClosure___describe__invoke__h1d4cd696787ca31b(arg0, arg1);
}

function makeClosure(arg0, arg1, dtor, f) {
    const state = { a: arg0, b: arg1, cnt: 1, dtor };
    const real = (...args) => {
        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        try {
            return f(state.a, state.b, ...args);
        } finally {
            if (--state.cnt === 0) {
                wasm$1.__wbindgen_export_2.get(state.dtor)(state.a, state.b);
                state.a = 0;

            }
        }
    };
    real.original = state;

    return real;
}
function __wbg_adapter_54(arg0, arg1) {
    wasm$1._dyn_core__ops__function__Fn_____Output___R_as_wasm_bindgen__closure__WasmClosure___describe__invoke__h9d4fd89c0cc0ee02(arg0, arg1);
}

function __wbg_adapter_57(arg0, arg1, arg2) {
    wasm$1._dyn_core__ops__function__Fn__A____Output___R_as_wasm_bindgen__closure__WasmClosure___describe__invoke__h3350349ba0fde29a(arg0, arg1, addHeapObject(arg2));
}

function __wbg_adapter_64(arg0, arg1, arg2) {
    wasm$1._dyn_core__ops__function__FnMut__A____Output___R_as_wasm_bindgen__closure__WasmClosure___describe__invoke__hb6f44675c044e929(arg0, arg1, addHeapObject(arg2));
}

function __wbg_adapter_67(arg0, arg1, arg2) {
    wasm$1._dyn_core__ops__function__FnMut__A____Output___R_as_wasm_bindgen__closure__WasmClosure___describe__invoke__he44d4da478a4a98b(arg0, arg1, addHeapObject(arg2));
}

/**
* @param {HTMLCanvasElement} canvas
* @param {number} canvas_width
* @param {number} canvas_height
* @returns {Promise<void>}
*/
function run(canvas, canvas_width, canvas_height) {
    const ret = wasm$1.run(addHeapObject(canvas), canvas_width, canvas_height);
    return takeObject(ret);
}

/**
* @returns {boolean}
*/
function isRunning() {
    const ret = wasm$1.isRunning();
    return ret !== 0;
}

/**
* @param {number} new_width
* @param {number} new_height
*/
function handleResize(new_width, new_height) {
    wasm$1.handleResize(new_width, new_height);
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
    return instance.ptr;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm$1.__wbindgen_exn_store(addHeapObject(e));
    }
}

let cachedUint32Memory0 = null;

function getUint32Memory0() {
    if (cachedUint32Memory0 === null || cachedUint32Memory0.byteLength === 0) {
        cachedUint32Memory0 = new Uint32Array(wasm$1.memory.buffer);
    }
    return cachedUint32Memory0;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32Memory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8Memory0().subarray(ptr / 1, ptr / 1 + len);
}
function __wbg_adapter_552(arg0, arg1, arg2, arg3) {
    wasm$1.wasm_bindgen__convert__closures__invoke2_mut__h5241de399e324088(arg0, arg1, addHeapObject(arg2), addHeapObject(arg3));
}

function notDefined(what) { return () => { throw new Error(`${what} is not defined`); }; }
/**
*/
class Attribute {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Attribute.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_attribute_free(ptr);
    }
    /**
    * @returns {StringArray}
    */
    VAOIds() {
        const ret = wasm$1.attribute_VAOIds(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {string}
    */
    bufferId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.attribute_bufferId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @returns {WebGLBuffer}
    */
    webglBuffer() {
        const ret = wasm$1.attribute_webglBuffer(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {AttributeLocation}
    */
    attributeLocation() {
        const ret = wasm$1.attribute_attributeLocation(this.__wbg_ptr);
        return AttributeLocation.__wrap(ret);
    }
}
/**
*/
class AttributeCreateContext {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(AttributeCreateContext.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_attributecreatecontext_free(ptr);
    }
    /**
    * @returns {WebGL2RenderingContext}
    */
    gl() {
        const ret = wasm$1.attributecreatecontext_gl(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {number}
    */
    now() {
        const ret = wasm$1.attributecreatecontext_now(this.__wbg_ptr);
        return ret;
    }
    /**
    * @returns {WebGLBuffer}
    */
    webglBuffer() {
        const ret = wasm$1.attributecreatecontext_webglBuffer(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {AttributeLocation}
    */
    attributeLocation() {
        const ret = wasm$1.attributecreatecontext_attributeLocation(this.__wbg_ptr);
        return AttributeLocation.__wrap(ret);
    }
}
/**
*/
class AttributeLink {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(AttributeLink.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_attributelink_free(ptr);
    }
    /**
    * @param {StringArray} vao_ids
    * @param {string} buffer_id
    * @param {string} attribute_id
    * @param {AttributeCreateCallbackJs} attribute_create_callback
    */
    constructor(vao_ids, buffer_id, attribute_id, attribute_create_callback) {
        const ptr0 = passStringToWasm0(buffer_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(attribute_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm$1.attributelink_new(addHeapObject(vao_ids), ptr0, len0, ptr1, len1, addHeapObject(attribute_create_callback));
        return AttributeLink.__wrap(ret);
    }
    /**
    * @returns {StringArray}
    */
    VAOIds() {
        const ret = wasm$1.attributelink_VAOIds(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {string}
    */
    bufferId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.attributelink_bufferId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @returns {string}
    */
    attributeId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.attributelink_attributeId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @returns {AttributeCreateCallbackJs | undefined}
    */
    createCallback() {
        const ret = wasm$1.attributelink_createCallback(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {WebGL2RenderingContext} gl
    * @param {number} now
    * @param {WebGLBuffer} webgl_buffer
    * @param {AttributeLocation} attribute_location
    */
    createAttribute(gl, now, webgl_buffer, attribute_location) {
        _assertClass(attribute_location, AttributeLocation);
        var ptr0 = attribute_location.__destroy_into_raw();
        wasm$1.attributelink_createAttribute(this.__wbg_ptr, addHeapObject(gl), now, addHeapObject(webgl_buffer), ptr0);
    }
}
/**
* Wrapper around the raw number returned from WebGL to represent an attribute location
*/
class AttributeLocation {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(AttributeLocation.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_attributelocation_free(ptr);
    }
    /**
    * @returns {number}
    */
    get() {
        const ret = wasm$1.attributelocation_get(this.__wbg_ptr);
        return ret >>> 0;
    }
}
/**
*/
let Buffer$1 = class Buffer {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Buffer.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_buffer_free(ptr);
    }
    /**
    * @returns {string}
    */
    bufferId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.buffer_bufferId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @returns {WebGLBuffer}
    */
    webglBuffer() {
        const ret = wasm$1.buffer_webglBuffer(this.__wbg_ptr);
        return takeObject(ret);
    }
};
/**
*/
class BufferCreateContext {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(BufferCreateContext.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_buffercreatecontext_free(ptr);
    }
    /**
    * @returns {WebGL2RenderingContext}
    */
    gl() {
        const ret = wasm$1.buffercreatecontext_gl(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {number}
    */
    now() {
        const ret = wasm$1.buffercreatecontext_now(this.__wbg_ptr);
        return ret;
    }
}
/**
*/
class BufferLink {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(BufferLink.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_bufferlink_free(ptr);
    }
    /**
    * @param {string} buffer_id
    * @param {BufferCreateCallbackJs} buffer_create_callback
    */
    constructor(buffer_id, buffer_create_callback) {
        const ptr0 = passStringToWasm0(buffer_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.bufferlink_new(ptr0, len0, addHeapObject(buffer_create_callback));
        return BufferLink.__wrap(ret);
    }
    /**
    * @returns {string}
    */
    bufferId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.bufferlink_bufferId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @param {WebGL2RenderingContext} gl
    * @param {number} now
    * @returns {WebGLBuffer}
    */
    createBuffer(gl, now) {
        const ret = wasm$1.bufferlink_createBuffer(this.__wbg_ptr, addHeapObject(gl), now);
        return takeObject(ret);
    }
}
/**
*/
class Framebuffer {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Framebuffer.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_framebuffer_free(ptr);
    }
    /**
    * @returns {string}
    */
    framebufferId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.framebuffer_framebufferId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @returns {WebGLFramebuffer}
    */
    webglFramebuffer() {
        const ret = wasm$1.framebuffer_webglFramebuffer(this.__wbg_ptr);
        return takeObject(ret);
    }
}
/**
*/
class FramebufferCreateContext {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(FramebufferCreateContext.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_framebuffercreatecontext_free(ptr);
    }
    /**
    * @param {WebGL2RenderingContext} gl
    * @param {number} now
    * @param {WebGLTexture | undefined} webgl_texture
    */
    constructor(gl, now, webgl_texture) {
        const ret = wasm$1.framebuffercreatecontext_new(addHeapObject(gl), now, isLikeNone(webgl_texture) ? 0 : addHeapObject(webgl_texture));
        return FramebufferCreateContext.__wrap(ret);
    }
    /**
    * @returns {WebGL2RenderingContext}
    */
    gl() {
        const ret = wasm$1.framebuffercreatecontext_gl(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {number}
    */
    now() {
        const ret = wasm$1.framebuffercreatecontext_now(this.__wbg_ptr);
        return ret;
    }
    /**
    * @returns {WebGLTexture | undefined}
    */
    webglTexture() {
        const ret = wasm$1.framebuffercreatecontext_webglTexture(this.__wbg_ptr);
        return takeObject(ret);
    }
}
/**
*/
class FramebufferLink {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(FramebufferLink.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_framebufferlink_free(ptr);
    }
    /**
    * @param {string} framebuffer_id
    * @param {FramebufferCreateCallbackJs} framebuffer_create_callback
    * @param {string | undefined} texture_id
    */
    constructor(framebuffer_id, framebuffer_create_callback, texture_id) {
        const ptr0 = passStringToWasm0(framebuffer_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(texture_id) ? 0 : passStringToWasm0(texture_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm$1.framebufferlink_new(ptr0, len0, addHeapObject(framebuffer_create_callback), ptr1, len1);
        return FramebufferLink.__wrap(ret);
    }
    /**
    * @returns {string}
    */
    framebufferId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.framebufferlink_framebufferId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @returns {string | undefined}
    */
    textureId() {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.framebufferlink_textureId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1).slice();
                wasm$1.__wbindgen_free(r0, r1 * 1);
            }
            return v1;
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {WebGL2RenderingContext} gl
    * @param {number} now
    * @param {WebGLTexture | undefined} texture
    * @returns {WebGLFramebuffer}
    */
    createFramebuffer(gl, now, texture) {
        const ret = wasm$1.framebufferlink_createFramebuffer(this.__wbg_ptr, addHeapObject(gl), now, isLikeNone(texture) ? 0 : addHeapObject(texture));
        return takeObject(ret);
    }
}
/**
*/
class ProgramLink {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ProgramLink.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_programlink_free(ptr);
    }
    /**
    * @param {string} program_id
    * @param {string} vertex_shader_id
    * @param {string} fragment_shader_id
    */
    constructor(program_id, vertex_shader_id, fragment_shader_id) {
        const ptr0 = passStringToWasm0(program_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(vertex_shader_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(fragment_shader_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm$1.programlink_new(ptr0, len0, ptr1, len1, ptr2, len2);
        return ProgramLink.__wrap(ret);
    }
    /**
    * @returns {string}
    */
    programId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.programlink_programId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @returns {string}
    */
    vertexShaderId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.attributelink_bufferId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @returns {string}
    */
    fragmentShaderId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.attributelink_attributeId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @returns {StringArray}
    */
    transformFeedbackVaryings() {
        const ret = wasm$1.programlink_transformFeedbackVaryings(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {ProgramLinkBuilder}
    */
    static builder() {
        const ret = wasm$1.programlink_builder();
        return ProgramLinkBuilder.__wrap(ret);
    }
}
/**
*/
class ProgramLinkBuilder {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ProgramLinkBuilder.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_programlinkbuilder_free(ptr);
    }
    /**
    * @returns {ProgramLinkBuilder}
    */
    static default() {
        const ret = wasm$1.programlinkbuilder_default();
        return ProgramLinkBuilder.__wrap(ret);
    }
    /**
    */
    constructor() {
        const ret = wasm$1.programlinkbuilder_default();
        return ProgramLinkBuilder.__wrap(ret);
    }
    /**
    * @param {string} program_id
    */
    setProgramId(program_id) {
        const ptr0 = passStringToWasm0(program_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm$1.programlinkbuilder_setProgramId(this.__wbg_ptr, ptr0, len0);
    }
    /**
    * @param {string} vertex_shader_id
    */
    setVertexShaderId(vertex_shader_id) {
        const ptr0 = passStringToWasm0(vertex_shader_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm$1.programlinkbuilder_setVertexShaderId(this.__wbg_ptr, ptr0, len0);
    }
    /**
    * @param {string} fragment_shader_id
    */
    setFragmentShaderId(fragment_shader_id) {
        const ptr0 = passStringToWasm0(fragment_shader_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm$1.programlinkbuilder_setFragmentShaderId(this.__wbg_ptr, ptr0, len0);
    }
    /**
    * @param {StringArray} transform_feedback_varyings
    */
    setTransformFeedbackVaryings(transform_feedback_varyings) {
        wasm$1.programlinkbuilder_setTransformFeedbackVaryings(this.__wbg_ptr, addHeapObject(transform_feedback_varyings));
    }
    /**
    * @returns {ProgramLink}
    */
    build() {
        try {
            const ptr = this.__destroy_into_raw();
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.programlinkbuilder_build(retptr, ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return ProgramLink.__wrap(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
/**
*/
class Renderer {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Renderer.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_renderer_free(ptr);
    }
    /**
    */
    initializeRecorder() {
        wasm$1.renderer_initializeRecorder(this.__wbg_ptr);
    }
    /**
    */
    startAnimating() {
        wasm$1.renderer_startAnimating(this.__wbg_ptr);
    }
    /**
    */
    stopAnimating() {
        wasm$1.renderer_stopAnimating(this.__wbg_ptr);
    }
    /**
    * @param {AnimationCallbackJs | undefined} animation_callback
    */
    setAnimationCallback(animation_callback) {
        wasm$1.renderer_setAnimationCallback(this.__wbg_ptr, isLikeNone(animation_callback) ? 0 : addHeapObject(animation_callback));
    }
    /**
    */
    startRecording() {
        wasm$1.renderer_startRecording(this.__wbg_ptr);
    }
    /**
    */
    stopRecording() {
        wasm$1.renderer_stopRecording(this.__wbg_ptr);
    }
    /**
    */
    clearRecordedData() {
        wasm$1.renderer_clearRecordedData(this.__wbg_ptr);
    }
    /**
    * @returns {boolean}
    */
    recorderInitialized() {
        const ret = wasm$1.renderer_recorderInitialized(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
    * @returns {boolean}
    */
    isAnimating() {
        const ret = wasm$1.renderer_isAnimating(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
    * @returns {boolean}
    */
    isRecording() {
        const ret = wasm$1.renderer_isRecording(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
    * @returns {RendererData}
    */
    rendererData() {
        const ret = wasm$1.renderer_rendererData(this.__wbg_ptr);
        return RendererData.__wrap(ret);
    }
    /**
    * @returns {RendererDataBuilder}
    */
    static builder() {
        const ret = wasm$1.renderer_builder();
        return RendererDataBuilder.__wrap(ret);
    }
    /**
    * @returns {HTMLCanvasElement}
    */
    canvas() {
        const ret = wasm$1.renderer_canvas(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {WebGL2RenderingContext}
    */
    gl() {
        const ret = wasm$1.renderer_gl(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {string} fragment_shader_id
    * @returns {WebGLShader | undefined}
    */
    fragmentShader(fragment_shader_id) {
        const ptr0 = passStringToWasm0(fragment_shader_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.renderer_fragmentShader(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
    * @param {string} vertex_shader_id
    * @returns {WebGLShader | undefined}
    */
    vertexShader(vertex_shader_id) {
        const ptr0 = passStringToWasm0(vertex_shader_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.renderer_vertexShader(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
    * @param {string} program_id
    * @returns {WebGLProgram | undefined}
    */
    program(program_id) {
        const ptr0 = passStringToWasm0(program_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.renderer_program(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
    * @param {string} uniform_id
    * @returns {Uniform | undefined}
    */
    uniform(uniform_id) {
        const ptr0 = passStringToWasm0(uniform_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.renderer_uniform(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : Uniform.__wrap(ret);
    }
    /**
    * @param {string} buffer_id
    * @returns {Buffer | undefined}
    */
    buffer(buffer_id) {
        const ptr0 = passStringToWasm0(buffer_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.renderer_buffer(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : Buffer$1.__wrap(ret);
    }
    /**
    * @param {string} attribute_id
    * @returns {Attribute | undefined}
    */
    attribute(attribute_id) {
        const ptr0 = passStringToWasm0(attribute_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.renderer_attribute(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : Attribute.__wrap(ret);
    }
    /**
    * @param {string} texture_id
    * @returns {Texture | undefined}
    */
    texture(texture_id) {
        const ptr0 = passStringToWasm0(texture_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.renderer_texture(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : Texture.__wrap(ret);
    }
    /**
    * @param {string} framebuffer_id
    * @returns {Framebuffer | undefined}
    */
    framebuffer(framebuffer_id) {
        const ptr0 = passStringToWasm0(framebuffer_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.renderer_framebuffer(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : Framebuffer.__wrap(ret);
    }
    /**
    * @param {string} transform_feedback_id
    * @returns {WebGLTransformFeedback | undefined}
    */
    transformFeedback(transform_feedback_id) {
        const ptr0 = passStringToWasm0(transform_feedback_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.renderer_transformFeedback(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
    * @param {string} vao_id
    * @returns {WebGLVertexArrayObject | undefined}
    */
    vao(vao_id) {
        const ptr0 = passStringToWasm0(vao_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.renderer_vao(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
    * @returns {object | undefined}
    */
    userCtx() {
        const ret = wasm$1.renderer_userCtx(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {string} program_id
    */
    useProgram(program_id) {
        const ptr0 = passStringToWasm0(program_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm$1.renderer_useProgram(this.__wbg_ptr, ptr0, len0);
    }
    /**
    * @param {string} vao_id
    */
    useVAO(vao_id) {
        const ptr0 = passStringToWasm0(vao_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm$1.renderer_useVAO(this.__wbg_ptr, ptr0, len0);
    }
    /**
    * @param {string} uniform_id
    */
    updateUniform(uniform_id) {
        const ptr0 = passStringToWasm0(uniform_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm$1.renderer_updateUniform(this.__wbg_ptr, ptr0, len0);
    }
    /**
    */
    updateUniforms() {
        wasm$1.renderer_updateUniforms(this.__wbg_ptr);
    }
    /**
    */
    render() {
        wasm$1.renderer_render(this.__wbg_ptr);
    }
    /**
    */
    saveImage() {
        wasm$1.renderer_saveImage(this.__wbg_ptr);
    }
    /**
    * @returns {RenderCallbackJs | undefined}
    */
    renderCallback() {
        const ret = wasm$1.renderer_renderCallback(this.__wbg_ptr);
        return takeObject(ret);
    }
}
/**
*/
class RendererData {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(RendererData.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_rendererdata_free(ptr);
    }
    /**
    * @returns {RendererDataBuilder}
    */
    static builder() {
        const ret = wasm$1.rendererdata_builder();
        return RendererDataBuilder.__wrap(ret);
    }
    /**
    * @returns {HTMLCanvasElement}
    */
    canvas() {
        const ret = wasm$1.rendererdata_canvas(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {WebGL2RenderingContext}
    */
    gl() {
        const ret = wasm$1.rendererdata_gl(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {string} fragment_shader_id
    * @returns {WebGLShader | undefined}
    */
    fragmentShader(fragment_shader_id) {
        const ptr0 = passStringToWasm0(fragment_shader_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.rendererdata_fragmentShader(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
    * @returns {WebGlShaderMap}
    */
    fragmentShaders() {
        const ret = wasm$1.rendererdata_fragmentShaders(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {string} vertex_shader_id
    * @returns {WebGLShader | undefined}
    */
    vertexShader(vertex_shader_id) {
        const ptr0 = passStringToWasm0(vertex_shader_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.rendererdata_vertexShader(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
    * @returns {WebGlShaderMap}
    */
    vertexShaders() {
        const ret = wasm$1.rendererdata_vertexShaders(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {string} program_id
    * @returns {WebGLProgram | undefined}
    */
    program(program_id) {
        const ptr0 = passStringToWasm0(program_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.rendererdata_program(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
    * @returns {WebGlProgramMap}
    */
    programs() {
        const ret = wasm$1.rendererdata_programs(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {string} uniform_id
    * @returns {Uniform | undefined}
    */
    uniform(uniform_id) {
        const ptr0 = passStringToWasm0(uniform_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.rendererdata_uniform(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : Uniform.__wrap(ret);
    }
    /**
    * @returns {UniformMap}
    */
    uniforms() {
        const ret = wasm$1.rendererdata_uniforms(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {string} buffer_id
    * @returns {Buffer | undefined}
    */
    buffer(buffer_id) {
        const ptr0 = passStringToWasm0(buffer_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.rendererdata_buffer(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : Buffer$1.__wrap(ret);
    }
    /**
    * @returns {BufferMap}
    */
    buffers() {
        const ret = wasm$1.rendererdata_buffers(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {string} attribute_id
    * @returns {Attribute | undefined}
    */
    attribute(attribute_id) {
        const ptr0 = passStringToWasm0(attribute_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.rendererdata_attribute(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : Attribute.__wrap(ret);
    }
    /**
    * @returns {AttributeMap}
    */
    attributes() {
        const ret = wasm$1.rendererdata_attributes(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {string} texture_id
    * @returns {Texture | undefined}
    */
    texture(texture_id) {
        const ptr0 = passStringToWasm0(texture_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.rendererdata_texture(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : Texture.__wrap(ret);
    }
    /**
    * @returns {TextureMap}
    */
    textures() {
        const ret = wasm$1.rendererdata_textures(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {StringArray} texture_ids
    * @returns {TextureJsArray}
    */
    textureById(texture_ids) {
        const ret = wasm$1.rendererdata_textureById(this.__wbg_ptr, addHeapObject(texture_ids));
        return takeObject(ret);
    }
    /**
    * @param {string} framebuffer_id
    * @returns {Framebuffer | undefined}
    */
    framebuffer(framebuffer_id) {
        const ptr0 = passStringToWasm0(framebuffer_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.rendererdata_framebuffer(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : Framebuffer.__wrap(ret);
    }
    /**
    * @param {string} transform_feedback_id
    * @returns {WebGLTransformFeedback | undefined}
    */
    transformFeedback(transform_feedback_id) {
        const ptr0 = passStringToWasm0(transform_feedback_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.rendererdata_transformFeedback(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
    * @param {string} vao_id
    * @returns {WebGLVertexArrayObject | undefined}
    */
    VAO(vao_id) {
        const ptr0 = passStringToWasm0(vao_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.rendererdata_VAO(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
    * @returns {object | undefined}
    */
    userCtx() {
        const ret = wasm$1.rendererdata_userCtx(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {string} program_id
    */
    useProgram(program_id) {
        const ptr0 = passStringToWasm0(program_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm$1.rendererdata_useProgram(this.__wbg_ptr, ptr0, len0);
    }
    /**
    * @param {string} vao_id
    */
    useVAO(vao_id) {
        const ptr0 = passStringToWasm0(vao_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm$1.rendererdata_useVAO(this.__wbg_ptr, ptr0, len0);
    }
    /**
    * @param {string} uniform_id
    */
    updateUniform(uniform_id) {
        const ptr0 = passStringToWasm0(uniform_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm$1.rendererdata_updateUniform(this.__wbg_ptr, ptr0, len0);
    }
    /**
    */
    updateUniforms() {
        wasm$1.rendererdata_updateUniforms(this.__wbg_ptr);
    }
    /**
    */
    render() {
        wasm$1.rendererdata_render(this.__wbg_ptr);
    }
    /**
    */
    saveImage() {
        wasm$1.rendererdata_saveImage(this.__wbg_ptr);
    }
    /**
    * @returns {Renderer}
    */
    intoRendererHandle() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm$1.rendererdata_intoRendererHandle(ptr);
        return Renderer.__wrap(ret);
    }
}
/**
* See [RendererDataBuilder](crate::RendererDataBuilder)
*/
class RendererDataBuilder {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(RendererDataBuilder.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_rendererdatabuilder_free(ptr);
    }
    /**
    * @param {string} texture_id
    * @returns {Texture | undefined}
    */
    texture(texture_id) {
        const ptr0 = passStringToWasm0(texture_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.rendererdatabuilder_texture(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : Texture.__wrap(ret);
    }
    /**
    * @param {HTMLCanvasElement} canvas
    */
    setCanvas(canvas) {
        wasm$1.rendererdatabuilder_setCanvas(this.__wbg_ptr, addHeapObject(canvas));
    }
    /**
    * @param {string} id
    * @param {string} fragment_shader_src
    */
    addFragmentShaderSrc(id, fragment_shader_src) {
        const ptr0 = passStringToWasm0(id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(fragment_shader_src, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        wasm$1.rendererdatabuilder_addFragmentShaderSrc(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
    /**
    * @param {string} id
    * @param {string} vertex_shader_src
    */
    addVertexShaderSrc(id, vertex_shader_src) {
        const ptr0 = passStringToWasm0(id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(vertex_shader_src, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        wasm$1.rendererdatabuilder_addVertexShaderSrc(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
    /**
    * @param {ProgramLink} program_link
    */
    addProgramLink(program_link) {
        _assertClass(program_link, ProgramLink);
        var ptr0 = program_link.__destroy_into_raw();
        wasm$1.rendererdatabuilder_addProgramLink(this.__wbg_ptr, ptr0);
    }
    /**
    * @param {RenderCallbackJs} render_callback
    */
    setRenderCallback(render_callback) {
        wasm$1.rendererdatabuilder_setRenderCallback(this.__wbg_ptr, addHeapObject(render_callback));
    }
    /**
    * @param {object} ctx
    */
    setUserCtx(ctx) {
        wasm$1.rendererdatabuilder_setUserCtx(this.__wbg_ptr, addHeapObject(ctx));
    }
    /**
    * @param {UniformLink} uniform_link
    */
    addUniformLink(uniform_link) {
        _assertClass(uniform_link, UniformLink);
        var ptr0 = uniform_link.__destroy_into_raw();
        wasm$1.rendererdatabuilder_addUniformLink(this.__wbg_ptr, ptr0);
    }
    /**
    * @param {BufferLink} buffer_link
    */
    addBufferLink(buffer_link) {
        _assertClass(buffer_link, BufferLink);
        var ptr0 = buffer_link.__destroy_into_raw();
        wasm$1.rendererdatabuilder_addBufferLink(this.__wbg_ptr, ptr0);
    }
    /**
    * @param {AttributeLink} attribute_link
    */
    addAttributeLink(attribute_link) {
        _assertClass(attribute_link, AttributeLink);
        var ptr0 = attribute_link.__destroy_into_raw();
        wasm$1.rendererdatabuilder_addAttributeLink(this.__wbg_ptr, ptr0);
    }
    /**
    * @param {TextureLink} texture_link
    */
    addTextureLink(texture_link) {
        _assertClass(texture_link, TextureLink);
        var ptr0 = texture_link.__destroy_into_raw();
        wasm$1.rendererdatabuilder_addTextureLink(this.__wbg_ptr, ptr0);
    }
    /**
    * @param {FramebufferLink} framebuffer_link
    */
    addFramebufferLink(framebuffer_link) {
        _assertClass(framebuffer_link, FramebufferLink);
        var ptr0 = framebuffer_link.__destroy_into_raw();
        wasm$1.rendererdatabuilder_addFramebufferLink(this.__wbg_ptr, ptr0);
    }
    /**
    * @param {TransformFeedbackLink} transform_feedback_link
    */
    addTransformFeedbackLink(transform_feedback_link) {
        const ptr = this.__destroy_into_raw();
        _assertClass(transform_feedback_link, TransformFeedbackLink);
        var ptr0 = transform_feedback_link.__destroy_into_raw();
        wasm$1.rendererdatabuilder_addTransformFeedbackLink(ptr, ptr0);
    }
    /**
    * @param {string} vertex_array_object_id
    */
    addVAOLink(vertex_array_object_id) {
        const ptr0 = passStringToWasm0(vertex_array_object_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm$1.rendererdatabuilder_addVAOLink(this.__wbg_ptr, ptr0, len0);
    }
    /**
    * @param {Function} get_context_callback
    */
    setGetContextCallback(get_context_callback) {
        wasm$1.rendererdatabuilder_setGetContextCallback(this.__wbg_ptr, addHeapObject(get_context_callback));
    }
    /**
    * @returns {RendererData}
    */
    buildRendererData() {
        try {
            const ptr = this.__destroy_into_raw();
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.rendererdatabuilder_buildRendererData(retptr, ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return RendererData.__wrap(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @returns {Renderer}
    */
    buildRenderer() {
        try {
            const ptr = this.__destroy_into_raw();
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.rendererdatabuilder_buildRenderer(retptr, ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return Renderer.__wrap(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
/**
*/
class Texture {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Texture.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_texture_free(ptr);
    }
    /**
    * @returns {string}
    */
    textureId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.buffer_bufferId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @returns {WebGLTexture}
    */
    webglTexture() {
        const ret = wasm$1.buffer_webglBuffer(this.__wbg_ptr);
        return takeObject(ret);
    }
}
/**
*/
class TextureCreateContext {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(TextureCreateContext.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_texturecreatecontext_free(ptr);
    }
    /**
    * @returns {WebGL2RenderingContext}
    */
    gl() {
        const ret = wasm$1.attributecreatecontext_gl(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {number}
    */
    now() {
        const ret = wasm$1.attributecreatecontext_now(this.__wbg_ptr);
        return ret;
    }
    /**
    * @returns {HTMLCanvasElement}
    */
    canvas() {
        const ret = wasm$1.texturecreatecontext_canvas(this.__wbg_ptr);
        return takeObject(ret);
    }
}
/**
*/
class TextureLink {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(TextureLink.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_texturelink_free(ptr);
    }
    /**
    * @param {string} texture_id
    * @param {TextureCreateCallbackJs} create_texture_callback
    */
    constructor(texture_id, create_texture_callback) {
        const ptr0 = passStringToWasm0(texture_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.bufferlink_new(ptr0, len0, addHeapObject(create_texture_callback));
        return TextureLink.__wrap(ret);
    }
    /**
    * @returns {string}
    */
    textureId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.bufferlink_bufferId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @param {WebGL2RenderingContext} gl
    * @param {number} now
    * @param {HTMLCanvasElement} canvas
    * @returns {WebGLTexture}
    */
    createTexture(gl, now, canvas) {
        const ret = wasm$1.texturelink_createTexture(this.__wbg_ptr, addHeapObject(gl), now, addHeapObject(canvas));
        return takeObject(ret);
    }
}
/**
*/
class TransformFeedbackLink {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(TransformFeedbackLink.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_transformfeedbacklink_free(ptr);
    }
    /**
    * @param {string} transform_feedback_id
    */
    constructor(transform_feedback_id) {
        const ptr0 = passStringToWasm0(transform_feedback_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.transformfeedbacklink_new(ptr0, len0);
        return TransformFeedbackLink.__wrap(ret);
    }
    /**
    * @returns {string}
    */
    transformFeedbackId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.transformfeedbacklink_transformFeedbackId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
/**
*/
class Uniform {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Uniform.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_uniform_free(ptr);
    }
    /**
    * @returns {StringArray}
    */
    programIds() {
        const ret = wasm$1.uniform_programIds(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {string}
    */
    uniformId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.uniform_uniformId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @returns {UniformLocationsMap}
    */
    uniformLocations() {
        const ret = wasm$1.uniform_uniformLocations(this.__wbg_ptr);
        return takeObject(ret);
    }
}
/**
*/
class UniformContext {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(UniformContext.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_uniformcontext_free(ptr);
    }
    /**
    * @returns {WebGL2RenderingContext}
    */
    gl() {
        const ret = wasm$1.uniformcontext_gl(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {number}
    */
    now() {
        const ret = wasm$1.uniformcontext_now(this.__wbg_ptr);
        return ret;
    }
    /**
    * @returns {WebGLUniformLocation}
    */
    uniformLocation() {
        const ret = wasm$1.uniformcontext_uniformLocation(this.__wbg_ptr);
        return takeObject(ret);
    }
}
/**
*/
class UniformLink {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(UniformLink.prototype);
        obj.__wbg_ptr = ptr;

        return obj;
    }

    toJSON() {
        return {
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_uniformlink_free(ptr);
    }
    /**
    * @param {StringArray} program_ids
    * @param {string} uniform_id
    * @param {UniformCreateUpdateCallbackJs} initialize_callback
    */
    constructor(program_ids, uniform_id, initialize_callback) {
        const ptr0 = passStringToWasm0(uniform_id, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.uniformlink_new(addHeapObject(program_ids), ptr0, len0, addHeapObject(initialize_callback));
        return UniformLink.__wrap(ret);
    }
    /**
    * @returns {StringArray}
    */
    programIds() {
        const ret = wasm$1.uniformlink_programIds(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {string}
    */
    uniformId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.uniformlink_uniformId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @returns {UniformCreateUpdateCallbackJs | undefined}
    */
    initializeCallback() {
        const ret = wasm$1.uniformlink_initializeCallback(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {UniformCreateUpdateCallbackJs} callback
    */
    setInitializeCallback(callback) {
        wasm$1.uniformlink_setInitializeCallback(this.__wbg_ptr, addHeapObject(callback));
    }
    /**
    * @returns {UniformShouldUpdateCallbackJs | undefined}
    */
    shouldUpdateCallback() {
        const ret = wasm$1.uniformlink_shouldUpdateCallback(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {UniformShouldUpdateCallbackJs} callback
    */
    setShouldUpdateCallback(callback) {
        wasm$1.uniformlink_setShouldUpdateCallback(this.__wbg_ptr, addHeapObject(callback));
    }
    /**
    * @param {UniformCreateUpdateCallbackJs} callback
    */
    setUpdateCallback(callback) {
        wasm$1.uniformlink_setUpdateCallback(this.__wbg_ptr, addHeapObject(callback));
    }
    /**
    * @returns {UniformCreateUpdateCallbackJs | undefined}
    */
    updateCallback() {
        const ret = wasm$1.uniformlink_updateCallback(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {boolean}
    */
    useInitCallbackForUpdate() {
        const ret = wasm$1.uniformlink_useInitCallbackForUpdate(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
    * @param {boolean} use_init_callback_for_update
    */
    setUseInitCallbackForUpdate(use_init_callback_for_update) {
        wasm$1.uniformlink_setUseInitCallbackForUpdate(this.__wbg_ptr, use_init_callback_for_update);
    }
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                if (module.headers.get('Content-Type') != 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbindgen_object_drop_ref = function(arg0) {
        takeObject(arg0);
    };
    imports.wbg.__wbindgen_cb_drop = function(arg0) {
        const obj = takeObject(arg0).original;
        if (obj.cnt-- == 1) {
            obj.a = 0;
            return true;
        }
        const ret = false;
        return ret;
    };
    imports.wbg.__wbindgen_object_clone_ref = function(arg0) {
        const ret = getObject(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_string_new = function(arg0, arg1) {
        const ret = getStringFromWasm0(arg0, arg1);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_boolean_get = function(arg0) {
        const v = getObject(arg0);
        const ret = typeof(v) === 'boolean' ? (v ? 1 : 0) : 2;
        return ret;
    };
    imports.wbg.__wbindgen_json_parse = function(arg0, arg1) {
        const ret = JSON.parse(getStringFromWasm0(arg0, arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_texture_new = function(arg0) {
        const ret = Texture.__wrap(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_uniformcontext_new = function(arg0) {
        const ret = UniformContext.__wrap(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_attributecreatecontext_new = function(arg0) {
        const ret = AttributeCreateContext.__wrap(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_framebuffercreatecontext_new = function(arg0) {
        const ret = FramebufferCreateContext.__wrap(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_texturecreatecontext_new = function(arg0) {
        const ret = TextureCreateContext.__wrap(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_buffercreatecontext_new = function(arg0) {
        const ret = BufferCreateContext.__wrap(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_rendererdata_new = function(arg0) {
        const ret = RendererData.__wrap(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_buffer_new = function(arg0) {
        const ret = Buffer$1.__wrap(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_attribute_new = function(arg0) {
        const ret = Attribute.__wrap(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_is_object = function(arg0) {
        const val = getObject(arg0);
        const ret = typeof(val) === 'object' && val !== null;
        return ret;
    };
    imports.wbg.__wbg_uniform_new = function(arg0) {
        const ret = Uniform.__wrap(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_string_get = function(arg0, arg1) {
        const obj = getObject(arg1);
        const ret = typeof(obj) === 'string' ? obj : undefined;
        var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        getInt32Memory0()[arg0 / 4 + 1] = len1;
        getInt32Memory0()[arg0 / 4 + 0] = ptr1;
    };
    imports.wbg.__wbg_captureStreamFromCanvas_bd5cea3d7d144fba = function(arg0) {
        const ret = captureStreamFromCanvas(takeObject(arg0));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_abda76e883ba8a5f = function() {
        const ret = new Error();
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_stack_658279fe44541cf6 = function(arg0, arg1) {
        const ret = getObject(arg1).stack;
        const ptr1 = passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getInt32Memory0()[arg0 / 4 + 1] = len1;
        getInt32Memory0()[arg0 / 4 + 0] = ptr1;
    };
    imports.wbg.__wbg_error_f851667af71bcfc6 = function(arg0, arg1) {
        let deferred0_0;
        let deferred0_1;
        try {
            deferred0_0 = arg0;
            deferred0_1 = arg1;
            console.error(getStringFromWasm0(arg0, arg1));
        } finally {
            wasm$1.__wbindgen_free(deferred0_0, deferred0_1, 1);
        }
    };
    imports.wbg.__wbg_getRandomValues_37fa2ca9e4e07fab = function() { return handleError(function (arg0, arg1) {
        getObject(arg0).getRandomValues(getObject(arg1));
    }, arguments) };
    imports.wbg.__wbg_randomFillSync_dc1e9a60c158336d = function() { return handleError(function (arg0, arg1) {
        getObject(arg0).randomFillSync(takeObject(arg1));
    }, arguments) };
    imports.wbg.__wbg_crypto_c48a774b022d20ac = function(arg0) {
        const ret = getObject(arg0).crypto;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_process_298734cf255a885d = function(arg0) {
        const ret = getObject(arg0).process;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_versions_e2e78e134e3e5d01 = function(arg0) {
        const ret = getObject(arg0).versions;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_node_1cd7a5d853dbea79 = function(arg0) {
        const ret = getObject(arg0).node;
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_is_string = function(arg0) {
        const ret = typeof(getObject(arg0)) === 'string';
        return ret;
    };
    imports.wbg.__wbg_msCrypto_bcb970640f50a1e8 = function(arg0) {
        const ret = getObject(arg0).msCrypto;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_require_8f08ceecec0f4fee = function() { return handleError(function () {
        const ret = module.require;
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbindgen_is_function = function(arg0) {
        const ret = typeof(getObject(arg0)) === 'function';
        return ret;
    };
    imports.wbg.__wbindgen_number_get = function(arg0, arg1) {
        const obj = getObject(arg1);
        const ret = typeof(obj) === 'number' ? obj : undefined;
        getFloat64Memory0()[arg0 / 8 + 1] = isLikeNone(ret) ? 0 : ret;
        getInt32Memory0()[arg0 / 4 + 0] = !isLikeNone(ret);
    };
    imports.wbg.__wbg_instanceof_WebGl2RenderingContext_f921526c513bf717 = function(arg0) {
        let result;
        try {
            result = getObject(arg0) instanceof WebGL2RenderingContext;
        } catch {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_bindVertexArray_8863a216d7b0a339 = function(arg0, arg1) {
        getObject(arg0).bindVertexArray(getObject(arg1));
    };
    imports.wbg.__wbg_clearBufferuiv_2f6d220a31eabca4 = function(arg0, arg1, arg2, arg3, arg4) {
        getObject(arg0).clearBufferuiv(arg1 >>> 0, arg2, getArrayU32FromWasm0(arg3, arg4));
    };
    imports.wbg.__wbg_copyTexSubImage3D_9fa5e9e7b16cf09d = function(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) {
        getObject(arg0).copyTexSubImage3D(arg1 >>> 0, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9);
    };
    imports.wbg.__wbg_createTransformFeedback_6997e3ce1ff02d6b = function(arg0) {
        const ret = getObject(arg0).createTransformFeedback();
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_createVertexArray_51d51e1e1e13e9f6 = function(arg0) {
        const ret = getObject(arg0).createVertexArray();
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_readBuffer_c426fe18344296ff = function(arg0, arg1) {
        getObject(arg0).readBuffer(arg1 >>> 0);
    };
    imports.wbg.__wbg_texImage2D_07240affd06971e9 = function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) {
        getObject(arg0).texImage2D(arg1 >>> 0, arg2, arg3, arg4, arg5, arg6, arg7 >>> 0, arg8 >>> 0, getObject(arg9));
    }, arguments) };
    imports.wbg.__wbg_texImage2D_699c5d8e0d9ea28a = function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10) {
        getObject(arg0).texImage2D(arg1 >>> 0, arg2, arg3, arg4, arg5, arg6, arg7 >>> 0, arg8 >>> 0, arg9 === 0 ? undefined : getArrayU8FromWasm0(arg9, arg10));
    }, arguments) };
    imports.wbg.__wbg_texImage3D_0962c83d8b1c66d2 = function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10, arg11) {
        getObject(arg0).texImage3D(arg1 >>> 0, arg2, arg3, arg4, arg5, arg6, arg7, arg8 >>> 0, arg9 >>> 0, arg10 === 0 ? undefined : getArrayU8FromWasm0(arg10, arg11));
    }, arguments) };
    imports.wbg.__wbg_transformFeedbackVaryings_d016066e81f21af7 = function(arg0, arg1, arg2, arg3) {
        getObject(arg0).transformFeedbackVaryings(getObject(arg1), getObject(arg2), arg3 >>> 0);
    };
    imports.wbg.__wbg_uniform1ui_97960a82bf8e537e = function(arg0, arg1, arg2) {
        getObject(arg0).uniform1ui(getObject(arg1), arg2 >>> 0);
    };
    imports.wbg.__wbg_uniform2ui_d75a8e9c26eec128 = function(arg0, arg1, arg2, arg3) {
        getObject(arg0).uniform2ui(getObject(arg1), arg2 >>> 0, arg3 >>> 0);
    };
    imports.wbg.__wbg_activeTexture_799bf1387e911c27 = function(arg0, arg1) {
        getObject(arg0).activeTexture(arg1 >>> 0);
    };
    imports.wbg.__wbg_attachShader_47256b6b3d42a22e = function(arg0, arg1, arg2) {
        getObject(arg0).attachShader(getObject(arg1), getObject(arg2));
    };
    imports.wbg.__wbg_bindAttribLocation_291a08f44bcd5601 = function(arg0, arg1, arg2, arg3, arg4) {
        getObject(arg0).bindAttribLocation(getObject(arg1), arg2 >>> 0, getStringFromWasm0(arg3, arg4));
    };
    imports.wbg.__wbg_bindBuffer_24f6010e273fa400 = function(arg0, arg1, arg2) {
        getObject(arg0).bindBuffer(arg1 >>> 0, getObject(arg2));
    };
    imports.wbg.__wbg_bindFramebuffer_a9573e340dab20fe = function(arg0, arg1, arg2) {
        getObject(arg0).bindFramebuffer(arg1 >>> 0, getObject(arg2));
    };
    imports.wbg.__wbg_bindTexture_92d6d7f8bff9531e = function(arg0, arg1, arg2) {
        getObject(arg0).bindTexture(arg1 >>> 0, getObject(arg2));
    };
    imports.wbg.__wbg_blendFunc_533de6de45b80a09 = function(arg0, arg1, arg2) {
        getObject(arg0).blendFunc(arg1 >>> 0, arg2 >>> 0);
    };
    imports.wbg.__wbg_clear_2db2efe323bfdf68 = function(arg0, arg1) {
        getObject(arg0).clear(arg1 >>> 0);
    };
    imports.wbg.__wbg_clearColor_7a7d04702f7e38e5 = function(arg0, arg1, arg2, arg3, arg4) {
        getObject(arg0).clearColor(arg1, arg2, arg3, arg4);
    };
    imports.wbg.__wbg_clearDepth_eb4660e1a89df604 = function(arg0, arg1) {
        getObject(arg0).clearDepth(arg1);
    };
    imports.wbg.__wbg_compileShader_6bf78b425d5c98e1 = function(arg0, arg1) {
        getObject(arg0).compileShader(getObject(arg1));
    };
    imports.wbg.__wbg_createFramebuffer_1684a99697ac9563 = function(arg0) {
        const ret = getObject(arg0).createFramebuffer();
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_createProgram_4eaf3b97b5747a62 = function(arg0) {
        const ret = getObject(arg0).createProgram();
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_createShader_429776c9dd6fb87b = function(arg0, arg1) {
        const ret = getObject(arg0).createShader(arg1 >>> 0);
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_createTexture_1bf4d6fec570124b = function(arg0) {
        const ret = getObject(arg0).createTexture();
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_depthFunc_fb41ad353d07948d = function(arg0, arg1) {
        getObject(arg0).depthFunc(arg1 >>> 0);
    };
    imports.wbg.__wbg_disable_e02106ca6c7002d6 = function(arg0, arg1) {
        getObject(arg0).disable(arg1 >>> 0);
    };
    imports.wbg.__wbg_drawArrays_c91ce3f736bf1f2a = function(arg0, arg1, arg2, arg3) {
        getObject(arg0).drawArrays(arg1 >>> 0, arg2, arg3);
    };
    imports.wbg.__wbg_enable_195891416c520019 = function(arg0, arg1) {
        getObject(arg0).enable(arg1 >>> 0);
    };
    imports.wbg.__wbg_enableVertexAttribArray_8804480c2ea0bb72 = function(arg0, arg1) {
        getObject(arg0).enableVertexAttribArray(arg1 >>> 0);
    };
    imports.wbg.__wbg_framebufferTexture2D_e88fcbd7f8523bb8 = function(arg0, arg1, arg2, arg3, arg4, arg5) {
        getObject(arg0).framebufferTexture2D(arg1 >>> 0, arg2 >>> 0, arg3 >>> 0, getObject(arg4), arg5);
    };
    imports.wbg.__wbg_getExtension_77909f6d51d49d4d = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = getObject(arg0).getExtension(getStringFromWasm0(arg1, arg2));
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_getProgramInfoLog_b81bc53188e286fa = function(arg0, arg1, arg2) {
        const ret = getObject(arg1).getProgramInfoLog(getObject(arg2));
        var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        getInt32Memory0()[arg0 / 4 + 1] = len1;
        getInt32Memory0()[arg0 / 4 + 0] = ptr1;
    };
    imports.wbg.__wbg_getProgramParameter_35522a0bfdfaad27 = function(arg0, arg1, arg2) {
        const ret = getObject(arg0).getProgramParameter(getObject(arg1), arg2 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_getShaderInfoLog_968b93e75477d725 = function(arg0, arg1, arg2) {
        const ret = getObject(arg1).getShaderInfoLog(getObject(arg2));
        var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        getInt32Memory0()[arg0 / 4 + 1] = len1;
        getInt32Memory0()[arg0 / 4 + 0] = ptr1;
    };
    imports.wbg.__wbg_getShaderParameter_ac2727ae4fe7648e = function(arg0, arg1, arg2) {
        const ret = getObject(arg0).getShaderParameter(getObject(arg1), arg2 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_getUniformLocation_9f6eb60c560a347b = function(arg0, arg1, arg2, arg3) {
        const ret = getObject(arg0).getUniformLocation(getObject(arg1), getStringFromWasm0(arg2, arg3));
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_linkProgram_33998194075d71fb = function(arg0, arg1) {
        getObject(arg0).linkProgram(getObject(arg1));
    };
    imports.wbg.__wbg_shaderSource_1cb7c64dc7d1a500 = function(arg0, arg1, arg2, arg3) {
        getObject(arg0).shaderSource(getObject(arg1), getStringFromWasm0(arg2, arg3));
    };
    imports.wbg.__wbg_texParameteri_85dad939f62a15aa = function(arg0, arg1, arg2, arg3) {
        getObject(arg0).texParameteri(arg1 >>> 0, arg2 >>> 0, arg3);
    };
    imports.wbg.__wbg_uniform1f_88379f4e2630bc66 = function(arg0, arg1, arg2) {
        getObject(arg0).uniform1f(getObject(arg1), arg2);
    };
    imports.wbg.__wbg_uniform1i_d2e61a6a43889648 = function(arg0, arg1, arg2) {
        getObject(arg0).uniform1i(getObject(arg1), arg2);
    };
    imports.wbg.__wbg_useProgram_3683cf6f60939dcd = function(arg0, arg1) {
        getObject(arg0).useProgram(getObject(arg1));
    };
    imports.wbg.__wbg_viewport_fad1ce9e18f741c0 = function(arg0, arg1, arg2, arg3, arg4) {
        getObject(arg0).viewport(arg1, arg2, arg3, arg4);
    };
    imports.wbg.__wbg_instanceof_Window_9029196b662bc42a = function(arg0) {
        let result;
        try {
            result = getObject(arg0) instanceof Window;
        } catch {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_document_f7ace2b956f30a4f = function(arg0) {
        const ret = getObject(arg0).document;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_innerWidth_ebe07ce5463ff293 = function() { return handleError(function (arg0) {
        const ret = getObject(arg0).innerWidth;
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_innerHeight_2dd06d8cf68f1d7d = function() { return handleError(function (arg0) {
        const ret = getObject(arg0).innerHeight;
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_devicePixelRatio_f9de7bddca0eaf20 = function(arg0) {
        const ret = getObject(arg0).devicePixelRatio;
        return ret;
    };
    imports.wbg.__wbg_performance_2c295061c8b01e0b = function(arg0) {
        const ret = getObject(arg0).performance;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_matchMedia_12ef69056e32d0b3 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = getObject(arg0).matchMedia(getStringFromWasm0(arg1, arg2));
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_get_cb7c1c2da725c920 = function(arg0, arg1, arg2) {
        const ret = getObject(arg0)[getStringFromWasm0(arg1, arg2)];
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_cancelAnimationFrame_9b68e9588c6543bc = function() { return handleError(function (arg0, arg1) {
        getObject(arg0).cancelAnimationFrame(arg1);
    }, arguments) };
    imports.wbg.__wbg_requestAnimationFrame_d082200514b6674d = function() { return handleError(function (arg0, arg1) {
        const ret = getObject(arg0).requestAnimationFrame(getObject(arg1));
        return ret;
    }, arguments) };
    imports.wbg.__wbg_clearTimeout_220be2fa0577b342 = function(arg0, arg1) {
        getObject(arg0).clearTimeout(arg1);
    };
    imports.wbg.__wbg_setTimeout_eb1a0d116c26d9f6 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = getObject(arg0).setTimeout(getObject(arg1), arg2);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_instanceof_WebGlTexture_d5ae70ae863decb7 = function(arg0) {
        let result;
        try {
            result = getObject(arg0) instanceof WebGLTexture;
        } catch {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_x_6c8af74c3b4d8c09 = function(arg0) {
        const ret = getObject(arg0).x;
        return ret;
    };
    imports.wbg.__wbg_y_4cca2672ce1b5fc1 = function(arg0) {
        const ret = getObject(arg0).y;
        return ret;
    };
    imports.wbg.__wbg_width_2931aaedd21f1fff = function(arg0) {
        const ret = getObject(arg0).width;
        return ret;
    };
    imports.wbg.__wbg_setwidth_a667a942dba6656e = function(arg0, arg1) {
        getObject(arg0).width = arg1 >>> 0;
    };
    imports.wbg.__wbg_height_0d36fbbeb60b0661 = function(arg0) {
        const ret = getObject(arg0).height;
        return ret;
    };
    imports.wbg.__wbg_setheight_a747d440760fe5aa = function(arg0, arg1) {
        getObject(arg0).height = arg1 >>> 0;
    };
    imports.wbg.__wbg_getContext_7c5944ea807bf5d3 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = getObject(arg0).getContext(getStringFromWasm0(arg1, arg2));
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_toDataURL_68f83e980612fa25 = function() { return handleError(function (arg0, arg1) {
        const ret = getObject(arg1).toDataURL();
        const ptr1 = passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getInt32Memory0()[arg0 / 4 + 1] = len1;
        getInt32Memory0()[arg0 / 4 + 0] = ptr1;
    }, arguments) };
    imports.wbg.__wbg_pointerId_701aab7b4fb073ff = function(arg0) {
        const ret = getObject(arg0).pointerId;
        return ret;
    };
    imports.wbg.__wbg_pressure_e388b6fd623a3917 = function(arg0) {
        const ret = getObject(arg0).pressure;
        return ret;
    };
    imports.wbg.__wbg_pointerType_0009b1e4e6b0f428 = function(arg0, arg1) {
        const ret = getObject(arg1).pointerType;
        const ptr1 = passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getInt32Memory0()[arg0 / 4 + 1] = len1;
        getInt32Memory0()[arg0 / 4 + 0] = ptr1;
    };
    imports.wbg.__wbg_matches_0f7e350783b542c2 = function(arg0) {
        const ret = getObject(arg0).matches;
        return ret;
    };
    imports.wbg.__wbg_mimeType_43d9ff38b2d2aa14 = function(arg0, arg1) {
        const ret = getObject(arg1).mimeType;
        const ptr1 = passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getInt32Memory0()[arg0 / 4 + 1] = len1;
        getInt32Memory0()[arg0 / 4 + 0] = ptr1;
    };
    imports.wbg.__wbg_newwithmediastreamandmediarecorderoptions_145c295bd94d9acf = function() { return handleError(function (arg0, arg1) {
        const ret = new MediaRecorder(getObject(arg0), getObject(arg1));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_isTypeSupported_171d7abac55f4230 = function(arg0, arg1) {
        const ret = MediaRecorder.isTypeSupported(getStringFromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_start_18ffd85ef44dffb9 = function() { return handleError(function (arg0, arg1) {
        getObject(arg0).start(arg1);
    }, arguments) };
    imports.wbg.__wbg_stop_c091a8b57a709137 = function() { return handleError(function (arg0) {
        getObject(arg0).stop();
    }, arguments) };
    imports.wbg.__wbg_instanceof_WebGlBuffer_9d094e690c746768 = function(arg0) {
        let result;
        try {
            result = getObject(arg0) instanceof WebGLBuffer;
        } catch {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_deltaX_84508d00a1050e70 = function(arg0) {
        const ret = getObject(arg0).deltaX;
        return ret;
    };
    imports.wbg.__wbg_deltaY_64823169afb0335d = function(arg0) {
        const ret = getObject(arg0).deltaY;
        return ret;
    };
    imports.wbg.__wbg_deltaMode_1c680147cfdba8a5 = function(arg0) {
        const ret = getObject(arg0).deltaMode;
        return ret;
    };
    imports.wbg.__wbg_now_0cfdc90c97d0c24b = function(arg0) {
        const ret = getObject(arg0).now();
        return ret;
    };
    imports.wbg.__wbg_clientX_1a480606ab0cabaa = function(arg0) {
        const ret = getObject(arg0).clientX;
        return ret;
    };
    imports.wbg.__wbg_clientY_9c7878f7faf3900f = function(arg0) {
        const ret = getObject(arg0).clientY;
        return ret;
    };
    imports.wbg.__wbg_offsetX_5a58f16f6c3a41b6 = function(arg0) {
        const ret = getObject(arg0).offsetX;
        return ret;
    };
    imports.wbg.__wbg_offsetY_c45b4956f6429a95 = function(arg0) {
        const ret = getObject(arg0).offsetY;
        return ret;
    };
    imports.wbg.__wbg_ctrlKey_0a805df688b5bf42 = function(arg0) {
        const ret = getObject(arg0).ctrlKey;
        return ret;
    };
    imports.wbg.__wbg_shiftKey_8a070ab6169b5fa4 = function(arg0) {
        const ret = getObject(arg0).shiftKey;
        return ret;
    };
    imports.wbg.__wbg_altKey_6fc1761a6b7a406e = function(arg0) {
        const ret = getObject(arg0).altKey;
        return ret;
    };
    imports.wbg.__wbg_metaKey_d89287be4389a3c1 = function(arg0) {
        const ret = getObject(arg0).metaKey;
        return ret;
    };
    imports.wbg.__wbg_button_7a095234b69de930 = function(arg0) {
        const ret = getObject(arg0).button;
        return ret;
    };
    imports.wbg.__wbg_buttons_d0f40e1650e3fa28 = function(arg0) {
        const ret = getObject(arg0).buttons;
        return ret;
    };
    imports.wbg.__wbg_movementX_966ec323c169d1a6 = function(arg0) {
        const ret = getObject(arg0).movementX;
        return ret;
    };
    imports.wbg.__wbg_movementY_b14b3bc8e1b31f23 = function(arg0) {
        const ret = getObject(arg0).movementY;
        return ret;
    };
    imports.wbg.__wbindgen_number_new = function(arg0) {
        const ret = arg0;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_addEventListener_5651108fc3ffeb6e = function() { return handleError(function (arg0, arg1, arg2, arg3) {
        getObject(arg0).addEventListener(getStringFromWasm0(arg1, arg2), getObject(arg3));
    }, arguments) };
    imports.wbg.__wbg_addEventListener_a5963e26cd7b176b = function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
        getObject(arg0).addEventListener(getStringFromWasm0(arg1, arg2), getObject(arg3), getObject(arg4));
    }, arguments) };
    imports.wbg.__wbg_removeEventListener_5de660c02ed784e4 = function() { return handleError(function (arg0, arg1, arg2, arg3) {
        getObject(arg0).removeEventListener(getStringFromWasm0(arg1, arg2), getObject(arg3));
    }, arguments) };
    imports.wbg.__wbg_removeEventListener_1fa0d9594cdb0b1d = function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
        getObject(arg0).removeEventListener(getStringFromWasm0(arg1, arg2), getObject(arg3), getObject(arg4));
    }, arguments) };
    imports.wbg.__wbg_charCode_75cea1a3a6d66388 = function(arg0) {
        const ret = getObject(arg0).charCode;
        return ret;
    };
    imports.wbg.__wbg_keyCode_dfa86be31f5ef90c = function(arg0) {
        const ret = getObject(arg0).keyCode;
        return ret;
    };
    imports.wbg.__wbg_altKey_612289acf855835c = function(arg0) {
        const ret = getObject(arg0).altKey;
        return ret;
    };
    imports.wbg.__wbg_ctrlKey_582686fb2263dd3c = function(arg0) {
        const ret = getObject(arg0).ctrlKey;
        return ret;
    };
    imports.wbg.__wbg_shiftKey_48e8701355d8e2d4 = function(arg0) {
        const ret = getObject(arg0).shiftKey;
        return ret;
    };
    imports.wbg.__wbg_metaKey_43193b7cc99f8914 = function(arg0) {
        const ret = getObject(arg0).metaKey;
        return ret;
    };
    imports.wbg.__wbg_key_8aeaa079126a9cc7 = function(arg0, arg1) {
        const ret = getObject(arg1).key;
        const ptr1 = passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getInt32Memory0()[arg0 / 4 + 1] = len1;
        getInt32Memory0()[arg0 / 4 + 0] = ptr1;
    };
    imports.wbg.__wbg_code_96d6322b968b2d17 = function(arg0, arg1) {
        const ret = getObject(arg1).code;
        const ptr1 = passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getInt32Memory0()[arg0 / 4 + 1] = len1;
        getInt32Memory0()[arg0 / 4 + 0] = ptr1;
    };
    imports.wbg.__wbg_getModifierState_5102ee8843516d2f = function(arg0, arg1, arg2) {
        const ret = getObject(arg0).getModifierState(getStringFromWasm0(arg1, arg2));
        return ret;
    };
    imports.wbg.__wbg_body_674aec4c1c0910cd = function(arg0) {
        const ret = getObject(arg0).body;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_fullscreenElement_07d5b77ef6c958c1 = function(arg0) {
        const ret = getObject(arg0).fullscreenElement;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_createElement_4891554b28d3388b = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = getObject(arg0).createElement(getStringFromWasm0(arg1, arg2));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_getBoundingClientRect_ac9db8cf97ca8083 = function(arg0) {
        const ret = getObject(arg0).getBoundingClientRect();
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_requestFullscreen_3545278bcd44910c = function() { return handleError(function (arg0) {
        getObject(arg0).requestFullscreen();
    }, arguments) };
    imports.wbg.__wbg_setAttribute_e7e80b478b7b8b2f = function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
        getObject(arg0).setAttribute(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
    }, arguments) };
    imports.wbg.__wbg_setPointerCapture_e7c29336490bba19 = function() { return handleError(function (arg0, arg1) {
        getObject(arg0).setPointerCapture(arg1);
    }, arguments) };
    imports.wbg.__wbg_style_3801009b2339aa94 = function(arg0) {
        const ret = getObject(arg0).style;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_click_9f2ce0ac84b1ce73 = function(arg0) {
        getObject(arg0).click();
    };
    imports.wbg.__wbg_debug_9a6b3243fbbebb61 = function(arg0) {
        console.debug(getObject(arg0));
    };
    imports.wbg.__wbg_error_788ae33f81d3b84b = function(arg0) {
        console.error(getObject(arg0));
    };
    imports.wbg.__wbg_error_c9309504864e78b5 = function(arg0, arg1) {
        console.error(getObject(arg0), getObject(arg1));
    };
    imports.wbg.__wbg_info_2e30e8204b29d91d = function(arg0) {
        console.info(getObject(arg0));
    };
    imports.wbg.__wbg_log_1d3ae0273d8f4f8a = function(arg0) {
        console.log(getObject(arg0));
    };
    imports.wbg.__wbg_warn_d60e832f9882c1b2 = function(arg0) {
        console.warn(getObject(arg0));
    };
    imports.wbg.__wbg_setcssText_589d8a1f2e6d7bb2 = function(arg0, arg1, arg2) {
        getObject(arg0).cssText = getStringFromWasm0(arg1, arg2);
    };
    imports.wbg.__wbg_setProperty_b95ef63ab852879e = function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
        getObject(arg0).setProperty(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
    }, arguments) };
    imports.wbg.__wbg_matches_07c564b5b4101cf2 = function(arg0) {
        const ret = getObject(arg0).matches;
        return ret;
    };
    imports.wbg.__wbg_addListener_85fb6e4bd17e8878 = function() { return handleError(function (arg0, arg1) {
        getObject(arg0).addListener(getObject(arg1));
    }, arguments) };
    imports.wbg.__wbg_removeListener_3b62020874cfc3c7 = function() { return handleError(function (arg0, arg1) {
        getObject(arg0).removeListener(getObject(arg1));
    }, arguments) };
    imports.wbg.__wbg_appendChild_51339d4cde00ee22 = function() { return handleError(function (arg0, arg1) {
        const ret = getObject(arg0).appendChild(getObject(arg1));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_removeChild_973429f368206138 = function() { return handleError(function (arg0, arg1) {
        const ret = getObject(arg0).removeChild(getObject(arg1));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_instanceof_HtmlAnchorElement_a293f072b6174b83 = function(arg0) {
        let result;
        try {
            result = getObject(arg0) instanceof HTMLAnchorElement;
        } catch {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_setdownload_0d874703cef6b180 = function(arg0, arg1, arg2) {
        getObject(arg0).download = getStringFromWasm0(arg1, arg2);
    };
    imports.wbg.__wbg_sethref_a3fde9630423d8ed = function(arg0, arg1, arg2) {
        getObject(arg0).href = getStringFromWasm0(arg1, arg2);
    };
    imports.wbg.__wbg_newwithbuffersourcesequenceandoptions_59d261a36a6bcb4b = function() { return handleError(function (arg0, arg1) {
        const ret = new Blob(getObject(arg0), getObject(arg1));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_arrayBuffer_27cefaea55cbf063 = function(arg0) {
        const ret = getObject(arg0).arrayBuffer();
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_createObjectURL_d82f2880bada6a1d = function() { return handleError(function (arg0, arg1) {
        const ret = URL.createObjectURL(getObject(arg1));
        const ptr1 = passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getInt32Memory0()[arg0 / 4 + 1] = len1;
        getInt32Memory0()[arg0 / 4 + 0] = ptr1;
    }, arguments) };
    imports.wbg.__wbg_revokeObjectURL_571395bdb196a1de = function() { return handleError(function (arg0, arg1) {
        URL.revokeObjectURL(getStringFromWasm0(arg0, arg1));
    }, arguments) };
    imports.wbg.__wbg_data_4088a25a41e6135e = function(arg0) {
        const ret = getObject(arg0).data;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_target_f171e89c61e2bccf = function(arg0) {
        const ret = getObject(arg0).target;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_cancelBubble_90d1c3aa2a76cbeb = function(arg0) {
        const ret = getObject(arg0).cancelBubble;
        return ret;
    };
    imports.wbg.__wbg_preventDefault_24104f3f0a54546a = function(arg0) {
        getObject(arg0).preventDefault();
    };
    imports.wbg.__wbg_stopPropagation_55539cfa2506c867 = function(arg0) {
        getObject(arg0).stopPropagation();
    };
    imports.wbg.__wbg_instanceof_WebGlFramebuffer_a3a6d0b266fbd1e0 = function(arg0) {
        let result;
        try {
            result = getObject(arg0) instanceof WebGLFramebuffer;
        } catch {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_new_898a68150f225f2e = function() {
        const ret = new Array();
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_newnoargs_581967eacc0e2604 = function(arg0, arg1) {
        const ret = new Function(getStringFromWasm0(arg0, arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_56693dbed0c32988 = function() {
        const ret = new Map();
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_next_526fc47e980da008 = function(arg0) {
        const ret = getObject(arg0).next;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_next_ddb3312ca1c4e32a = function() { return handleError(function (arg0) {
        const ret = getObject(arg0).next();
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_done_5c1f01fb660d73b5 = function(arg0) {
        const ret = getObject(arg0).done;
        return ret;
    };
    imports.wbg.__wbg_value_1695675138684bd5 = function(arg0) {
        const ret = getObject(arg0).value;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_iterator_97f0c81209c6c35a = function() {
        const ret = Symbol.iterator;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_get_97b561fb56f034b5 = function() { return handleError(function (arg0, arg1) {
        const ret = Reflect.get(getObject(arg0), getObject(arg1));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_call_cb65541d95d71282 = function() { return handleError(function (arg0, arg1) {
        const ret = getObject(arg0).call(getObject(arg1));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_new_b51585de1b234aff = function() {
        const ret = new Object();
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_self_1ff1d729e9aae938 = function() { return handleError(function () {
        const ret = self.self;
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_window_5f4faef6c12b79ec = function() { return handleError(function () {
        const ret = window.window;
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_globalThis_1d39714405582d3c = function() { return handleError(function () {
        const ret = globalThis.globalThis;
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_global_651f05c6a0944d1c = function() { return handleError(function () {
        const ret = global.global;
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbindgen_is_undefined = function(arg0) {
        const ret = getObject(arg0) === undefined;
        return ret;
    };
    imports.wbg.__wbg_newwithlength_3ec098a360da1909 = function(arg0) {
        const ret = new Array(arg0 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_set_502d29070ea18557 = function(arg0, arg1, arg2) {
        getObject(arg0)[arg1 >>> 0] = takeObject(arg2);
    };
    imports.wbg.__wbg_push_ca1c26067ef907ac = function(arg0, arg1) {
        const ret = getObject(arg0).push(getObject(arg1));
        return ret;
    };
    imports.wbg.__wbg_instanceof_ArrayBuffer_39ac22089b74fddb = function(arg0) {
        let result;
        try {
            result = getObject(arg0) instanceof ArrayBuffer;
        } catch {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_call_01734de55d61e11d = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_set_bedc3d02d0f05eb0 = function(arg0, arg1, arg2) {
        const ret = getObject(arg0).set(getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_is_205d914af04a8faa = function(arg0, arg1) {
        const ret = Object.is(getObject(arg0), getObject(arg1));
        return ret;
    };
    imports.wbg.__wbg_new_43f1b47c28813cbd = function(arg0, arg1) {
        try {
            var state0 = {a: arg0, b: arg1};
            var cb0 = (arg0, arg1) => {
                const a = state0.a;
                state0.a = 0;
                try {
                    return __wbg_adapter_552(a, state0.b, arg0, arg1);
                } finally {
                    state0.a = a;
                }
            };
            const ret = new Promise(cb0);
            return addHeapObject(ret);
        } finally {
            state0.a = state0.b = 0;
        }
    };
    imports.wbg.__wbg_resolve_53698b95aaf7fcf8 = function(arg0) {
        const ret = Promise.resolve(getObject(arg0));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_then_f7e06ee3c11698eb = function(arg0, arg1) {
        const ret = getObject(arg0).then(getObject(arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_then_b2267541e2a73865 = function(arg0, arg1, arg2) {
        const ret = getObject(arg0).then(getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_buffer_085ec1f694018c4f = function(arg0) {
        const ret = getObject(arg0).buffer;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_newwithbyteoffsetandlength_6da8e527659b86aa = function(arg0, arg1, arg2) {
        const ret = new Uint8Array(getObject(arg0), arg1 >>> 0, arg2 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_8125e318e6245eed = function(arg0) {
        const ret = new Uint8Array(getObject(arg0));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_set_5cf90238115182c3 = function(arg0, arg1, arg2) {
        getObject(arg0).set(getObject(arg1), arg2 >>> 0);
    };
    imports.wbg.__wbg_length_72e2208bbc0efc61 = function(arg0) {
        const ret = getObject(arg0).length;
        return ret;
    };
    imports.wbg.__wbg_newwithbyteoffsetandlength_69193e31c844b792 = function(arg0, arg1, arg2) {
        const ret = new Float32Array(getObject(arg0), arg1 >>> 0, arg2 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_newwithlength_e5d69174d6984cd7 = function(arg0) {
        const ret = new Uint8Array(arg0 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_subarray_13db269f57aa838d = function(arg0, arg1, arg2) {
        const ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_set_092e06b0f9d71865 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = Reflect.set(getObject(arg0), getObject(arg1), getObject(arg2));
        return ret;
    }, arguments) };
    imports.wbg.__wbg_random_5f61cd0d6777a993 = typeof Math.random == 'function' ? Math.random : notDefined('Math.random');
    imports.wbg.__wbindgen_debug_string = function(arg0, arg1) {
        const ret = debugString(getObject(arg1));
        const ptr1 = passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getInt32Memory0()[arg0 / 4 + 1] = len1;
        getInt32Memory0()[arg0 / 4 + 0] = ptr1;
    };
    imports.wbg.__wbindgen_throw = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbindgen_memory = function() {
        const ret = wasm$1.memory;
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper270 = function(arg0, arg1, arg2) {
        const ret = makeMutClosure(arg0, arg1, 3, __wbg_adapter_34);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper272 = function(arg0, arg1, arg2) {
        const ret = makeMutClosure(arg0, arg1, 3, __wbg_adapter_34);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper274 = function(arg0, arg1, arg2) {
        const ret = makeMutClosure(arg0, arg1, 3, __wbg_adapter_39);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper276 = function(arg0, arg1, arg2) {
        const ret = makeMutClosure(arg0, arg1, 3, __wbg_adapter_34);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper278 = function(arg0, arg1, arg2) {
        const ret = makeMutClosure(arg0, arg1, 3, __wbg_adapter_34);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper280 = function(arg0, arg1, arg2) {
        const ret = makeMutClosure(arg0, arg1, 3, __wbg_adapter_34);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper282 = function(arg0, arg1, arg2) {
        const ret = makeMutClosure(arg0, arg1, 3, __wbg_adapter_34);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper284 = function(arg0, arg1, arg2) {
        const ret = makeMutClosure(arg0, arg1, 3, __wbg_adapter_34);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper286 = function(arg0, arg1, arg2) {
        const ret = makeMutClosure(arg0, arg1, 3, __wbg_adapter_34);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper790 = function(arg0, arg1, arg2) {
        const ret = makeClosure(arg0, arg1, 213, __wbg_adapter_54);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper792 = function(arg0, arg1, arg2) {
        const ret = makeClosure(arg0, arg1, 213, __wbg_adapter_57);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper794 = function(arg0, arg1, arg2) {
        const ret = makeClosure(arg0, arg1, 213, __wbg_adapter_57);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper796 = function(arg0, arg1, arg2) {
        const ret = makeClosure(arg0, arg1, 213, __wbg_adapter_57);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper1188 = function(arg0, arg1, arg2) {
        const ret = makeMutClosure(arg0, arg1, 302, __wbg_adapter_64);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_closure_wrapper1231 = function(arg0, arg1, arg2) {
        const ret = makeMutClosure(arg0, arg1, 319, __wbg_adapter_67);
        return addHeapObject(ret);
    };

    return imports;
}

function __wbg_finalize_init(instance, module) {
    wasm$1 = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedFloat64Memory0 = null;
    cachedInt32Memory0 = null;
    cachedUint32Memory0 = null;
    cachedUint8Memory0 = null;

    wasm$1.__wbindgen_start();
    return wasm$1;
}

async function __wbg_init(input) {
    if (wasm$1 !== undefined) return wasm$1;

    if (typeof input === 'undefined') {
        input = new URL('particle_system_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof input === 'string' || (typeof Request === 'function' && input instanceof Request) || (typeof URL === 'function' && input instanceof URL)) {
        input = fetch(input);
    }

    const { instance, module } = await __wbg_load(await input, imports);

    return __wbg_finalize_init(instance, module);
}

function _loadWasmModule (sync, filepath, src, imports) {
  function _instantiateOrCompile(source, imports, stream) {
    var instantiateFunc = stream ? WebAssembly.instantiateStreaming : WebAssembly.instantiate;
    var compileFunc = stream ? WebAssembly.compileStreaming : WebAssembly.compile;

    if (imports) {
      return instantiateFunc(source, imports)
    } else {
      return compileFunc(source)
    }
  }

  
var buf = null;
var isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

if (filepath && isNode) {
  
var fs = require("fs");
var path = require("path");

return new Promise((resolve, reject) => {
  fs.readFile(path.resolve(__dirname, filepath), (error, buffer) => {
    if (error != null) {
      reject(error);
    } else {
      resolve(_instantiateOrCompile(buffer, imports, false));
    }
  });
});

} else if (filepath) {
  
return _instantiateOrCompile(fetch(filepath), imports, true);

}

if (isNode) {
  
buf = Buffer.from(src, 'base64');

} else {
  
var raw = globalThis.atob(src);
var rawLength = raw.length;
buf = new Uint8Array(new ArrayBuffer(rawLength));
for(var i = 0; i < rawLength; i++) {
   buf[i] = raw.charCodeAt(i);
}

}


  if(sync) {
    var mod = new WebAssembly.Module(buf);
    return imports ? new WebAssembly.Instance(mod, imports) : mod
  } else {
    return _instantiateOrCompile(buf, imports, false)
  }
}

function wasm(imports){return _loadWasmModule(0, 'generated/6b76feef46d86435.wasm', null, imports)}

// @ts-ignore
await __wbg_init(await wasm());

/* src\components\ParticleRenderer.svelte generated by Svelte v4.1.0 */

function create_fragment$1(ctx) {
	let canvas_1;

	return {
		c() {
			canvas_1 = element("canvas");
			attr(canvas_1, "class", "svelte-166c87");
		},
		m(target, anchor) {
			insert(target, canvas_1, anchor);
			/*canvas_1_binding*/ ctx[4](canvas_1);
		},
		p: noop,
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) {
				detach(canvas_1);
			}

			/*canvas_1_binding*/ ctx[4](null);
		}
	};
}

function instance$1($$self, $$props, $$invalidate) {
	let { width = 0 } = $$props;
	let { height = 0 } = $$props;
	let canvas;
	let initialized = false;

	onMount(() => {
		$$invalidate(3, initialized = true);
	});

	onDestroy(() => {
		$$invalidate(3, initialized = false);
	});

	function canvas_1_binding($$value) {
		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
			canvas = $$value;
			$$invalidate(0, canvas);
		});
	}

	$$self.$$set = $$props => {
		if ('width' in $$props) $$invalidate(1, width = $$props.width);
		if ('height' in $$props) $$invalidate(2, height = $$props.height);
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*initialized, width, height, canvas*/ 15) {
			{
				if (initialized && isRunning()) handleResize(width, height); else if (initialized && width > 0 && height > 0) {
					run(canvas, width, height);
				}
			}
		}
	};

	return [canvas, width, height, initialized, canvas_1_binding];
}

class ParticleRenderer extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$1, create_fragment$1, safe_not_equal, { width: 1, height: 2 });
	}
}

/* src\components\App.svelte generated by Svelte v4.1.0 */

function create_fragment(ctx) {
	let div;
	let particlerenderer;
	let current;
	let mounted;
	let dispose;
	add_render_callback(/*onwindowresize*/ ctx[2]);

	particlerenderer = new ParticleRenderer({
			props: {
				width: /*innerWidth*/ ctx[0],
				height: /*innerHeight*/ ctx[1]
			}
		});

	return {
		c() {
			div = element("div");
			create_component(particlerenderer.$$.fragment);
			attr(div, "id", "container");
			attr(div, "class", "svelte-k3ki8");
		},
		m(target, anchor) {
			insert(target, div, anchor);
			mount_component(particlerenderer, div, null);
			current = true;

			if (!mounted) {
				dispose = listen(window, "resize", /*onwindowresize*/ ctx[2]);
				mounted = true;
			}
		},
		p(ctx, [dirty]) {
			const particlerenderer_changes = {};
			if (dirty & /*innerWidth*/ 1) particlerenderer_changes.width = /*innerWidth*/ ctx[0];
			if (dirty & /*innerHeight*/ 2) particlerenderer_changes.height = /*innerHeight*/ ctx[1];
			particlerenderer.$set(particlerenderer_changes);
		},
		i(local) {
			if (current) return;
			transition_in(particlerenderer.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(particlerenderer.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) {
				detach(div);
			}

			destroy_component(particlerenderer);
			mounted = false;
			dispose();
		}
	};
}

function instance($$self, $$props, $$invalidate) {
	let innerWidth = 0;
	let innerHeight = 0;

	function onwindowresize() {
		$$invalidate(0, innerWidth = window.innerWidth);
		$$invalidate(1, innerHeight = window.innerHeight);
	}

	return [innerWidth, innerHeight, onwindowresize];
}

class App extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance, create_fragment, safe_not_equal, {});
	}
}

// @ts-ignore
//import 'webgl-lint/webgl-lint.js'
new App({
    target: document.body
});
//# sourceMappingURL=bundle.js.map
