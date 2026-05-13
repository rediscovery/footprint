/**
 * ui-panel.js v18 (Modified)
 * - スクリーンショット(2026-05-07)に基づきデフォルト値を更新
 * - 照明、FOOTPRINT表示、LOD2表示の初期値をUIパネルの値に準拠
 */
import { state } from '../state.js';

export class UiPanel {
  constructor(mapApp, containerId = 'petiteau-panel') {
    this.mapApp      = mapApp;
    this.containerId = containerId;
    this._root       = null;
    this._debugTimer = null;
    this._fpsFrames  = 0;
    this._fpsLast    = performance.now();
  }

  mount() {
    this._root = document.getElementById(this.containerId);

    if (!this._root) {
      this._root = document.createElement('div');
      this._root.id = this.containerId;
      document.body.appendChild(this._root);
    }

    this._root.innerHTML = this._buildHTML();

    this._ensurePitchSlider();
    this._ensureFloatingStatus();
    this._ensureMinimizedPanelStyle();
    this._attachEvents();
    this._setPanelCollapsed(true);
    this._startDebugLoop();
  }

  _buildHTML() {
    return `
      <div class="panel-header">
        <span class="panel-title">Petiteau<sup>2</sup></span>
        <button class="panel-toggle-btn" id="panel-collapse-btn" title="パネルを折りたたむ">◀</button>
      </div>

      <div class="panel-body" id="panel-body">

        <section class="panel-section">
          <h3 class="section-title">エリア</h3>
          <div id="area-name" class="area-name">読み込み中…</div>
        </section>

        <section class="panel-section">
          <h3 class="section-title">レイヤー</h3>

          <label class="toggle-row">
            <span class="toggle-label">建物 Footprint</span>
            <input type="checkbox" id="toggle-footprint" checked>
          </label>

          <label class="toggle-row">
            <span class="toggle-label">LOD2 hollow</span>
            <input type="checkbox" id="toggle-lod2" checked>
          </label>

          <label class="toggle-row">
            <span class="toggle-label">GLB 道路</span>
            <input type="checkbox" id="toggle-tran-glb" checked>
          </label>

          <div class="color-row">
            <span class="slider-label">　色</span>
            <input type="color" id="tran-glb-color" value="#8798a8">
            <span id="tran-glb-color-val">#8798a8</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">　opacity</span>
            <input type="range" id="tran-glb-opacity" min="0" max="100" value="100">
            <span id="tran-glb-opacity-val">100%</span>
          </div>

          <label class="toggle-row">
            <span class="toggle-label">GSI 道路</span>
            <input type="checkbox" id="toggle-gsi-road">
          </label>

          <div class="color-row" id="gsi-road-controls" style="display:none">
            <span class="slider-label">　色</span>
            <input type="color" id="gsi-road-color" value="#b0b8c8">
            <span id="gsi-road-color-val">#b0b8c8</span>
          </div>

          <div class="slider-row" id="gsi-road-opacity-row" style="display:none">
            <span class="slider-label">　opacity</span>
            <input type="range" id="gsi-road-opacity" min="0" max="100" value="100">
            <span id="gsi-road-opacity-val">100%</span>
          </div>

          <label class="toggle-row">
            <span class="toggle-label">公園・緑地</span>
            <input type="checkbox" id="toggle-luse-green" checked>
          </label>

          <div class="color-row">
            <span class="slider-label">　色</span>
            <input type="color" id="luse-green-color" value="#1ba66c">
            <span id="luse-green-color-val">#1ba66c</span>
          </div>

          <label class="toggle-row">
            <span class="toggle-label">校庭・グラウンド</span>
            <input type="checkbox" id="toggle-luse-schoolyard" checked>
          </label>

          <div class="color-row">
            <span class="slider-label">　色</span>
            <input type="color" id="luse-school-color" value="#c8ad6a">
            <span id="luse-school-color-val">#c8ad6a</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">緑地 opacity</span>
            <input type="range" id="slider-luse-opacity" min="0" max="100" value="75">
            <span id="luse-opacity-val">75%</span>
          </div>
        </section>

        <section class="panel-section">
          <h3 class="section-title">☀️ 照明（LOD1・LOD2 共通）</h3>

          <div class="slider-row">
            <span class="slider-label">方位角</span>
            <input type="range" id="sun-azimuth" min="0" max="360" value="204">
            <span id="sun-azimuth-val">204°</span>
          </div>

          <div class="slider-hint">0=北 90=東 180=南 270=西</div>

          <div class="slider-row">
            <span class="slider-label">仰角</span>
            <input type="range" id="sun-elevation" min="5" max="85" value="77">
            <span id="sun-elevation-val">77°</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">太陽強度</span>
            <input type="range" id="sun-intensity" min="0" max="100" value="29">
            <span id="sun-intensity-val">29%</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">環境光</span>
            <input type="range" id="ambient-intensity" min="0" max="100" value="100">
            <span id="ambient-intensity-val">100%</span>
          </div>

          <div class="slider-hint">環境光は LOD2（GLB）のみ有効</div>
        </section>

        <section class="panel-section">
          <h3 class="section-title">GLB 原点補正</h3>

          <div class="origin-row">
            <span class="slider-label">Δlon</span>
            <input type="number" id="glb-dlon" value="0" step="0.000001" min="-0.01" max="0.01">
          </div>

          <div class="origin-row">
            <span class="slider-label">Δlat</span>
            <input type="number" id="glb-dlat" value="0" step="0.000001" min="-0.01" max="0.01">
          </div>

          <div class="origin-hint">建物GLB・道路GLB を一括移動<br>1目盛 ≈ 0.1m（緯度方向）</div>

          <button id="btn-origin-reset" class="btn-back" style="margin-top:6px">リセット</button>
        </section>

        <section class="panel-section">
          <h3 class="section-title">◆FOOTPRINT 表示</h3>

          <div class="color-row">
            <span class="slider-label">地面色</span>
            <input type="color" id="ground-color" value="#e7eaf3">
            <span id="ground-color-val">#e7eaf3</span>
          </div>

          <div class="color-row">
            <span class="slider-label">塗り</span>
            <input type="color" id="fp-fill-color" value="#ffffff">
            <span id="fp-fill-color-val">#ffffff</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">塗り opacity</span>
            <input type="range" id="fp-fill-opacity" min="0" max="100" value="100">
            <span id="fp-fill-opacity-val">100%</span>
          </div>

          <div class="color-row">
            <span class="slider-label">輪郭線</span>
            <input type="color" id="fp-line-color" value="#3d607b">
            <span id="fp-line-color-val">#3d607b</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">線 opacity</span>
            <input type="range" id="fp-line-opacity" min="0" max="100" value="76">
            <span id="fp-line-opacity-val">76%</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">線幅</span>
            <input type="range" id="fp-line-width" min="0" max="40" value="4">
            <span id="fp-line-width-val">0.4</span>
          </div>
        </section>

        <section class="panel-section">
          <h3 class="section-title">◆LOD2 表示</h3>

          <div class="color-row">
            <span class="slider-label">LOD2 屋根色</span>
            <input type="color" id="lod2-roof-color" value="#ffffff">
            <span id="lod2-roof-color-val">#ffffff</span>
          </div>

          <div class="color-row">
            <span class="slider-label">LOD2 壁色</span>
            <input type="color" id="lod2-wall-color" value="#d0ccdb">
            <span id="lod2-wall-color-val">#d0ccdb</span>
          </div>
        </section>


        <section class="panel-section">
          <h3 class="section-title">◆レーザースキャン</h3>

          <div class="slider-row">
            <span class="slider-label">幅</span>
            <input type="range" id="lod2-scan-width" min="1" max="5" value="2">
            <span id="lod2-scan-width-val">0.2m</span>
          </div>

          <div class="color-row">
            <span class="slider-label">色</span>
            <input type="color" id="lod2-scan-color" value="#ffffff">
            <span id="lod2-scan-color-val">#ffffff</span>
          </div>

          <div class="slider-hint">LOD2建物選択後の高さ走査に適用</div>
        </section>

        <section class="panel-section">
          <h3 class="section-title">デバッグ</h3>

          <div class="debug-grid">
            <span>LOD2 丁数</span><span id="dbg-chome-count">0</span>
            <span>GLB 合計</span><span id="dbg-glb-mb">0 MB</span>
            <span>GLB 道路</span><span id="dbg-tran">未ロード</span>
            <span>FPS</span><span id="dbg-fps">—</span>
            <span>zoom</span><span id="dbg-zoom">—</span>
            <span>luse</span><span id="dbg-luse-count">—</span>
          </div>
        </section>

        <section class="panel-section" id="selection-section" style="display:none">
          <h3 class="section-title">選択建物</h3>
          <div id="selection-info" class="selection-info"></div>
          <button id="btn-back" class="btn-back">◀ 戻る</button>
        </section>

      </div>
    `;
  }

