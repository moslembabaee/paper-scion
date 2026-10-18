import type { PreviewElementTarget } from './types.ts'
import { createAppDataValidators, isAppDataRequest, isAppDataResult } from './data.ts'

// Bounded message protocol and isolation policy for Paper Make previews.
// Preview iframes run in an opaque origin with restrictive CSP and no credential or navigation privileges.

export const PREVIEW_SANDBOX_POLICY = 'allow-scripts' as const

export const PREVIEW_CSP_DIRECTIVES = Object.freeze({
  'default-src': ["'none'"],
  'script-src': ["'unsafe-inline'", 'data:'],
  'style-src': ["'unsafe-inline'", 'data:'],
  'img-src': ['data:', 'blob:'],
  'font-src': ['data:'],
  'connect-src': ["'none'"],
  'media-src': ['data:', 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-src': ["'none'"],
  'worker-src': ["'none'"],
  'manifest-src': ["'none'"],
  'webrtc': ["'block'"],
})

export const PREVIEW_CSP_HEADER = Object.entries(PREVIEW_CSP_DIRECTIVES)
  .map(([key, values]) => `${key} ${values.join(' ')}`)
  .join('; ')

export const PREVIEW_MESSAGE_CHANNEL = 'paper-make-preview' as const
export const PREVIEW_PROTOCOL_VERSION = 1 as const
export const MAX_PREVIEW_MESSAGE_BYTES = 64 * 1024 // 64 KiB maximum message payload

export type PreviewHostMessageType =
  | 'preview:ping'
  | 'preview:set-theme'
  | 'preview:reset'
  | 'preview:set-inspect'
  | 'preview:highlight-element'
  | 'preview:capability-result'
  | 'preview:data-result'

export type PreviewGuestMessageType =
  | 'preview:ready'
  | 'preview:pong'
  | 'preview:error'
  | 'preview:event'
  | 'preview:console'
  | 'preview:element-selected'
  | 'preview:capability'
  | 'preview:data'

export type PreviewMessageType = PreviewHostMessageType | PreviewGuestMessageType

export interface PreviewThemeConfig {
  readonly mode?: 'dark' | 'light'
  readonly background?: string
  readonly foreground?: string
  readonly accent?: string
  readonly grid?: string
}

export interface PreviewReadyPayload {
  readonly entryPoint: string
  readonly timestamp: number
}

export interface PreviewErrorPayload {
  readonly message: string
  readonly stack?: string
  readonly source?: string
  readonly line?: number
  readonly column?: number
}

export interface PreviewPongPayload {
  readonly pingId?: string
  readonly timestamp: number
}

export interface PreviewPingPayload {
  readonly pingId?: string
  readonly timestamp: number
}

export interface PreviewEventPayload {
  readonly name: string
  readonly data?: unknown
}

export type PreviewElementSelectedPayload = PreviewElementTarget

export interface PreviewSetInspectPayload {
  readonly enabled: boolean
  readonly activeElementId?: string
}

export interface PreviewHighlightElementPayload {
  readonly elementId: string
}

export interface PreviewMessageEnvelope<TType extends string = string, TPayload = unknown> {
  readonly channel: typeof PREVIEW_MESSAGE_CHANNEL
  readonly version: typeof PREVIEW_PROTOCOL_VERSION
  readonly source: 'paper-host' | 'paper-preview'
  readonly type: TType
  readonly id: string
  readonly timestamp: number
  readonly payload: TPayload
}

// Serialize the complete closure, including validator dependencies. Passing
// these functions explicitly keeps renamed bundle symbols out of iframe code.
function createEnvelopeValidator(isAppDataRequest: ReturnType<typeof createAppDataValidators>['isAppDataRequest'],
  isAppDataResult: ReturnType<typeof createAppDataValidators>['isAppDataResult']) {
  function validateEnvelope(raw: unknown, expectedSource: string | undefined, maxBytes: number): string | null {
    try {
      let budget = maxBytes
      let nodes = 0
      const seen = new Set<object>()
      function visit(value: unknown, depth: number): boolean {
        if (++nodes > 4096 || depth > 16 || budget < 0) return false
        if (value === null || typeof value === 'boolean') { budget -= 5; return true }
        if (typeof value === 'number') { budget -= 24; return Number.isFinite(value) }
        if (typeof value === 'string') { budget -= value.length; return budget >= 0 }
        if (!value || typeof value !== 'object' || seen.has(value)) return false
        const proto = Object.getPrototypeOf(value)
        if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) return false
        seen.add(value)
        const keys = Object.keys(value)
        if (keys.length > 4096 || Object.getOwnPropertySymbols(value).length) return false
        for (const key of keys) {
          budget -= key.length + 4
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') return false
          const descriptor = Object.getOwnPropertyDescriptor(value, key)
          if (!descriptor || !('value' in descriptor) || !visit(descriptor.value, depth + 1)) return false
        }
        seen.delete(value)
        return budget >= 0
      }
      if (!visit(raw, 0)) return 'Payload is not bounded JSON data or exceeds byte limit'
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'Message must be an object'
      const m = raw as Record<string, unknown>
      if (Object.keys(m).sort().join(',') !== 'channel,id,payload,source,timestamp,type,version') return 'Invalid envelope fields'
      if (m.channel !== 'paper-make-preview' || m.version !== 1) return 'Invalid channel or version'
      if (m.source !== 'paper-host' && m.source !== 'paper-preview') return 'Invalid message source'
      if (expectedSource && m.source !== expectedSource) return 'Unexpected source'
      if (typeof m.id !== 'string' || !m.id || m.id.length > 64) return 'Invalid message ID'
      if (typeof m.timestamp !== 'number' || !Number.isFinite(m.timestamp) || m.timestamp <= 0) return 'Invalid timestamp'
      const payload = m.payload
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'Payload must be an object'
      const p = payload as Record<string, unknown>
      const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max
      const time = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0
      let valid = false
      if (m.source === 'paper-host') {
        if (m.type === 'preview:ping') valid = time(p.timestamp) && (p.pingId === undefined || text(p.pingId, 64))
        if (m.type === 'preview:reset') valid = Object.keys(p).length === 0
        if (m.type === 'preview:set-theme') valid = Object.entries(p).every(([key, value]) =>
          key === 'mode' ? value === 'dark' || value === 'light' :
          ['background', 'foreground', 'accent', 'grid'].includes(key) && text(value, 128))
        if (m.type === 'preview:set-inspect') valid = Object.keys(p).every(key => ['enabled', 'activeElementId'].includes(key)) && typeof p.enabled === 'boolean' && (p.activeElementId === undefined || text(p.activeElementId, 128))
        if (m.type === 'preview:highlight-element') valid = Object.keys(p).length === 1 && text(p.elementId, 128)
        if (m.type === 'preview:capability-result') valid = text(p.requestId, 64) && (
          Object.keys(p).sort().join(',') === 'requestId,signature' && typeof p.signature === 'string' && /^[a-f0-9]{64}$/.test(p.signature) ||
          Object.keys(p).sort().join(',') === 'error,requestId' && p.error === 'Capability unavailable')
        if (m.type === 'preview:data-result') valid = text(p.requestId, 64) && (
          Object.keys(p).sort().join(',') === 'requestId,result' && isAppDataResult(p.result) ||
          Object.keys(p).sort().join(',') === 'error,requestId' && p.error === 'Data operation unavailable')
      } else {
        if (m.type === 'preview:data') {
          const { handle, ...input } = p
          valid = typeof handle === 'string' && /^dat_[A-Za-z0-9_-]{32}$/.test(handle) && isAppDataRequest(input)
        }
        if (m.type === 'preview:capability') valid = Object.keys(p).sort().join(',') === 'handle,message,operation' &&
          typeof p.handle === 'string' && /^sec_[A-Za-z0-9_-]{32}$/.test(p.handle) && p.operation === 'hmac-sha256' &&
          typeof p.message === 'string' && new TextEncoder().encode(p.message).length <= 4096
        if (m.type === 'preview:ready') valid = text(p.entryPoint, 256) && time(p.timestamp)
        if (m.type === 'preview:pong') valid = time(p.timestamp) && (p.pingId === undefined || text(p.pingId, 64))
        if (m.type === 'preview:error') valid = text(p.message, 8192) &&
          (p.stack === undefined || text(p.stack, 16384)) && (p.source === undefined || text(p.source, 1024)) &&
          [p.line, p.column].every(v => v === undefined || (Number.isSafeInteger(v) && (v as number) >= 0))
        if (m.type === 'preview:event') valid = text(p.name, 128) && (p.name as string).length > 0
        if (m.type === 'preview:console') valid = ['log', 'warn', 'error', 'info'].includes(p.level as string) &&
          Array.isArray(p.args) && p.args.length <= 16 && p.args.every(arg => text(arg, 4096))
        if (m.type === 'preview:element-selected') {
          const allowed = ['bounds', 'elementId', 'layerId', 'previewText', 'selector', 'styles', 'tagName']
          const keys = Object.keys(p)
          const safeId = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_~.:-]+$/.test(v) && v.length <= 128
          const safeTag = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9-]+$/.test(v) && v.length <= 32
          const safeText = (v: unknown) => typeof v === 'string' && !/[<>]/.test(v) && v.length <= 256
          const validBounds = (b: unknown) => {
            if (!b || typeof b !== 'object' || Array.isArray(b)) return false
            const bo = b as Record<string, unknown>
            return Object.keys(bo).sort().join(',') === 'height,width,x,y' &&
              ['height', 'width', 'x', 'y'].every(k => typeof bo[k] === 'number' && Number.isFinite(bo[k]) && Math.abs(bo[k] as number) <= 10000000) &&
              (bo.width as number) >= 0 && (bo.height as number) >= 0
          }
          const validStyles = (s: unknown) => {
            if (!s || typeof s !== 'object' || Array.isArray(s)) return false
            const so = s as Record<string, unknown>
            const allowedProps = [
              'fontSize', 'fontWeight', 'lineHeight', 'textAlign', 'letterSpacing', 'textTransform',
              'padding', 'margin', 'gap',
              'color', 'backgroundColor', 'borderColor', 'borderRadius', 'borderWidth',
            ]
            return Object.keys(so).every(k => allowedProps.includes(k) && typeof so[k] === 'string' && (so[k] as string).length <= 128 && !/[<>{}\\]/.test(so[k] as string))
          }
          valid = keys.every(k => allowed.includes(k)) &&
            safeId(p.elementId) &&
            safeTag(p.tagName) &&
            (p.selector === undefined || (text(p.selector, 256) && !/[<]/.test(p.selector as string))) &&
            (p.layerId === undefined || (safeId(p.layerId) && text(p.layerId, 64))) &&
            (p.previewText === undefined || (safeText(p.previewText) && text(p.previewText, 128))) &&
            (p.bounds === undefined || validBounds(p.bounds)) &&
            (p.styles === undefined || validStyles(p.styles))
        }
      }
      if (!valid) return 'Invalid message type or payload'
      if (new TextEncoder().encode(JSON.stringify(raw)).length > maxBytes) return 'Message exceeds byte limit'
      return null
    } catch {
      return 'Payload could not be serialized safely'
    }
  }

  return validateEnvelope
}
const validateEnvelope = createEnvelopeValidator(isAppDataRequest, isAppDataResult)

