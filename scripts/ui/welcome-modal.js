/**
 * WelcomeModal — Cartel de bienvenida que se muestra la primera vez que el usuario
 * accede a la app, o cuando se invoca manualmente.
 *
 * Responsabilidad: renderizar el modal, gestionar su ciclo de vida y
 * persistir la preferencia "no volver a mostrar" en localStorage.
 *
 * Sin dependencias de automaton ni uiController: solo usa i18n, eventBus
 * y el DOM. Se auto-destruye tras cerrarse.
 */
class WelcomeModal {
    static STORAGE_KEY = 'automaton-welcome-seen';

    constructor() {
        this._el = null;
        this._cleanup = [];
    }

    /**
     * Muestra el modal si el usuario no lo ha descartado antes.
     * @param {boolean} [force=false] — ignorar la preferencia guardada
     */
    show(force = false) {
        if (!force && localStorage.getItem(WelcomeModal.STORAGE_KEY)) return;
        this._render();
        this._bind();
        document.body.appendChild(this._el);
        // Trigger de transición en el siguiente frame
        requestAnimationFrame(() => this._el?.classList.add('wm-visible'));
    }

    // =========================================
    // RENDER
    // =========================================

    _render() {
        const sections = [
            {
                icon: 'fa-info-circle', color: 'wm-blue',
                heading: t('welcome.section.header.title'),
                text: t('welcome.section.header.text')
            },
            {
                icon: 'fa-sliders-h', color: 'wm-green',
                heading: t('welcome.section.panel.title'),
                text: t('welcome.section.panel.text')
            },
            {
                icon: 'fa-shapes', color: 'wm-purple',
                heading: t('welcome.section.patterns.title'),
                text: t('welcome.section.patterns.text')
            },
            {
                icon: 'fa-rocket', color: 'wm-yellow',
                heading: t('welcome.section.quickstart.title'),
                text: t('welcome.section.quickstart.text')
            },
        ];

        const sectionsHTML = sections.map(s => `
            <div class="wm-section">
                <div class="wm-icon ${s.color}"><i class="fas ${s.icon}"></i></div>
                <div class="wm-text">
                    <strong>${s.heading}</strong>
                    <p>${s.text}</p>
                </div>
            </div>`).join('');

        this._el = document.createElement('div');
        this._el.id = 'welcomeModal';
        this._el.className = 'wm-overlay';
        this._el.innerHTML = `
            <div class="wm-card" role="dialog" aria-modal="true" aria-labelledby="wm-title">
                <div class="wm-header">
                    <i class="fas fa-seedling wm-logo"></i>
                    <div>
                        <h2 id="wm-title">${t('welcome.title')}</h2>
                        <p class="wm-subtitle">${t('welcome.subtitle')}</p>
                    </div>
                </div>

                <div class="wm-sections">${sectionsHTML}</div>

                <div class="wm-footer">
                    <label class="wm-dont-show">
                        <input type="checkbox" id="wmDontShow">
                        <span>${t('welcome.dontshow')}</span>
                    </label>
                    <button class="wm-btn-close" id="wmClose">
                        <i class="fas fa-play"></i> ${t('welcome.close')}
                    </button>
                </div>
            </div>`;

        this._injectStyles();
    }