  _ensurePitchSlider() {
    if (document.getElementById('pitch-slider-dock')) return;

    if (!document.getElementById('petiteau-pitch-slider-style')) {
      const style = document.createElement('style');
      style.id = 'petiteau-pitch-slider-style';
      style.textContent = `
        #pitch-slider-dock {
          position:fixed !important;
          right:18px !important;
          bottom:22px !important;
          z-index:9999 !important;
          width:54px;
          height:210px;
          display:flex;
          flex-direction:column;
          align-items:center;
          justify-content:center;
          gap:6px;
          padding:10px 8px;
          border:1px solid rgba(255,255,255,0.18);
          border-radius:16px;
          background:rgba(14,18,34,0.72);
          color:rgba(235,242,255,0.92);
          box-shadow:0 10px 28px rgba(0,0,0,0.34);
          backdrop-filter:blur(10px);
          user-select:none;
        }

        #pitch-slider-dock .pitch-slider-label {
          font-size:11px;
          color:rgba(220,230,245,0.82);
        }

        #pitch-slider-dock .pitch-slider-value {
          min-width:34px;
          padding:2px 4px;
          border-radius:8px;
          background:rgba(74,144,217,0.18);
          color:#dcecff;
          font-size:12px;
          font-weight:700;
          text-align:center;
        }

        #pitch-slider {
          writing-mode:vertical-rl;
          direction:rtl;
          width:28px;
          height:132px;
          accent-color:#4a90d9;
        }
      `;

      document.head.appendChild(style);
    }

    const dock = document.createElement('div');
    dock.id = 'pitch-slider-dock';
    dock.title = '俯角';
    dock.innerHTML = `
      <div class="pitch-slider-label">0°</div>
      <input type="range" id="pitch-slider" min="0" max="60" step="5" value="50" orient="vertical">
      <div class="pitch-slider-label">60°</div>
      <div class="pitch-slider-value" id="pitch-slider-val">50°</div>
    `;

    document.body.appendChild(dock);
  }