export function isAllowedPreviewSandbox(sandbox: unknown): boolean {
  return typeof sandbox === 'string' && sandbox.trim() === PREVIEW_SANDBOX_POLICY
}

let messageSequence = 0
export function createPreviewMessage<TType extends PreviewMessageType, TPayload>(
  source: 'paper-host' | 'paper-preview', type: TType, payload: TPayload, id?: string,
): PreviewMessageEnvelope<TType, TPayload> {
  const message = {
    channel: PREVIEW_MESSAGE_CHANNEL, version: PREVIEW_PROTOCOL_VERSION, source, type,
    id: id ?? `msg-${Date.now()}-${++messageSequence}`, timestamp: Date.now(), payload,
  }
  const error = validateEnvelope(message, source, MAX_PREVIEW_MESSAGE_BYTES)
  if (error) throw new Error(`Preview message payload exceeds maximum or is invalid: ${error}`)
  return Object.freeze(message)
}

export type ParsePreviewMessageResult =
  | { readonly valid: true; readonly message: PreviewMessageEnvelope<PreviewMessageType> }
  | { readonly valid: false; readonly error: string }

export function parsePreviewMessage(raw: unknown, expectedSource?: 'paper-host' | 'paper-preview'): ParsePreviewMessageResult {
  const error = validateEnvelope(raw, expectedSource, MAX_PREVIEW_MESSAGE_BYTES)
  return error ? { valid: false, error } : { valid: true, message: raw as PreviewMessageEnvelope<PreviewMessageType> }
}