    _injectStyles() {
        if (document.getElementById('wm-styles')) return;
        const style = document.createElement('style');
        style.id = 'wm-styles';
        style.textContent = `
/* ── WelcomeModal ─────────────────────────────────────────── */
.wm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.72);
    backdrop-filter: blur(6px);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    opacity: 0;
    transition: opacity .3s ease;
}
.wm-overlay.wm-visible { opacity: 1; }

.wm-card {
    background: linear-gradient(145deg, #1e293b, #0f172a);
    border: 1px solid rgba(16,185,129,.35);
    border-radius: 16px;
    padding: 28px 28px 22px;
    max-width: 520px;
    width: 100%;
    max-height: 92dvh;
    overflow-y: auto;
    box-shadow: 0 24px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(16,185,129,.1);
    scrollbar-width: thin;
    scrollbar-color: #10b981 transparent;
}

.wm-header {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    margin-bottom: 22px;
}
.wm-logo {
    font-size: 2rem;
    color: #10b981;
    flex-shrink: 0;
    margin-top: 3px;
}
.wm-header h2 {
    font-size: 1.18rem;
    color: #fff;
    margin: 0 0 4px;
    line-height: 1.3;
}
.wm-subtitle {
    font-size: .82rem;
    color: #94a3b8;
    margin: 0;
}

.wm-sections { display: flex; flex-direction: column; gap: 14px; }

.wm-section {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 12px 14px;
    border-radius: 10px;
    background: rgba(255,255,255,.03);
    border: 1px solid rgba(255,255,255,.07);
}
.wm-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: .95rem;
}
.wm-blue   { background: rgba(59,130,246,.18);  color: #60a5fa; border: 1px solid rgba(59,130,246,.3); }
.wm-green  { background: rgba(16,185,129,.18);  color: #34d399; border: 1px solid rgba(16,185,129,.3); }
.wm-purple { background: rgba(139,92,246,.18);  color: #a78bfa; border: 1px solid rgba(139,92,246,.3); }
.wm-yellow { background: rgba(245,158,11,.18);  color: #fbbf24; border: 1px solid rgba(245,158,11,.3); }

.wm-text strong {
    font-size: .85rem;
    color: #e2e8f0;
    display: block;
    margin-bottom: 3px;
}
.wm-text p {
    font-size: .79rem;
    color: #94a3b8;
    margin: 0;
    line-height: 1.55;
}
.wm-text kbd {
    display: inline-block;
    background: rgba(255,255,255,.1);
    border: 1px solid rgba(255,255,255,.25);
    border-radius: 4px;
    padding: 0 5px;
    font-family: 'Courier New', monospace;
    font-size: .78rem;
    color: #fbbf24;
    line-height: 1.6;
}

.wm-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 22px;
    padding-top: 16px;
    border-top: 1px solid rgba(255,255,255,.07);
}
.wm-dont-show {
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    font-size: .8rem;
    color: #64748b;
    user-select: none;
}
.wm-dont-show input { cursor: pointer; accent-color: #10b981; }
.wm-dont-show:hover span { color: #94a3b8; }

.wm-btn-close {
    padding: 9px 22px;
    background: #10b981;
    color: #fff;
    border: none;
    border-radius: 9px;
    font-size: .9rem;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 7px;
    transition: background .2s, transform .15s;
    flex-shrink: 0;
}
.wm-btn-close:hover { background: #059669; transform: translateY(-2px); }

@media (max-width: 480px) {
    .wm-card { padding: 20px 16px 16px; }
    .wm-header h2 { font-size: 1rem; }
    .wm-section { padding: 10px 12px; gap: 10px; }
    .wm-icon { width: 30px; height: 30px; font-size: .8rem; }
    .wm-footer { flex-direction: column-reverse; align-items: stretch; gap: 10px; }
    .wm-btn-close { justify-content: center; }
}
/* ────────────────────────────────────────────────────────── */`;
        document.head.appendChild(style);
    }

    // =========================================
    // EVENTOS
    // =========================================

    _bind() {
        const closeBtn = this._el.querySelector('#wmClose');
        const overlay = this._el;

        const close = () => this._close();

        this._on(closeBtn, 'click', close);
        // Clic fuera de la tarjeta también cierra
        this._on(overlay, 'click', (e) => {
            if (e.target === overlay) close();
        });
        // ESC cierra
        const onKey = (e) => {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('keydown', onKey);
        this._cleanup.push(() => document.removeEventListener('keydown', onKey));
    }

    _close() {
        const checkbox = this._el?.querySelector('#wmDontShow');
        if (checkbox?.checked) {
            localStorage.setItem(WelcomeModal.STORAGE_KEY, '1');
        }

        this._el.classList.remove('wm-visible');
        this._el.addEventListener('transitionend', () => this._destroy(), {once: true});
    }

    _destroy() {
        this._cleanup.forEach(fn => {
            try {
                fn();
            } catch (_) {
            }
        });
        this._cleanup = [];
        this._el?.remove();
        this._el = null;
    }

    // =========================================
    // UTILIDADES
    // =========================================

    _on(target, event, handler) {
        target.addEventListener(event, handler);
        this._cleanup.push(() => target.removeEventListener(event, handler));
    }
}

window.WelcomeModal = WelcomeModal;