  _setPanelCollapsed(collapsed) {
    const body = this._root.querySelector('#panel-body');
    const btn  = this._root.querySelector('#panel-collapse-btn');

    this._root.classList.toggle('panel-collapsed', Boolean(collapsed));

    if (body) {
      body.style.display = collapsed ? 'none' : '';
    }

    if (btn) {
      btn.textContent = collapsed ? '▼' : '◀';
      btn.title = collapsed ? 'パネルを開く' : 'パネルを折りたたむ';
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
  }

  _ensureMinimizedPanelStyle() {
    if (document.getElementById('petiteau-minimized-panel-style')) return;

    const style = document.createElement('style');
    style.id = 'petiteau-minimized-panel-style';
    style.textContent = `
      #petiteau-panel.panel-collapsed {
        width:56px !important;
        min-width:56px !important;
        max-width:56px !important;
        height:56px !important;
        overflow:visible !important;
        border-radius:18px !important;
        background:transparent !important;
        border:none !important;
        box-shadow:none !important;
      }

      #petiteau-panel.panel-collapsed .panel-header {
        width:56px !important;
        height:56px !important;
        padding:0 !important;
        display:flex !important;
        align-items:center !important;
        justify-content:center !important;
        border-radius:18px !important;
        background:#19c7c9 !important;
        border:1px solid rgba(255,255,255,0.42) !important;
        box-shadow:0 10px 26px rgba(0,0,0,0.32) !important;
      }

      #petiteau-panel.panel-collapsed .panel-title {
        display:none !important;
      }

      #petiteau-panel.panel-collapsed #panel-collapse-btn {
        width:48px !important;
        height:48px !important;
        border:none !important;
        border-radius:15px !important;
        background:#19c7c9 !important;
        color:#ffffff !important;
        font-size:22px !important;
        line-height:48px !important;
        text-align:center !important;
        cursor:pointer !important;
      }

      #petiteau-panel.panel-collapsed #panel-collapse-btn:hover {
        background:#12bfc1 !important;
      }

      .origin-row {
        display:flex;
        align-items:center;
        gap:8px;
        margin:4px 0;
      }

      .origin-row .slider-label {
        min-width:36px;
        font-size:12px;
      }

      .origin-row input[type=number] {
        width:110px;
        padding:3px 6px;
        border-radius:6px;
        border:1px solid rgba(255,255,255,0.2);
        background:rgba(255,255,255,0.08);
        color:inherit;
        font-size:12px;
        font-family:monospace;
      }

      .origin-hint {
        font-size:11px;
        color:rgba(200,210,230,0.65);
        margin-top:2px;
        line-height:1.5;
      }

      .slider-hint {
        font-size:11px;
        color:rgba(200,210,230,0.55);
        margin:-2px 0 4px 0;
        line-height:1.4;
      }
    `;

    document.head.appendChild(style);
  }

  _ensureFloatingStatus() {
    if (document.getElementById('petiteau-floating-status')) return;

    if (!document.getElementById('petiteau-floating-status-style')) {
      const style = document.createElement('style');
      style.id = 'petiteau-floating-status-style';
      style.textContent = `
        #petiteau-floating-status {
          position:fixed !important;
          right:18px !important;
          bottom:246px !important;
          z-index:9999 !important;
          width:54px !important;
          min-height:74px;
          display:flex;
          flex-direction:column;
          align-items:center;
          justify-content:center;
          gap:6px;
          padding:8px 0;
          border-radius:16px;
          background:#9370db;
          color:#ffffff;
          box-shadow:0 10px 26px rgba(0,0,0,0.34);
          border:1px solid rgba(255,255,255,0.28);
          user-select:none;
          pointer-events:none;
        }

        #petiteau-floating-status .floating-status-number {
          width:100%;
          text-align:center;
          font-size:15px;
          font-weight:800;
        }
      `;

      document.head.appendChild(style);
    }

    const box = document.createElement('div');
    box.id = 'petiteau-floating-status';
    box.innerHTML = `
      <div class="floating-status-number" id="floating-fps">--</div>
      <div class="floating-status-number" id="floating-zoom">--</div>
    `;

    document.body.appendChild(box);
  }

  _attachEvents() {
    this._root.querySelector('#panel-collapse-btn').addEventListener('click', () => {
      this._setPanelCollapsed(!this._root.classList.contains('panel-collapsed'));
    });

const pitchSlider = document.getElementById('pitch-slider');
const pitchVal    = document.getElementById('pitch-slider-val');

const syncPitchUi = (pitch) => {
  if (!pitchSlider || !pitchVal) return;

  const v = Math.round(Number(pitch) || 0);

  pitchSlider.value = String(v);
  pitchVal.textContent = `${v}°`;
};

if (pitchSlider && pitchVal) {
  pitchSlider.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    pitchVal.textContent = `${v}°`;
    this.mapApp.setPitch(v);
  });
}

// map 初期化後、実際の pitch と UI を同期。
// 右クリックドラッグ等で map の pitch が変わった場合も追随する。
this.mapApp.on('ready', ({ map }) => {
  syncPitchUi(map.getPitch());

  map.on('pitch', () => {
    syncPitchUi(map.getPitch());
  });
});