export const PREVIEW_PERMISSIONS_POLICY = "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; fullscreen 'none'"
export const MAX_PREVIEW_MESSAGES_PER_SECOND = 120

function protocolRuntime(): string {
  return `const { isAppDataRequest, isAppDataResult } = (${createAppDataValidators.toString()})();
    const validate = (${createEnvelopeValidator.toString()})(isAppDataRequest, isAppDataResult);
    const MAX_BYTES = ${MAX_PREVIEW_MESSAGE_BYTES};
    let windowStart = 0, count = 0;
    function accept(data, source) {
      const now = Date.now();
      if (now - windowStart >= 1000) { windowStart = now; count = 0; }
      if (++count > ${MAX_PREVIEW_MESSAGES_PER_SECOND}) return false;
      return validate(data, source, MAX_BYTES) === null;
    }`
}

export function getPreviewGuestScript(): string {
  return `(function() {
    ${protocolRuntime()}
    let sequence = 0;
    function send(type, payload) {
      const message = { channel: 'paper-make-preview', version: 1, source: 'paper-preview',
        type, id: 'guest-' + (++sequence), timestamp: Date.now(), payload };
      if (accept(message, 'paper-preview')) { parent.postMessage(message, '*'); return message.id; }
    }
    const pendingCapabilities = new Map();
    window.paperCapabilities = Object.freeze({ invoke(handle, input) {
      return new Promise((resolve, reject) => {
        if (pendingCapabilities.size >= 4 || !input || typeof input !== 'object' ||
            Object.keys(input).sort().join(',') !== 'message,operation') { reject(new Error('Capability unavailable')); return; }
        const id = send('preview:capability', { handle, operation: input.operation, message: input.message });
        if (!id) { reject(new Error('Capability unavailable')); return; }
        const timer = setTimeout(() => { pendingCapabilities.delete(id); reject(new Error('Capability unavailable')); }, 10000);
        pendingCapabilities.set(id, { resolve, reject, timer });
      });
    } });
    const pendingData = new Map();
    window.paperData = Object.freeze({ invoke(handle, input) {
      return new Promise((resolve, reject) => {
        if (pendingData.size + pendingCapabilities.size >= 4 || !isAppDataRequest(input)) { reject(new Error('Data operation unavailable')); return; }
        const id = send('preview:data', { handle, ...input });
        if (!id) { reject(new Error('Data operation unavailable')); return; }
        const timer = setTimeout(() => { pendingData.delete(id); reject(new Error('Data operation unavailable')); }, 10000);
        pendingData.set(id, { resolve, reject, timer });
      });
    } });
    window.__paperNotifyReady = function(entryPoint) {
      send('preview:ready', { entryPoint, timestamp: Date.now() });
    };
    window.__paperNotifyError = function(error) {
      const payload = { message: String(error && error.message || error).slice(0, 8192) };
      if (error && error.stack) payload.stack = String(error.stack).slice(0, 16384);
      send('preview:error', payload);
    };
    addEventListener('error', event => window.__paperNotifyError(event.error || event.message));
    addEventListener('unhandledrejection', event => window.__paperNotifyError(event.reason));

    let inspectMode = false;
    let selectedElementId = null;
    let highlightBox = null;
    const targets = new Map();
    const identities = new WeakMap();
    const counts = new Map();

    function identify(node) {
      let id = identities.get(node);
      if (!id) {
        // Source sites may repeat (lists/components). Each mounted instance has
        // its own identity, retained across React rerenders and keyed reorders.
        const site = (node.getAttribute('data-paper-id') || node.getAttribute('data-layer-id') || node.id || ('dom-' + node.tagName.toLowerCase()))
          .replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 100);
        const occurrence = (counts.get(site) || 0) + 1;
        counts.set(site, occurrence);
        id = site + '~' + occurrence;
        identities.set(node, id);
      }
      targets.set(id, node);
      return id;
    }
    function refreshTargets() {
      for (const [id, node] of targets) if (!node.isConnected) targets.delete(id);
      document.querySelectorAll('#root [data-paper-id],#root [data-layer-id],#root [id]').forEach(identify);
    }
    function findNodeById(id) {
      refreshTargets();
      const node = targets.get(id);
      return node && node.isConnected ? node : null;
    }
    function highlightNode(el) {
      if (!inspectMode || !el || !el.isConnected) {
        if (highlightBox) highlightBox.style.display = 'none';
        return;
      }
      if (!highlightBox) {
        highlightBox = document.createElement('div');
        highlightBox.id = '__paper_inspect_highlight';
        highlightBox.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #81adec;box-sizing:border-box;box-shadow:0 0 0 1px #080808;border-radius:2px;';
        document.documentElement.appendChild(highlightBox);
      }
      const rect = el.getBoundingClientRect();
      Object.assign(highlightBox.style, {
        left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px', display: 'block'
      });
    }
    let pendingHighlight = false;
    function scheduleHighlight() {
      if (!inspectMode || pendingHighlight) return;
      pendingHighlight = true;
      requestAnimationFrame(() => {
        pendingHighlight = false;
        highlightNode(findNodeById(selectedElementId));
      });
    }
    addEventListener('resize', scheduleHighlight);
    addEventListener('scroll', scheduleHighlight, true);
    addEventListener('DOMContentLoaded', () => {
      refreshTargets();
      new MutationObserver(scheduleHighlight).observe(document.getElementById('root'), { childList: true, subtree: true, characterData: true, attributes: true });
    });
    document.addEventListener('click', function(event) {
      if (!inspectMode || !(event.target instanceof Element)) return;
      const root = document.getElementById('root');
      if (!root || !root.contains(event.target)) return;
      const target = event.target.closest('[data-paper-id],[data-layer-id],[id]') || event.target;
      if (target === root) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      refreshTargets();
      const elementId = identify(target);
      selectedElementId = elementId;
      highlightNode(target);
      const rect = target.getBoundingClientRect();
      const previewText = (target.textContent || '').replace(/[<>]/g, '').replace(/\\s+/g, ' ').trim().slice(0, 128);
      let styles = undefined;
      try {
        const computed = window.getComputedStyle(target);
        if (computed) {
          styles = {
            fontSize: String(computed.fontSize || '').slice(0, 32),
            fontWeight: String(computed.fontWeight || '').slice(0, 32),
            lineHeight: String(computed.lineHeight || '').slice(0, 32),
            textAlign: String(computed.textAlign || '').slice(0, 32),
            letterSpacing: String(computed.letterSpacing || '').slice(0, 32),
            textTransform: String(computed.textTransform || '').slice(0, 32),
            color: String(computed.color || '').slice(0, 64),
            backgroundColor: String(computed.backgroundColor || '').slice(0, 64),
            borderColor: String(computed.borderColor || '').slice(0, 64),
            borderRadius: String(computed.borderRadius || '').slice(0, 32),
            borderWidth: String(computed.borderWidth || '').slice(0, 32),
            padding: String(computed.padding || '').slice(0, 64),
            margin: String(computed.margin || '').slice(0, 64),
            gap: String(computed.gap || '').slice(0, 32),
          };
        }
      } catch (_) {}
      const payload = {
        elementId, tagName: target.tagName.toLowerCase(), previewText,
        bounds: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
      };
      if (styles) payload.styles = styles;
      const layerId = target.getAttribute('data-layer-id');
      if (layerId && /^[a-zA-Z0-9_~.:-]{1,64}$/.test(layerId)) payload.layerId = layerId;
      send('preview:element-selected', payload);
    }, true);

    addEventListener('message', event => {
      if (event.source !== parent || !accept(event.data, 'paper-host')) return;
      const { type, id, payload } = event.data;
      if (type === 'preview:data-result') {
        const pending = pendingData.get(payload.requestId);
        if (!pending) return;
        pendingData.delete(payload.requestId); clearTimeout(pending.timer);
        if (payload.result) pending.resolve(payload.result);
        else pending.reject(new Error('Data operation unavailable'));
      }
      if (type === 'preview:capability-result') {
        const pending = pendingCapabilities.get(payload.requestId);
        if (!pending) return;
        pendingCapabilities.delete(payload.requestId); clearTimeout(pending.timer);
        if (payload.signature) pending.resolve({ signature: payload.signature });
        else pending.reject(new Error('Capability unavailable'));
      }
      if (type === 'preview:ping') send('preview:pong', { pingId: payload.pingId || id, timestamp: Date.now() });
      if (type === 'preview:set-theme') {
        const root = document.documentElement;
        for (const [key, name] of Object.entries({ background: '--paper-bg', foreground: '--paper-fg', accent: '--paper-accent', grid: '--paper-grid' })) {
          if (payload[key]) root.style.setProperty(name, payload[key]);
        }
        if (payload.mode) root.dataset.theme = payload.mode;
      }
      if (type === 'preview:set-inspect') {
        inspectMode = !!payload.enabled;
        if (payload.activeElementId) {
          selectedElementId = payload.activeElementId;
          highlightNode(findNodeById(selectedElementId));
        } else {
          selectedElementId = null;
          highlightNode(null);
        }
        if (!inspectMode) highlightNode(null);
      }
      if (type === 'preview:highlight-element') {
        selectedElementId = payload.elementId;
        highlightNode(findNodeById(selectedElementId));
      }
    });
  })();`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

// All untrusted bytes stay in a JS string literal, never HTML or executable code.
function scriptString(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/**
 * A trusted outer document owns the untrusted iframe. Its frame-src policy also
 * blocks that child's self-navigation (the child's own connect-src cannot).
 * about:srcdoc needs no network request and inherits the outer CSP.
 * Never insert generated code in this document's execution context.
 */
export function createIsolatedPreviewDocument(html: string): string {
  return `<!doctype html><html lang="en"><head>
    <meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP_HEADER}">
    <meta name="referrer" content="no-referrer"><meta http-equiv="x-dns-prefetch-control" content="off"><title>Paper Preview Boundary</title>
    <style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block;overflow:hidden;background:#080808}</style>
    </head><body><iframe title="Compiled app" sandbox="${PREVIEW_SANDBOX_POLICY}" allow="${PREVIEW_PERMISSIONS_POLICY}" credentialless referrerpolicy="no-referrer"></iframe>
    <script>(function() {
      ${protocolRuntime()}
      const frame = document.querySelector('iframe');
      addEventListener('message', event => {
        if (event.source === frame.contentWindow && event.origin === 'null' && accept(event.data, 'paper-preview')) {
          parent.postMessage(event.data, '*');
        } else if (event.source === parent && accept(event.data, 'paper-host')) {
          frame.contentWindow.postMessage(event.data, '*');
        }
      });
      frame.srcdoc = ${scriptString(html)};
    })();</script></body></html>`
}

export interface GeneratePreviewHtmlOptions {
  readonly js: string
  readonly css: string
  readonly entryPoint?: string
  readonly title?: string
  readonly extraBaseCss?: string
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Compiled app document; always mount it through PreviewFrame's trusted boundary. */
export function generatePreviewHtml({ js, css, entryPoint = 'src/App.tsx', title = 'Paper Preview', extraBaseCss = '' }: GeneratePreviewHtmlOptions): string {
  return `<!doctype html><html lang="en"><head>
    <meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP_HEADER}">
    <meta name="referrer" content="no-referrer"><meta http-equiv="x-dns-prefetch-control" content="off"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="paper-entry-point" content="${escapeHtml(entryPoint)}"><title>${escapeHtml(title)}</title>
    <style id="paper-preview-base">
      *,*::before,*::after{box-sizing:border-box}
      :root{--paper-bg:#080808;--paper-fg:#edebe1;--paper-accent:#81adec;--paper-grid:#222222}
      html,body{margin:0;padding:0;width:100%;height:100%;background-color: #080808;background-color:var(--paper-bg);color:var(--paper-fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
      #root{width:100%;min-height:100%;display:flex;flex-direction:column}
    </style>
    <link rel="stylesheet" href="data:text/css;base64,${toBase64(extraBaseCss + '\n' + css)}">
    <script>${getPreviewGuestScript()}</script></head><body><div id="root"></div>
    <script src="data:text/javascript;base64,${toBase64(js)}"></script></body></html>`
}