    this._root.querySelector('#toggle-footprint').addEventListener('change', (e) => {
      this.mapApp.setFootprintVisible(e.target.checked);
    });

    this._root.querySelector('#toggle-lod2').addEventListener('change', (e) => {
      this.mapApp.setLod2Visible(e.target.checked);
    });

    // GLB 道路
    this._root.querySelector('#toggle-tran-glb').addEventListener('change', (e) => {
      this.mapApp.setTranGlbVisible(e.target.checked);
    });

    const tranColor    = this._root.querySelector('#tran-glb-color');
    const tranColorVal = this._root.querySelector('#tran-glb-color-val');

    tranColor.addEventListener('input', (e) => {
      tranColorVal.textContent = e.target.value;
      this.mapApp.setTranGlbColor(e.target.value);
    });

    const tranOpacity    = this._root.querySelector('#tran-glb-opacity');
    const tranOpacityVal = this._root.querySelector('#tran-glb-opacity-val');

    tranOpacity.addEventListener('input', (e) => {
      tranOpacityVal.textContent = `${e.target.value}%`;
      this.mapApp.setTranGlbOpacity(Number(e.target.value) / 100);
    });

    // GSI 道路
    const gsiRoadToggle     = this._root.querySelector('#toggle-gsi-road');
    const gsiRoadControls   = this._root.querySelector('#gsi-road-controls');
    const gsiRoadOpacityRow = this._root.querySelector('#gsi-road-opacity-row');

    gsiRoadToggle.addEventListener('change', (e) => {
      const visible = e.target.checked;

      this.mapApp.setGsiRoadVisible(visible);

      gsiRoadControls.style.display   = visible ? '' : 'none';
      gsiRoadOpacityRow.style.display = visible ? '' : 'none';
    });

    const gsiRoadColor    = this._root.querySelector('#gsi-road-color');
    const gsiRoadColorVal = this._root.querySelector('#gsi-road-color-val');

    gsiRoadColor.addEventListener('input', (e) => {
      gsiRoadColorVal.textContent = e.target.value;
      this.mapApp.setGsiRoadColor(e.target.value);
    });

    const gsiRoadOpacity    = this._root.querySelector('#gsi-road-opacity');
    const gsiRoadOpacityVal = this._root.querySelector('#gsi-road-opacity-val');

    gsiRoadOpacity.addEventListener('input', (e) => {
      gsiRoadOpacityVal.textContent = `${e.target.value}%`;
      this.mapApp.setGsiRoadOpacity(Number(e.target.value) / 100);
    });

    // 緑地色
    const greenColor    = this._root.querySelector('#luse-green-color');
    const greenColorVal = this._root.querySelector('#luse-green-color-val');

    greenColor.addEventListener('input', (e) => {
      greenColorVal.textContent = e.target.value;
      this.mapApp.setLuseGreenColor(e.target.value);
    });

    const schoolColor    = this._root.querySelector('#luse-school-color');
    const schoolColorVal = this._root.querySelector('#luse-school-color-val');

    schoolColor.addEventListener('input', (e) => {
      schoolColorVal.textContent = e.target.value;
      this.mapApp.setLuseSchoolColor(e.target.value);
    });

    this._root.querySelector('#toggle-luse-green').addEventListener('change', (e) => {
      this.mapApp.setLuseGreenVisible(e.target.checked);
    });

    this._root.querySelector('#toggle-luse-schoolyard').addEventListener('change', (e) => {
      this.mapApp.setLuseSchoolyardVisible(e.target.checked);
    });

    const opSlider = this._root.querySelector('#slider-luse-opacity');
    const opVal    = this._root.querySelector('#luse-opacity-val');

    opSlider.addEventListener('input', (e) => {
      opVal.textContent = `${e.target.value}%`;
      this.mapApp.setLuseOpacity(Number(e.target.value) / 100);
    });

    // 照明
    const sliderBind = (id, valId, suffix, fn) => {
      const el  = this._root.querySelector(`#${id}`);
      const vel = this._root.querySelector(`#${valId}`);

      el.addEventListener('input', (e) => {
        vel.textContent = `${e.target.value}${suffix}`;
        fn(Number(e.target.value));
      });
    };

    sliderBind('sun-azimuth', 'sun-azimuth-val', '°', (v) => {
      this.mapApp.setSunAzimuth(v);
    });

    sliderBind('sun-elevation', 'sun-elevation-val', '°', (v) => {
      this.mapApp.setSunElevation(v);
    });

    sliderBind('sun-intensity', 'sun-intensity-val', '%', (v) => {
      this.mapApp.setSunIntensity(v / 100);
    });

    sliderBind('ambient-intensity', 'ambient-intensity-val', '%', (v) => {
      this.mapApp.setAmbientIntensity(v / 100);
    });

    // 原点補正
    const dlonEl = this._root.querySelector('#glb-dlon');
    const dlatEl = this._root.querySelector('#glb-dlat');

    const applyOffset = () => {
      this.mapApp.setGlbOriginOffset(Number(dlonEl.value), Number(dlatEl.value));
    };

    dlonEl.addEventListener('input', applyOffset);
    dlatEl.addEventListener('input', applyOffset);

    this._root.querySelector('#btn-origin-reset').addEventListener('click', () => {
      dlonEl.value = 0;
      dlatEl.value = 0;
      this.mapApp.setGlbOriginOffset(0, 0);
    });

    // 地面色
    const groundColor    = this._root.querySelector('#ground-color');
    const groundColorVal = this._root.querySelector('#ground-color-val');

    groundColor.addEventListener('input', (e) => {
      groundColorVal.textContent = e.target.value;
      this.mapApp.setGroundColor(e.target.value);
    });

    // Footprint / LOD2 色
    const bind = (id, valId, fn) => {
      const el  = this._root.querySelector(`#${id}`);
      const vel = valId ? this._root.querySelector(`#${valId}`) : null;

      el.addEventListener('input', (e) => {
        if (vel) vel.textContent = e.target.value;
        fn(e.target.value);
      });
    };

    bind('fp-fill-color', 'fp-fill-color-val', (v) => {
      this.mapApp.setFootprintFillColor(v);
    });

    bind('fp-fill-opacity', 'fp-fill-opacity-val', (v) => {
      this.mapApp.setFootprintFillOpacity(Number(v) / 100);
    });

    bind('fp-line-color', 'fp-line-color-val', (v) => {
      this.mapApp.setFootprintLineColor(v);
    });

    bind('fp-line-opacity', 'fp-line-opacity-val', (v) => {
      this.mapApp.setFootprintLineOpacity(Number(v) / 100);
    });

    bind('lod2-roof-color', 'lod2-roof-color-val', (v) => {
      this.mapApp.setLod2RoofColor(v);
    });

    bind('lod2-wall-color', 'lod2-wall-color-val', (v) => {
      this.mapApp.setLod2WallColor(v);
    });


    const scanWidthEl  = this._root.querySelector('#lod2-scan-width');
    const scanWidthVal = this._root.querySelector('#lod2-scan-width-val');

    if (scanWidthEl && scanWidthVal) {
      const isMobile = window.innerWidth <= 720;
      const defaultScanWidthM = isMobile ? 0.3 : 0.2;

      scanWidthEl.value = String(Math.round(defaultScanWidthM * 10));
      scanWidthVal.textContent = `${defaultScanWidthM.toFixed(1)}m`;
      this.mapApp.setLod2HeightScanBandWidth(defaultScanWidthM);

      scanWidthEl.addEventListener('input', (e) => {
        const widthM = Number(e.target.value) / 10;
        scanWidthVal.textContent = `${widthM.toFixed(1)}m`;
        this.mapApp.setLod2HeightScanBandWidth(widthM);
      });
    }

    const scanColorEl  = this._root.querySelector('#lod2-scan-color');
    const scanColorVal = this._root.querySelector('#lod2-scan-color-val');

    if (scanColorEl && scanColorVal) {
      scanColorEl.addEventListener('input', (e) => {
        scanColorVal.textContent = e.target.value;
        this.mapApp.setLod2HeightScanColor(e.target.value);
      });
    }

    const lwEl  = this._root.querySelector('#fp-line-width');
    const lwVal = this._root.querySelector('#fp-line-width-val');

    lwEl.addEventListener('input', (e) => {
      const v = Number(e.target.value) / 10;
      lwVal.textContent = v.toFixed(1);
      this.mapApp.setFootprintLineWidth(v);
    });

    this._root.querySelector('#btn-back').addEventListener('click', () => {
      this.mapApp.goBack();
    });

    this.mapApp.on('areaLoaded', ({ area }) => {
      const el = this._root.querySelector('#area-name');

      if (el) {
        el.textContent = `${area.name}（${area.city_code}）`;
      }

      setTimeout(() => this._refreshDebug(), 500);
    });

    this.mapApp.on('selectionChange', (data) => {
      this._updateSelectionPanel(data);
    });

    this.mapApp.on('zoomChange', ({ zoom }) => {
      const el = this._root.querySelector('#dbg-zoom');

      if (el) {
        el.textContent = zoom.toFixed(1);
      }
    });
  }

  _updateSelectionPanel(data) {
    const section = this._root.querySelector('#selection-section');
    const info    = this._root.querySelector('#selection-info');

    if (!section || !info) return;

    if (!data) {
      section.style.display = 'none';
      info.innerHTML = '';
      return;
    }

    section.style.display = '';

    const props = data.properties ?? {};

    const rows = Object.entries(props)
      .map(([k, v]) => `<tr><th>${k}</th><td>${v ?? '—'}</td></tr>`)
      .join('');

    info.innerHTML = rows
      ? `<table class="prop-table">${rows}</table>`
      : '<em>プロパティなし</em>';
  }

  _startDebugLoop() {
    this._debugTimer = setInterval(() => this._refreshDebug(), 500);

    const tick = (now) => {
      this._fpsFrames++;

      const elapsed = now - this._fpsLast;

      if (elapsed >= 1000) {
        state.fps = Math.round(this._fpsFrames * 1000 / elapsed);
        this._fpsFrames = 0;
        this._fpsLast = now;
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  _refreshDebug() {
    const set = (id, text) => {
      const el = this._root?.querySelector(`#${id}`);
      if (el) el.textContent = text;
    };

    set('dbg-chome-count', String(state.loadedChomeGlbs.size));

    const totalBytes = [...state.loadedChomeGlbs.values()]
      .reduce((s, d) => s + (d.sizeBytes || 0), 0);

    set('dbg-glb-mb', `${(totalBytes / 1_048_576).toFixed(2)} MB`);
    set('dbg-tran', state.tranLoaded ? 'ロード済' : '未ロード');
    set('dbg-fps', String(state.fps));
    set('dbg-zoom', this.mapApp.map ? this.mapApp.map.getZoom().toFixed(1) : '—');

    const floatingFps  = document.getElementById('floating-fps');
    const floatingZoom = document.getElementById('floating-zoom');

    if (floatingFps) {
      floatingFps.textContent = String(state.fps);
    }

    if (floatingZoom) {
      floatingZoom.textContent = this.mapApp.map
        ? this.mapApp.map.getZoom().toFixed(1)
        : '--';
    }

    const luseCount = this.mapApp.vegetationManager?.getFeatureCount();

    set('dbg-luse-count', luseCount !== null ? String(luseCount) : '—');
  }

  destroy() {
    if (this._debugTimer) {
      clearInterval(this._debugTimer);
    }
  }
}